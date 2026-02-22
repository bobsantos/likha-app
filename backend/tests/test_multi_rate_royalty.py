"""
Multi-rate royalty structure tests.

Verifies that tiered (List[RoyaltyTier]) and category-specific (Dict[str, str])
royalty rates flow correctly through:

1. ContractConfirm model — validator passes list/dict through unchanged
2. confirm_contract endpoint — update payload is JSON-serializable for all shapes
3. Contract model — deserializes tiered and category rates read back from the DB
4. Round-trip — a tiered or category rate survives model_dump → Contract(**data)
   intact with the correct structure

Pydantic v2 behaviour notes:
- When a list of plain dicts is given for royalty_rate: List[RoyaltyTier],
  Pydantic coerces each dict into a RoyaltyTier model instance.  Use attribute
  access (tier.threshold) instead of dict subscripting (tier["threshold"]).
- model_dump() preserves native Python types (e.g. date objects) that are not
  JSON-serializable by default.  Use model_dump(mode="json") to get a fully
  JSON-serializable dict, or model_dump_json() to get the JSON string directly.
- The confirm endpoint uses confirm_data.model_dump()["royalty_rate"] which
  correctly converts RoyaltyTier instances to plain dicts for Supabase.
"""

import json
import os
import pytest
from datetime import date
from unittest.mock import Mock, patch, AsyncMock

# Provide env vars before any app module is imported
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _base_dates():
    return dict(
        contract_start_date=date(2024, 1, 1),
        contract_end_date=date(2025, 12, 31),
    )


def _make_db_row(royalty_rate, contract_id="c-multi"):
    """Return a minimal DB dict that mimics a Supabase contracts row."""
    return {
        "id": contract_id,
        "user_id": "user-123",
        "status": "active",
        "filename": "contract.pdf",
        "licensee_name": "Acme Corp",
        "pdf_url": "https://example.com/contract.pdf",
        "extracted_terms": {"licensee_name": "Acme Corp"},
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2024-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": "0",
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": "contracts/user-123/contract.pdf",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


def _make_draft_row(contract_id="draft-multi"):
    """Return a minimal draft DB row (royalty fields not yet populated)."""
    return {
        "id": contract_id,
        "user_id": "user-123",
        "status": "draft",
        "filename": "contract.pdf",
        "licensee_name": None,
        "pdf_url": "https://example.com/contract.pdf",
        "extracted_terms": {"licensee_name": "Acme Corp"},
        "royalty_rate": None,
        "royalty_base": None,
        "territories": [],
        "product_categories": None,
        "contract_start_date": None,
        "contract_end_date": None,
        "minimum_guarantee": None,
        "minimum_guarantee_period": None,
        "advance_payment": None,
        "reporting_frequency": None,
        "storage_path": "contracts/user-123/contract.pdf",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# 1. ContractConfirm — validator behaviour for list and dict inputs
# ---------------------------------------------------------------------------

class TestContractConfirmMultiRate:
    """
    coerce_numeric_royalty_rate must leave list and dict values completely
    unchanged — it must not wrap them in a string or raise a ValidationError.

    When a list of plain dicts is provided, Pydantic v2 coerces each dict to a
    RoyaltyTier instance (that is the declared list item type).  Field values
    are therefore accessed via .threshold and .rate attributes, not dict keys.
    """

    def _confirm(self, royalty_rate):
        from app.models.contract import ContractConfirm
        return ContractConfirm(
            licensee_name="Acme Corp",
            royalty_rate=royalty_rate,
            **_base_dates(),
        )

    # --- tiered list of plain dicts ---

    def test_tiered_list_of_dicts_accepted(self):
        """A list of threshold/rate dicts is accepted without validation error."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        confirm = self._confirm(tiers)
        assert isinstance(confirm.royalty_rate, list)

    def test_tiered_list_of_dicts_coerced_to_royalty_tier_instances(self):
        """
        Pydantic v2 coerces each plain dict to a RoyaltyTier instance.
        Accessing tier values requires attribute access (.threshold, .rate).
        """
        from app.models.contract import RoyaltyTier
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        confirm = self._confirm(tiers)
        tier0 = confirm.royalty_rate[0]
        tier1 = confirm.royalty_rate[1]
        assert isinstance(tier0, RoyaltyTier)
        assert tier0.threshold == "$0-$2,000,000"
        assert tier0.rate == "6%"
        assert tier1.threshold == "$2,000,000+"
        assert tier1.rate == "8%"

    def test_tiered_list_length_preserved(self):
        """The number of tiers is not changed by validation."""
        tiers = [
            {"threshold": "$0-$1,000,000", "rate": "5%"},
            {"threshold": "$1,000,000-$5,000,000", "rate": "7%"},
            {"threshold": "$5,000,000+", "rate": "10%"},
        ]
        confirm = self._confirm(tiers)
        assert len(confirm.royalty_rate) == 3

    def test_tiered_list_not_coerced_to_string(self):
        """Tiered list is not turned into a '%'-suffixed string."""
        tiers = [{"threshold": "$0+", "rate": "8%"}]
        confirm = self._confirm(tiers)
        assert not isinstance(confirm.royalty_rate, str)

    # --- tiered list of RoyaltyTier Pydantic models ---

    def test_tiered_list_of_pydantic_models_accepted(self):
        """A list of RoyaltyTier model instances is accepted without error."""
        from app.models.contract import RoyaltyTier
        tiers = [
            RoyaltyTier(threshold="$0-$1,000,000", rate="5%"),
            RoyaltyTier(threshold="$1,000,000+", rate="8%"),
        ]
        confirm = self._confirm(tiers)
        assert isinstance(confirm.royalty_rate, list)
        assert len(confirm.royalty_rate) == 2

    def test_tiered_list_of_pydantic_models_values_preserved(self):
        """RoyaltyTier model values are not altered by the validator."""
        from app.models.contract import RoyaltyTier
        tiers = [
            RoyaltyTier(threshold="$0-$1,000,000", rate="5%"),
            RoyaltyTier(threshold="$1,000,000+", rate="8%"),
        ]
        confirm = self._confirm(tiers)
        assert confirm.royalty_rate[0].threshold == "$0-$1,000,000"
        assert confirm.royalty_rate[0].rate == "5%"
        assert confirm.royalty_rate[1].threshold == "$1,000,000+"
        assert confirm.royalty_rate[1].rate == "8%"

    def test_tiered_list_of_pydantic_models_not_coerced_to_string(self):
        """RoyaltyTier list is not turned into a '%'-suffixed string."""
        from app.models.contract import RoyaltyTier
        tiers = [RoyaltyTier(threshold="$0+", rate="8%")]
        confirm = self._confirm(tiers)
        assert not isinstance(confirm.royalty_rate, str)

    # --- category dict ---

    def test_category_dict_accepted(self):
        """A category dict is accepted without validation error."""
        rates = {"Books": "15%", "Merchandise": "10%", "Digital": "12%"}
        confirm = self._confirm(rates)
        assert isinstance(confirm.royalty_rate, dict)

    def test_category_dict_values_preserved(self):
        """Category names and rate strings are not altered by the validator."""
        rates = {"Books": "15%", "Merchandise": "10%"}
        confirm = self._confirm(rates)
        assert confirm.royalty_rate["Books"] == "15%"
        assert confirm.royalty_rate["Merchandise"] == "10%"

    def test_category_dict_not_coerced_to_string(self):
        """Category dict is not wrapped in a '%'-suffixed string."""
        rates = {"Home Textiles": "10%"}
        confirm = self._confirm(rates)
        assert not isinstance(confirm.royalty_rate, str)

    def test_category_dict_all_keys_preserved(self):
        """All keys in the category dict survive validation."""
        rates = {
            "home textiles": "10%",
            "dinnerware": "7%",
            "fragrance": "12%",
            "apparel": "9%",
        }
        confirm = self._confirm(rates)
        assert set(confirm.royalty_rate.keys()) == set(rates.keys())

    # --- model_dump serialization ---

    def test_tiered_list_model_dump_json_is_serializable(self):
        """
        model_dump(mode='json') of a ContractConfirm with tiered rates is
        JSON-serializable (Pydantic v2 converts RoyaltyTier instances and date
        objects to JSON-compatible types in this mode).
        """
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        confirm = self._confirm(tiers)
        # model_dump(mode="json") is what FastAPI and the router effectively use
        dumped = confirm.model_dump(mode="json")
        serialized = json.dumps(dumped)
        data = json.loads(serialized)
        assert isinstance(data["royalty_rate"], list)
        assert data["royalty_rate"][0]["rate"] == "6%"
        assert data["royalty_rate"][0]["threshold"] == "$0-$2,000,000"

    def test_category_dict_model_dump_json_is_serializable(self):
        """
        model_dump(mode='json') of a ContractConfirm with category rates is
        JSON-serializable.
        """
        rates = {"Books": "15%", "Merchandise": "10%"}
        confirm = self._confirm(rates)
        dumped = confirm.model_dump(mode="json")
        serialized = json.dumps(dumped)
        data = json.loads(serialized)
        assert isinstance(data["royalty_rate"], dict)
        assert data["royalty_rate"]["Books"] == "15%"

    def test_tiered_list_model_dump_royalty_rate_is_serializable_for_supabase(self):
        """
        The router uses _confirm_dump = confirm_data.model_dump() and then reads
        _confirm_dump["royalty_rate"] to pass to Supabase.  model_dump() (default
        mode) converts RoyaltyTier instances to plain dicts, making the value
        JSON-serializable by supabase-py's json.dumps() call.
        """
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        confirm = self._confirm(tiers)
        # Replicate exactly what the router does
        royalty_rate_for_db = confirm.model_dump()["royalty_rate"]
        # Each element must be a plain dict (not a RoyaltyTier model instance)
        for item in royalty_rate_for_db:
            assert isinstance(item, dict), (
                f"Expected plain dict but got {type(item).__name__} — "
                "supabase-py cannot serialize Pydantic model instances"
            )
        # Must be JSON-serializable
        json.dumps(royalty_rate_for_db)


# ---------------------------------------------------------------------------
# 2. confirm_contract endpoint — update payload shapes
# ---------------------------------------------------------------------------

class TestConfirmEndpointMultiRate:
    """
    The PUT /{id}/confirm endpoint must pass tiered and category rates through
    to the Supabase update call in a JSON-serializable form.
    """

    @pytest.mark.asyncio
    async def test_confirm_with_category_dict_sends_dict_to_db(self):
        """
        When royalty_rate is a category Dict[str, str], the update payload must
        contain a plain dict so supabase-py can JSON-serialize it.
        """
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm

        contract_id = "draft-cat-123"
        user_id = "user-123"

        category_rates = {"Books": "15%", "Merchandise": "10%", "Digital": "12%"}
        draft_row = _make_draft_row(contract_id=contract_id)
        active_row = _make_db_row(royalty_rate=category_rates, contract_id=contract_id)
        active_row["licensee_name"] = "Acme Corp"

        confirm_data = ContractConfirm(
            licensee_name="Acme Corp",
            royalty_rate=category_rates,
            **_base_dates(),
        )

        with patch("app.routers.contracts.verify_contract_ownership") as mock_verify:
            with patch("app.routers.contracts.supabase_admin") as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                await confirm_contract(contract_id, confirm_data, user_id=user_id)

                update_data = mock_supabase.table.return_value.update.call_args[0][0]
                royalty_rate_payload = update_data["royalty_rate"]

                assert isinstance(royalty_rate_payload, dict), (
                    f"Expected plain dict but got {type(royalty_rate_payload).__name__}"
                )
                assert royalty_rate_payload["Books"] == "15%"
                assert royalty_rate_payload["Merchandise"] == "10%"
                assert royalty_rate_payload["Digital"] == "12%"

    @pytest.mark.asyncio
    async def test_confirm_with_category_dict_payload_is_json_serializable(self):
        """
        Category-dict royalty_rate in the update payload must not raise TypeError
        when passed through json.dumps() (simulating supabase-py serialization).
        """
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm

        contract_id = "draft-cat-json-123"
        user_id = "user-123"

        category_rates = {"Home Textiles": "10%", "Dinnerware": "7%"}
        draft_row = _make_draft_row(contract_id=contract_id)
        active_row = _make_db_row(royalty_rate=category_rates, contract_id=contract_id)

        confirm_data = ContractConfirm(
            licensee_name="Acme Corp",
            royalty_rate=category_rates,
            **_base_dates(),
        )

        with patch("app.routers.contracts.verify_contract_ownership") as mock_verify:
            with patch("app.routers.contracts.supabase_admin") as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                await confirm_contract(contract_id, confirm_data, user_id=user_id)

                update_data = mock_supabase.table.return_value.update.call_args[0][0]
                royalty_rate_payload = update_data["royalty_rate"]

                try:
                    json.dumps(royalty_rate_payload)
                except TypeError as exc:
                    pytest.fail(
                        f"Category-dict royalty_rate is not JSON-serializable: {exc}"
                    )

    @pytest.mark.asyncio
    async def test_confirm_with_tiered_list_payload_values_correct(self):
        """
        Tiered royalty_rate: the dict values in the list must carry through
        with the correct threshold and rate strings, as plain dicts.
        """
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm, RoyaltyTier

        contract_id = "draft-tiered-values-123"
        user_id = "user-123"

        tiers = [
            RoyaltyTier(threshold="$0-$2,000,000", rate="6%"),
            RoyaltyTier(threshold="$2,000,000-$5,000,000", rate="8%"),
            RoyaltyTier(threshold="$5,000,000+", rate="10%"),
        ]

        draft_row = _make_draft_row(contract_id=contract_id)
        active_row = _make_db_row(
            royalty_rate=[{"threshold": t.threshold, "rate": t.rate} for t in tiers],
            contract_id=contract_id,
        )

        confirm_data = ContractConfirm(
            licensee_name="Acme Corp",
            royalty_rate=tiers,
            **_base_dates(),
        )

        with patch("app.routers.contracts.verify_contract_ownership") as mock_verify:
            with patch("app.routers.contracts.supabase_admin") as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                await confirm_contract(contract_id, confirm_data, user_id=user_id)

                update_data = mock_supabase.table.return_value.update.call_args[0][0]
                payload = update_data["royalty_rate"]

                assert isinstance(payload, list)
                assert len(payload) == 3
                # Each element must be a plain dict (not a RoyaltyTier model instance)
                for item in payload:
                    assert isinstance(item, dict)
                assert payload[0]["threshold"] == "$0-$2,000,000"
                assert payload[0]["rate"] == "6%"
                assert payload[2]["threshold"] == "$5,000,000+"
                assert payload[2]["rate"] == "10%"

    @pytest.mark.asyncio
    async def test_confirm_with_category_dict_result_is_contract_model(self):
        """
        Confirming with a category-dict rate returns a valid Contract instance.
        """
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm, Contract

        contract_id = "draft-cat-result-123"
        user_id = "user-123"

        category_rates = {"Books": "15%", "Merchandise": "10%"}
        draft_row = _make_draft_row(contract_id=contract_id)
        active_row = _make_db_row(royalty_rate=category_rates, contract_id=contract_id)
        active_row["licensee_name"] = "Acme Corp"

        confirm_data = ContractConfirm(
            licensee_name="Acme Corp",
            royalty_rate=category_rates,
            **_base_dates(),
        )

        with patch("app.routers.contracts.verify_contract_ownership") as mock_verify:
            with patch("app.routers.contracts.supabase_admin") as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                result = await confirm_contract(contract_id, confirm_data, user_id=user_id)

                assert isinstance(result, Contract)
                assert result.status == "active"
                assert isinstance(result.royalty_rate, dict)


# ---------------------------------------------------------------------------
# 3. Contract model — deserializing rates read back from the DB
# ---------------------------------------------------------------------------

class TestContractModelDeserializesMultiRate:
    """
    Contract(**db_row) must correctly interpret list and dict royalty_rate values
    returned from Supabase (which stores them as JSON).

    When the DB returns a list of dicts for royalty_rate, Pydantic v2 coerces
    each dict to a RoyaltyTier instance (matching List[RoyaltyTier]).
    Dict/category rates remain plain dicts (matching Dict[str, str]).
    """

    def _make_contract(self, royalty_rate):
        from app.models.contract import Contract
        return Contract(**_make_db_row(royalty_rate=royalty_rate))

    # --- tiered list ---

    def test_tiered_list_is_deserialized_as_list(self):
        """royalty_rate stored as a list of dicts comes back as a list."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        contract = self._make_contract(tiers)
        assert isinstance(contract.royalty_rate, list)

    def test_tiered_list_length_preserved_on_read(self):
        """All tier entries survive the deserialization."""
        tiers = [
            {"threshold": "$0-$1,000,000", "rate": "5%"},
            {"threshold": "$1,000,000-$5,000,000", "rate": "7%"},
            {"threshold": "$5,000,000+", "rate": "10%"},
        ]
        contract = self._make_contract(tiers)
        assert len(contract.royalty_rate) == 3

    def test_tiered_list_coerced_to_royalty_tier_instances_on_read(self):
        """
        Each element is coerced to a RoyaltyTier instance by Pydantic v2.
        Values are accessible via .threshold and .rate attributes.
        """
        from app.models.contract import RoyaltyTier
        tiers = [{"threshold": "$0-$500,000", "rate": "4.5%"}]
        contract = self._make_contract(tiers)
        tier = contract.royalty_rate[0]
        assert isinstance(tier, RoyaltyTier)
        assert tier.threshold == "$0-$500,000"
        assert tier.rate == "4.5%"

    def test_tiered_list_model_dump_json_is_serializable(self):
        """
        model_dump(mode='json') converts RoyaltyTier instances to plain dicts,
        making the result JSON-serializable (simulating FastAPI's response path).
        """
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        contract = self._make_contract(tiers)
        dumped = contract.model_dump(mode="json")
        serialized = json.dumps(dumped)
        data = json.loads(serialized)
        assert isinstance(data["royalty_rate"], list)
        assert data["royalty_rate"][0]["threshold"] == "$0-$2,000,000"
        assert data["royalty_rate"][0]["rate"] == "6%"

    # --- category dict ---

    def test_category_dict_is_deserialized_as_dict(self):
        """royalty_rate stored as a dict comes back as a dict."""
        rates = {"Books": "15%", "Merchandise": "10%"}
        contract = self._make_contract(rates)
        assert isinstance(contract.royalty_rate, dict)

    def test_category_dict_keys_preserved_on_read(self):
        """All category keys survive deserialization."""
        rates = {"Books": "15%", "Merchandise": "10%", "Digital": "12%"}
        contract = self._make_contract(rates)
        assert set(contract.royalty_rate.keys()) == {"Books", "Merchandise", "Digital"}

    def test_category_dict_values_preserved_on_read(self):
        """Rate strings are not altered during deserialization."""
        rates = {"Home Textiles": "10%", "Dinnerware": "7%"}
        contract = self._make_contract(rates)
        assert contract.royalty_rate["Home Textiles"] == "10%"
        assert contract.royalty_rate["Dinnerware"] == "7%"

    def test_category_dict_model_dump_json_is_serializable(self):
        """model_dump(mode='json') of a category-rate contract is JSON-serializable."""
        rates = {"Books": "15%", "Merchandise": "10%"}
        contract = self._make_contract(rates)
        dumped = contract.model_dump(mode="json")
        serialized = json.dumps(dumped)
        data = json.loads(serialized)
        assert isinstance(data["royalty_rate"], dict)
        assert data["royalty_rate"]["Books"] == "15%"

    def test_none_royalty_rate_is_none(self):
        """A None royalty_rate (draft contract) deserializes to None."""
        contract = self._make_contract(None)
        assert contract.royalty_rate is None

    def test_flat_string_rate_still_works(self):
        """Flat string royalty_rate is still handled correctly."""
        contract = self._make_contract("8% of Net Sales")
        assert contract.royalty_rate == "8% of Net Sales"


# ---------------------------------------------------------------------------
# 4. Round-trip tests
# ---------------------------------------------------------------------------

class TestRoyaltyRateRoundTrip:
    """
    Verify that a royalty_rate value survives the full serialize-then-deserialize
    cycle: Contract(**row) -> model_dump(mode='json') -> Contract(**dumped).

    This simulates the API read path where Supabase returns a JSON value,
    it is instantiated into a Contract model, serialized to a dict (or JSON),
    and the result matches the original structure.

    mode='json' is used throughout because that is what FastAPI uses when
    serializing response models, and it ensures all Pydantic model instances
    (e.g. RoyaltyTier) and non-JSON native types (e.g. date) are converted.
    """

    def _round_trip(self, royalty_rate):
        """
        Simulate: DB row -> Contract model -> JSON dict -> Contract model.
        Returns the royalty_rate from the final Contract instance.
        """
        from app.models.contract import Contract
        row = _make_db_row(royalty_rate=royalty_rate)
        contract = Contract(**row)
        # model_dump(mode="json") is what FastAPI effectively uses for responses
        dumped = contract.model_dump(mode="json")
        contract2 = Contract(**dumped)
        return contract2.royalty_rate

    def test_flat_string_round_trip(self):
        """Flat string rate survives the round-trip unchanged."""
        result = self._round_trip("8% of Net Sales")
        assert result == "8% of Net Sales"

    def test_tiered_list_round_trip_type(self):
        """Tiered list comes back as a list after the round-trip."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        result = self._round_trip(tiers)
        assert isinstance(result, list)

    def test_tiered_list_round_trip_length(self):
        """All tier entries are preserved through the round-trip."""
        tiers = [
            {"threshold": "$0-$1M", "rate": "5%"},
            {"threshold": "$1M-$5M", "rate": "7%"},
            {"threshold": "$5M+", "rate": "10%"},
        ]
        result = self._round_trip(tiers)
        assert len(result) == 3

    def test_tiered_list_round_trip_values_via_attributes(self):
        """
        After the round-trip, tier values are accessible via Pydantic
        RoyaltyTier attributes (.threshold, .rate).
        """
        from app.models.contract import RoyaltyTier
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        result = self._round_trip(tiers)
        tier0 = result[0]
        assert isinstance(tier0, RoyaltyTier)
        assert tier0.threshold == "$0-$2,000,000"
        assert tier0.rate == "6%"

    def test_tiered_list_round_trip_json_serializable_via_mode_json(self):
        """
        The round-tripped tiered contract is JSON-serializable when
        model_dump(mode='json') is used (matching the FastAPI response path).
        """
        from app.models.contract import Contract
        tiers = [{"threshold": "$0-$2,000,000", "rate": "6%"}]
        row = _make_db_row(royalty_rate=tiers)
        contract = Contract(**row)
        # This is the path FastAPI takes for JSON responses
        dumped = contract.model_dump(mode="json")
        json.dumps(dumped)  # Must not raise TypeError

    def test_category_dict_round_trip_type(self):
        """Category dict comes back as a dict after the round-trip."""
        rates = {"Books": "15%", "Merchandise": "10%"}
        result = self._round_trip(rates)
        assert isinstance(result, dict)

    def test_category_dict_round_trip_keys(self):
        """All category keys are preserved through the round-trip."""
        rates = {"Books": "15%", "Merchandise": "10%", "Digital": "12%"}
        result = self._round_trip(rates)
        assert set(result.keys()) == {"Books", "Merchandise", "Digital"}

    def test_category_dict_round_trip_values(self):
        """Rate strings are not altered during the round-trip."""
        rates = {"Home Textiles": "10%", "Dinnerware": "7%"}
        result = self._round_trip(rates)
        assert result["Home Textiles"] == "10%"
        assert result["Dinnerware"] == "7%"

    def test_category_dict_round_trip_is_json_serializable(self):
        """The round-tripped category rate must be JSON-serializable."""
        rates = {"Books": "15%"}
        result = self._round_trip(rates)
        json.dumps(result)

    def test_none_round_trip(self):
        """None royalty_rate (draft) survives the round-trip as None."""
        result = self._round_trip(None)
        assert result is None
