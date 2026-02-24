"""
Category resolution tests (Phase: category-mismatch feature).

Tests for:
  - claude_suggest_categories() in spreadsheet_parser.py
  - suggest_category_mapping() in spreadsheet_parser.py
  - _resolve_category() helper in sales_upload.py
  - Upload endpoint returns category_resolution for category-rate contracts
  - Confirm endpoint accepts category_mapping, applies before royalty calc,
    and saves aliases to licensee_column_mappings.category_mapping

TDD: these tests were written before the implementation.
"""

import io
import json
import os
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_xlsx_bytes(rows: list[list]) -> bytes:
    """Build an xlsx file in-memory from a list-of-lists and return its bytes."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _make_claude_response(content: str) -> MagicMock:
    """Build a mock Anthropic message response with the given text content."""
    response = MagicMock()
    response.content = [MagicMock()]
    response.content[0].text = content
    return response


def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    licensee_name="Meridian Goods LLC",
    royalty_rate=None,
    minimum_guarantee="0",
):
    """Build a fake contract row. Defaults to a category-rate contract."""
    if royalty_rate is None:
        royalty_rate = {"Apparel": "10%", "Accessories": "12%", "Footwear": "8%"}
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": "active",
        "filename": "meridian.pdf",
        "licensee_name": licensee_name,
        "pdf_url": "https://test.supabase.co/storage/meridian.pdf",
        "extracted_terms": {},
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2025-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": minimum_guarantee,
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/meridian.pdf",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    }


def _make_db_sales_period(
    period_id="sp-1",
    contract_id="contract-123",
    period_start="2025-01-01",
    period_end="2025-03-31",
    net_sales="100000",
    royalty_calculated="10400",
    minimum_applied=False,
    licensee_reported_royalty=None,
):
    return {
        "id": period_id,
        "contract_id": contract_id,
        "period_start": period_start,
        "period_end": period_end,
        "net_sales": net_sales,
        "category_breakdown": None,
        "royalty_calculated": royalty_calculated,
        "minimum_applied": minimum_applied,
        "licensee_reported_royalty": licensee_reported_royalty,
        "created_at": "2025-04-01T00:00:00Z",
        "updated_at": "2025-04-01T00:00:00Z",
    }


def _mock_contract_query(mock_supabase, contract_data):
    """Set up mock for supabase.table("contracts").select("*").eq("id", ...).execute()."""
    mock_q = MagicMock()
    mock_q.execute.return_value = Mock(data=[contract_data])
    mock_s = MagicMock()
    mock_s.eq.return_value = mock_q
    mock_t = MagicMock()
    mock_t.select.return_value = mock_s
    return mock_t


def _mock_mapping_query(mock_supabase, mapping_data=None):
    """Set up mock for supabase.table("licensee_column_mappings") query chain."""
    mock_limit = MagicMock()
    mock_limit.execute.return_value = Mock(data=[mapping_data] if mapping_data else [])
    mock_ilike = MagicMock()
    mock_ilike.limit.return_value = mock_limit
    mock_eq = MagicMock()
    mock_eq.ilike.return_value = mock_ilike
    mock_select = MagicMock()
    mock_select.eq.return_value = mock_eq
    mock_t = MagicMock()
    mock_t.select.return_value = mock_select
    return mock_t


def _mock_periods_table(insert_result):
    """
    Set up a mock for the sales_periods table that handles:
      - select("id").eq(...).eq(...).execute() -> data=[] (no dupe)
      - insert({...}).execute() -> data=[insert_result]
    """
    mock_dupe_exec = MagicMock()
    mock_dupe_exec.execute.return_value = Mock(data=[])

    mock_dupe_chain = MagicMock()
    mock_dupe_chain.eq.return_value = mock_dupe_exec
    mock_dupe_exec.eq.return_value = mock_dupe_exec

    mock_insert_result = MagicMock()
    mock_insert_result.execute.return_value = Mock(data=[insert_result])

    mock_t = MagicMock()
    mock_t.select.return_value = mock_dupe_chain
    mock_t.insert.return_value = mock_insert_result
    return mock_t


# ---------------------------------------------------------------------------
# claude_suggest_categories() — unit tests
# ---------------------------------------------------------------------------

class TestClaudeSuggestCategories:
    """claude_suggest_categories() calls Claude and parses the response."""

    def test_returns_mapping_for_valid_contract_categories(self):
        """Claude's mapping is returned when all suggested categories are valid."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        report_categories = ["Tops & Bottoms", "Hard Accessories", "Footwear"]
        contract_categories = ["Apparel", "Accessories", "Footwear"]

        ai_response = {
            "Tops & Bottoms": "Apparel",
            "Hard Accessories": "Accessories",
            "Footwear": "Footwear",
        }

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps(ai_response)
            )

            result = claude_suggest_categories(report_categories, contract_categories)

        assert result["Tops & Bottoms"] == "Apparel"
        assert result["Hard Accessories"] == "Accessories"
        assert result["Footwear"] == "Footwear"

    def test_discards_suggestions_not_in_contract_categories(self):
        """Suggested categories that are not in contract_categories are discarded."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        report_categories = ["Tops & Bottoms", "Electronics"]
        contract_categories = ["Apparel", "Accessories"]

        # Claude maps "Electronics" to a category not in the contract
        ai_response = {
            "Tops & Bottoms": "Apparel",
            "Electronics": "Gadgets",  # not a real contract category
        }

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps(ai_response)
            )

            result = claude_suggest_categories(report_categories, contract_categories)

        assert result["Tops & Bottoms"] == "Apparel"
        # "Electronics" -> "Gadgets" discarded because "Gadgets" not in contract
        assert "Electronics" not in result

    def test_handles_markdown_fenced_json(self):
        """Claude sometimes wraps JSON in markdown code fences — strip them."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        report_categories = ["Tops"]
        contract_categories = ["Apparel"]

        fenced = '```json\n{"Tops": "Apparel"}\n```'

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(fenced)

            result = claude_suggest_categories(report_categories, contract_categories)

        assert result == {"Tops": "Apparel"}

    def test_returns_empty_dict_on_invalid_json(self):
        """If Claude returns non-parseable text, return an empty dict."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                "I cannot determine the mapping."
            )

            result = claude_suggest_categories(["Tops"], ["Apparel"])

        assert result == {}

    def test_returns_empty_dict_on_timeout(self):
        """A timeout exception returns an empty dict (silent fallback)."""
        import httpx
        from app.services.spreadsheet_parser import claude_suggest_categories

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.side_effect = httpx.TimeoutException("timeout")

            result = claude_suggest_categories(["Tops"], ["Apparel"])

        assert result == {}

    def test_returns_empty_dict_on_api_error(self):
        """Any exception from the Anthropic client returns an empty dict."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.side_effect = Exception("API error")

            result = claude_suggest_categories(["Tops"], ["Apparel"])

        assert result == {}

    def test_returns_empty_dict_when_report_categories_empty(self):
        """If report_categories is empty, return {} without calling Claude."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client

            result = claude_suggest_categories([], ["Apparel"])

        assert result == {}
        assert not mock_client.messages.create.called

    def test_prompt_contains_report_and_contract_categories(self):
        """The prompt includes both report categories and contract categories."""
        from app.services.spreadsheet_parser import claude_suggest_categories

        report_categories = ["Tops & Bottoms"]
        contract_categories = ["Apparel", "Accessories"]

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps({"Tops & Bottoms": "Apparel"})
            )

            claude_suggest_categories(report_categories, contract_categories)

            call_kwargs = mock_client.messages.create.call_args
            user_content = call_kwargs[1]["messages"][0]["content"]
            assert "Tops & Bottoms" in user_content
            assert "Apparel" in user_content
            assert "Accessories" in user_content


# ---------------------------------------------------------------------------
# suggest_category_mapping() — unit tests
# ---------------------------------------------------------------------------

class TestSuggestCategoryMapping:
    """suggest_category_mapping() implements 4-level resolution."""

    def test_exact_match_case_insensitive(self):
        """Exact matches (case-insensitive) resolve without AI."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        result, sources = suggest_category_mapping(
            report_categories=["footwear", "APPAREL"],
            contract_categories=["Footwear", "Apparel"],
            saved_category_mapping=None,
        )

        assert result["footwear"] == "Footwear"
        assert result["APPAREL"] == "Apparel"
        assert sources["footwear"] == "exact"
        assert sources["APPAREL"] == "exact"

    def test_saved_alias_takes_priority_over_exact_match(self):
        """A saved alias overrides exact matching."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        # "Footwear" is saved as "Apparel" (a deliberate override — unusual but valid)
        result, sources = suggest_category_mapping(
            report_categories=["Footwear"],
            contract_categories=["Apparel", "Footwear"],
            saved_category_mapping={"Footwear": "Apparel"},
        )

        assert result["Footwear"] == "Apparel"
        assert sources["Footwear"] == "saved"

    def test_saved_alias_used_for_non_matching_category(self):
        """Saved aliases are applied for categories present in the upload."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        result, sources = suggest_category_mapping(
            report_categories=["Tops & Bottoms"],
            contract_categories=["Apparel", "Accessories"],
            saved_category_mapping={"Tops & Bottoms": "Apparel"},
        )

        assert result["Tops & Bottoms"] == "Apparel"
        assert sources["Tops & Bottoms"] == "saved"

    def test_stale_saved_alias_ignored(self):
        """Saved aliases for categories NOT in the current report are ignored."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={},
        ):
            result, sources = suggest_category_mapping(
                report_categories=["Footwear"],  # "Tops & Bottoms" not in report
                contract_categories=["Apparel", "Footwear"],
                saved_category_mapping={
                    "Tops & Bottoms": "Apparel",  # stale — not in report
                },
            )

        # "Footwear" resolves exactly, the stale alias is irrelevant
        assert result["Footwear"] == "Footwear"
        assert "Tops & Bottoms" not in result

    def test_substring_match(self):
        """When exact match fails, substring matching resolves the category."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        # "Apparel Items" contains "Apparel"
        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={},
        ):
            result, sources = suggest_category_mapping(
                report_categories=["Apparel Items"],
                contract_categories=["Apparel", "Footwear"],
                saved_category_mapping=None,
            )

        assert result["Apparel Items"] == "Apparel"
        assert sources["Apparel Items"] == "substring"

    def test_ai_suggestion_for_unresolved(self):
        """Categories unresolved by saved/exact/substring are sent to AI."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={"Tops & Bottoms": "Apparel"},
        ) as mock_ai:
            result, sources = suggest_category_mapping(
                report_categories=["Tops & Bottoms"],
                contract_categories=["Apparel", "Accessories"],
                saved_category_mapping=None,
            )

        assert result["Tops & Bottoms"] == "Apparel"
        assert sources["Tops & Bottoms"] == "ai"
        assert mock_ai.called

    def test_unresolved_category_has_none_source(self):
        """A category that nothing resolves has source='none' and no mapping entry."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={},  # AI also fails
        ):
            result, sources = suggest_category_mapping(
                report_categories=["Electronics"],
                contract_categories=["Apparel", "Footwear"],
                saved_category_mapping=None,
            )

        assert "Electronics" not in result or result.get("Electronics") is None
        assert sources.get("Electronics") == "none"

    def test_mixed_resolution_sources(self):
        """Multiple categories each resolve via different paths."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={"Tops & Bottoms": "Apparel"},
        ):
            result, sources = suggest_category_mapping(
                report_categories=["Footwear", "Apparel Items", "Tops & Bottoms"],
                contract_categories=["Apparel", "Footwear"],
                saved_category_mapping=None,
            )

        assert result["Footwear"] == "Footwear"
        assert sources["Footwear"] == "exact"
        assert result["Apparel Items"] == "Apparel"
        assert sources["Apparel Items"] == "substring"
        assert result["Tops & Bottoms"] == "Apparel"
        assert sources["Tops & Bottoms"] == "ai"

    def test_only_unresolved_sent_to_ai(self):
        """Only categories not resolved by saved/exact/substring are sent to AI."""
        from app.services.spreadsheet_parser import suggest_category_mapping

        with patch(
            "app.services.spreadsheet_parser.claude_suggest_categories",
            return_value={},
        ) as mock_ai:
            suggest_category_mapping(
                report_categories=["Footwear", "Tops & Bottoms"],
                contract_categories=["Apparel", "Footwear"],
                saved_category_mapping=None,
            )

        if mock_ai.called:
            sent = mock_ai.call_args[0][0]  # first positional arg: report_categories list
            assert "Footwear" not in sent  # exact match — should not go to AI
            assert "Tops & Bottoms" in sent


# ---------------------------------------------------------------------------
# _resolve_category() — unit tests
# ---------------------------------------------------------------------------

class TestResolveCategory:
    """_resolve_category() applies explicit mapping -> exact -> substring -> None."""

    def test_explicit_mapping_resolved(self):
        """User-provided mapping takes priority over all other resolution."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Tops & Bottoms",
            contract_cats=["Apparel", "Accessories"],
            explicit_mapping={"Tops & Bottoms": "Apparel"},
        )
        assert result == "Apparel"

    def test_explicit_mapping_exclude(self):
        """Mapping to None means exclude from calculation."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Electronics",
            contract_cats=["Apparel", "Accessories"],
            explicit_mapping={"Electronics": None},
        )
        assert result is None

    def test_exact_match_case_insensitive(self):
        """Exact match (case-insensitive) resolves when no explicit mapping."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="footwear",
            contract_cats=["Apparel", "Footwear"],
            explicit_mapping={},
        )
        assert result == "Footwear"

    def test_substring_match(self):
        """Substring match resolves when exact match fails."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Apparel Items",
            contract_cats=["Apparel", "Footwear"],
            explicit_mapping={},
        )
        assert result == "Apparel"

    def test_unresolved_returns_none(self):
        """Returns None for a category that cannot be resolved."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Electronics",
            contract_cats=["Apparel", "Footwear"],
            explicit_mapping={},
        )
        assert result is None

    def test_explicit_mapping_takes_priority_over_exact(self):
        """Explicit mapping wins even when exact match exists."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Footwear",
            contract_cats=["Apparel", "Footwear"],
            explicit_mapping={"Footwear": "Apparel"},  # override
        )
        assert result == "Apparel"

    def test_empty_contract_cats_returns_none(self):
        """Returns None when contract_cats is empty."""
        from app.routers.sales_upload import _resolve_category

        result = _resolve_category(
            report_cat="Footwear",
            contract_cats=[],
            explicit_mapping={},
        )
        assert result is None


# ---------------------------------------------------------------------------
# Upload endpoint — category_resolution in response
# ---------------------------------------------------------------------------

class TestUploadEndpointCategoryResolution:
    """Upload endpoint includes category_resolution for category-rate contracts."""

    @pytest.mark.asyncio
    async def test_category_contract_returns_category_resolution(self):
        """For a category-rate contract, response includes category_resolution."""
        rows = [
            ["Product Category", "Net Sales"],
            ["Tops & Bottoms", 50000],
            ["Hard Accessories", 30000],
            ["Footwear", 20000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Accessories": "12%", "Footwear": "8%"}
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.services.spreadsheet_parser.claude_suggest_categories") as mock_ai:

            mock_ai.return_value = {
                "Tops & Bottoms": "Apparel",
                "Hard Accessories": "Accessories",
            }

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.xlsx"
            upload_file_mock.read = AsyncMock(return_value=xlsx_bytes)
            upload_file_mock.size = len(xlsx_bytes)

            result = await upload_file(
                contract_id="contract-123",
                file=upload_file_mock,
                period_start="2025-01-01",
                period_end="2025-03-31",
                user_id="user-123",
            )

        assert "category_resolution" in result
        cr = result["category_resolution"]
        assert cr["required"] is True
        assert set(cr["contract_categories"]) == {"Apparel", "Accessories", "Footwear"}
        assert set(cr["report_categories"]) == {"Tops & Bottoms", "Hard Accessories", "Footwear"}
        assert "suggested_category_mapping" in cr
        assert "category_mapping_sources" in cr

    @pytest.mark.asyncio
    async def test_all_exact_match_categories_not_required(self):
        """When all categories match exactly, required is False — skip Step 2.5."""
        rows = [
            ["Product Category", "Net Sales"],
            ["Apparel", 50000],
            ["Footwear", 20000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Footwear": "8%"}
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.services.spreadsheet_parser.claude_suggest_categories", return_value={}):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.xlsx"
            upload_file_mock.read = AsyncMock(return_value=xlsx_bytes)
            upload_file_mock.size = len(xlsx_bytes)

            result = await upload_file(
                contract_id="contract-123",
                file=upload_file_mock,
                period_start="2025-01-01",
                period_end="2025-03-31",
                user_id="user-123",
            )

        cr = result["category_resolution"]
        assert cr["required"] is False
        assert cr["category_mapping_sources"]["Footwear"] == "exact"
        assert cr["category_mapping_sources"]["Apparel"] == "exact"
        assert cr["suggested_category_mapping"]["Footwear"] == "Footwear"
        assert cr["suggested_category_mapping"]["Apparel"] == "Apparel"

    @pytest.mark.asyncio
    async def test_flat_rate_contract_has_no_category_resolution(self):
        """Flat-rate contracts do NOT include category_resolution in response."""
        rows = [
            ["Net Sales", "Royalty Due"],
            [50000, 4000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract(royalty_rate="8%")

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.xlsx"
            upload_file_mock.read = AsyncMock(return_value=xlsx_bytes)
            upload_file_mock.size = len(xlsx_bytes)

            result = await upload_file(
                contract_id="contract-123",
                file=upload_file_mock,
                period_start="2025-01-01",
                period_end="2025-03-31",
                user_id="user-123",
            )

        # Flat-rate contracts: no category_resolution or it's None/absent
        assert result.get("category_resolution") is None

    @pytest.mark.asyncio
    async def test_saved_category_aliases_loaded_on_upload(self):
        """If a saved category_mapping exists for the licensee, it's used as initial suggestions."""
        rows = [
            ["Product Category", "Net Sales"],
            ["Tops & Bottoms", 50000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Footwear": "8%"}
        )
        saved_mapping_row = {
            "id": "map-1",
            "user_id": "user-123",
            "licensee_name": "Meridian Goods LLC",
            "column_mapping": {"Product Category": "product_category", "Net Sales": "net_sales"},
            "category_mapping": {"Tops & Bottoms": "Apparel"},
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.services.spreadsheet_parser.claude_suggest_categories", return_value={}):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, saved_mapping_row)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.xlsx"
            upload_file_mock.read = AsyncMock(return_value=xlsx_bytes)
            upload_file_mock.size = len(xlsx_bytes)

            result = await upload_file(
                contract_id="contract-123",
                file=upload_file_mock,
                period_start="2025-01-01",
                period_end="2025-03-31",
                user_id="user-123",
            )

        cr = result["category_resolution"]
        assert cr["suggested_category_mapping"]["Tops & Bottoms"] == "Apparel"
        assert cr["category_mapping_sources"]["Tops & Bottoms"] == "saved"


# ---------------------------------------------------------------------------
# Confirm endpoint — applies category_mapping
# ---------------------------------------------------------------------------

class TestConfirmWithCategoryMapping:
    """Confirm endpoint applies category_mapping before royalty calculation."""

    @pytest.mark.asyncio
    async def test_confirm_with_category_mapping_calculates_correct_royalties(self):
        """
        When category_mapping is provided, report categories are resolved to
        contract categories before royalty calculation.

        Tops & Bottoms -> Apparel (10%), Hard Accessories -> Accessories (12%)
        Net sales: 50000 Apparel + 30000 Accessories = 5000 + 3600 = 8600
        """
        rows = [
            ["Product Category", "Net Sales"],
            ["Tops & Bottoms", 50000],
            ["Hard Accessories", 30000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {
            "Product Category": "product_category",
            "Net Sales": "net_sales",
        }
        category_mapping = {
            "Tops & Bottoms": "Apparel",
            "Hard Accessories": "Accessories",
        }

        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Accessories": "12%", "Footwear": "8%"}
        )
        inserted_period = _make_db_sales_period(
            net_sales="80000",
            royalty_calculated="8600",
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            mock_upsert_result = MagicMock()
            mock_upsert_result.execute.return_value = Mock(data=[{}])
            mock_mapping_t = MagicMock()
            mock_mapping_t.upsert.return_value = mock_upsert_result

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "sales_periods":
                    return _mock_periods_table(inserted_period)
                if name == "licensee_column_mappings":
                    return mock_mapping_t
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=True,
                category_mapping=category_mapping,
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert result.net_sales == Decimal("80000")
        # Royalty: 50000 * 10% + 30000 * 12% = 5000 + 3600 = 8600
        assert result.royalty_calculated == Decimal("8600")

    @pytest.mark.asyncio
    async def test_confirm_without_category_mapping_raises_on_unknown_category(self):
        """
        Without a category_mapping for a category-rate contract with unresolvable
        categories, a 400 error is raised.
        """
        rows = [
            ["Product Category", "Net Sales"],
            ["Tops & Bottoms", 50000],  # not in contract, not matchable by substring
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {
            "Product Category": "product_category",
            "Net Sales": "net_sales",
        }
        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Accessories": "12%"}
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            from fastapi import HTTPException
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
                # No category_mapping provided — "Tops & Bottoms" can't be resolved
            )

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=request,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "unknown_category"

    @pytest.mark.asyncio
    async def test_confirm_flat_rate_unaffected_by_category_mapping(self):
        """Flat-rate contracts are completely unaffected — category_mapping is ignored."""
        rows = [
            ["Net Sales"],
            [100000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {"Net Sales": "net_sales"}
        contract = _make_db_contract(royalty_rate="8%")
        inserted_period = _make_db_sales_period(
            net_sales="100000",
            royalty_calculated="8000",
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            mock_upsert_result = MagicMock()
            mock_upsert_result.execute.return_value = Mock(data=[{}])
            mock_mapping_t = MagicMock()
            mock_mapping_t.upsert.return_value = mock_upsert_result

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "sales_periods":
                    return _mock_periods_table(inserted_period)
                if name == "licensee_column_mappings":
                    return mock_mapping_t
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=True,
                # Passing category_mapping on a flat-rate contract should be ignored
                category_mapping={"SomeCat": "OtherCat"},
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert result.royalty_calculated == Decimal("8000")

    @pytest.mark.asyncio
    async def test_confirm_category_excluded_from_calculation(self):
        """
        When a category is mapped to None (excluded), its sales are excluded
        from royalty calculation but net_sales still includes them.
        """
        rows = [
            ["Product Category", "Net Sales"],
            ["Footwear", 20000],
            ["Electronics", 10000],  # excluded
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {
            "Product Category": "product_category",
            "Net Sales": "net_sales",
        }
        # Electronics mapped to None (exclude from calculation)
        category_mapping = {
            "Footwear": "Footwear",
            "Electronics": None,
        }

        contract = _make_db_contract(
            royalty_rate={"Footwear": "8%"}
        )
        # Royalty: 20000 * 8% = 1600 (Electronics excluded)
        inserted_period = _make_db_sales_period(
            net_sales="30000",
            royalty_calculated="1600",
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            mock_upsert_result = MagicMock()
            mock_upsert_result.execute.return_value = Mock(data=[{}])
            mock_mapping_t = MagicMock()
            mock_mapping_t.upsert.return_value = mock_upsert_result

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "sales_periods":
                    return _mock_periods_table(inserted_period)
                if name == "licensee_column_mappings":
                    return mock_mapping_t
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
                category_mapping=category_mapping,
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # Electronics was excluded so royalty is only on Footwear
        assert result.royalty_calculated == Decimal("1600")


# ---------------------------------------------------------------------------
# Save category aliases
# ---------------------------------------------------------------------------

class TestSaveCategoryAliases:
    """Aliases are saved to licensee_column_mappings.category_mapping on confirm."""

    @pytest.mark.asyncio
    async def test_save_mapping_true_persists_category_mapping(self):
        """When save_mapping=True, category_mapping is upserted alongside column_mapping."""
        rows = [
            ["Product Category", "Net Sales"],
            ["Tops & Bottoms", 50000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {
            "Product Category": "product_category",
            "Net Sales": "net_sales",
        }
        category_mapping = {"Tops & Bottoms": "Apparel"}

        contract = _make_db_contract(
            royalty_rate={"Apparel": "10%", "Footwear": "8%"}
        )
        inserted_period = _make_db_sales_period(
            net_sales="50000",
            royalty_calculated="5000",
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            upsert_calls = []

            mock_upsert_result = MagicMock()
            mock_upsert_result.execute.return_value = Mock(data=[{}])
            mock_mapping_t = MagicMock()

            def capture_upsert(data, **kwargs):
                upsert_calls.append(data)
                return mock_upsert_result

            mock_mapping_t.upsert.side_effect = capture_upsert

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "sales_periods":
                    return _mock_periods_table(inserted_period)
                if name == "licensee_column_mappings":
                    return mock_mapping_t
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=True,
                category_mapping=category_mapping,
            )

            await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert len(upsert_calls) == 1
        saved = upsert_calls[0]
        assert saved.get("category_mapping") == category_mapping

    @pytest.mark.asyncio
    async def test_save_mapping_false_does_not_persist_category_mapping(self):
        """When save_mapping=False, category_mapping is NOT saved."""
        rows = [
            ["Product Category", "Net Sales"],
            ["Footwear", 20000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        column_mapping = {
            "Product Category": "product_category",
            "Net Sales": "net_sales",
        }
        category_mapping = {"Footwear": "Footwear"}

        contract = _make_db_contract(
            royalty_rate={"Footwear": "8%"}
        )
        inserted_period = _make_db_sales_period(
            net_sales="20000",
            royalty_calculated="1600",
        )

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry
            from app.services.spreadsheet_parser import parse_upload
            import uuid
            upload_id = str(uuid.uuid4())
            parsed = parse_upload(xlsx_bytes, "report.xlsx")
            _upload_store[upload_id] = _UploadEntry(
                parsed=parsed,
                contract_id="contract-123",
                user_id="user-123",
            )

            mock_mapping_t = MagicMock()

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "sales_periods":
                    return _mock_periods_table(inserted_period)
                if name == "licensee_column_mappings":
                    return mock_mapping_t
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping=column_mapping,
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
                category_mapping=category_mapping,
            )

            await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # upsert should NOT have been called
        assert not mock_mapping_t.upsert.called
