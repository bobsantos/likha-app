"""
Day 9 backend tests: YTD summary endpoint, minimum guarantee logic, and
advance payment tracking.

TDD: tests written first, implementation follows.
"""

import pytest
import os
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from decimal import Decimal
from datetime import date
from fastapi import HTTPException

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'
os.environ['SUPABASE_SERVICE_KEY'] = 'test-service-key'


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    status="active",
    licensee_name="Nike Inc.",
    royalty_rate="8%",
    minimum_guarantee="0",
    minimum_guarantee_period="annually",
    advance_payment=None,
    contract_start_date="2026-01-01",
    contract_end_date="2026-12-31",
):
    """Return a minimal dict that mimics a Supabase contracts row."""
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": status,
        "filename": "test.pdf",
        "licensee_name": licensee_name,
        "pdf_url": "https://test.supabase.co/storage/test.pdf",
        "extracted_terms": {},
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": contract_start_date,
        "contract_end_date": contract_end_date,
        "minimum_guarantee": minimum_guarantee,
        "minimum_guarantee_period": minimum_guarantee_period,
        "advance_payment": advance_payment,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/test.pdf",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


def _make_db_sales_period(
    period_id="sp-1",
    contract_id="contract-123",
    period_start="2026-01-01",
    period_end="2026-03-31",
    net_sales="100000",
    royalty_calculated="8000",
    minimum_applied=False,
):
    """Return a minimal dict that mimics a Supabase sales_periods row."""
    return {
        "id": period_id,
        "contract_id": contract_id,
        "period_start": period_start,
        "period_end": period_end,
        "net_sales": net_sales,
        "category_breakdown": None,
        "royalty_calculated": royalty_calculated,
        "minimum_applied": minimum_applied,
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# royalty_calc.py — minimum guarantee logic (pure unit tests, no mocking)
# ---------------------------------------------------------------------------

class TestApplyMinimumGuaranteeQuarterly:
    """apply_minimum_guarantee() enforces per-period floor when MG is quarterly."""

    def test_no_minimum_guarantee_returns_calculated(self):
        """When minimum_guarantee is 0, royalty is unchanged."""
        from app.services.royalty_calc import apply_minimum_guarantee
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("5000"),
            minimum_guarantee=Decimal("0"),
            guarantee_period="quarterly",
            periods_in_year=4,
        )
        assert result.royalty == Decimal("5000")
        assert result.minimum_applied is False

    def test_quarterly_minimum_applied_when_below_floor(self):
        """When calculated < quarterly floor, royalty is raised to floor."""
        from app.services.royalty_calc import apply_minimum_guarantee
        # Quarterly minimum = 10000 / 4 = 2500; calculated = 1000
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("1000"),
            minimum_guarantee=Decimal("10000"),
            guarantee_period="quarterly",
            periods_in_year=4,
        )
        assert result.royalty == Decimal("2500")
        assert result.minimum_applied is True

    def test_quarterly_minimum_not_applied_when_above_floor(self):
        """When calculated > quarterly floor, royalty is unchanged."""
        from app.services.royalty_calc import apply_minimum_guarantee
        # Quarterly minimum = 10000 / 4 = 2500; calculated = 5000
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("5000"),
            minimum_guarantee=Decimal("10000"),
            guarantee_period="quarterly",
            periods_in_year=4,
        )
        assert result.royalty == Decimal("5000")
        assert result.minimum_applied is False

    def test_quarterly_minimum_exactly_at_floor_not_flagged(self):
        """When calculated == quarterly floor, minimum_applied is False (no adjustment needed)."""
        from app.services.royalty_calc import apply_minimum_guarantee
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("2500"),
            minimum_guarantee=Decimal("10000"),
            guarantee_period="quarterly",
            periods_in_year=4,
        )
        assert result.royalty == Decimal("2500")
        assert result.minimum_applied is False

    def test_monthly_minimum_divides_by_12(self):
        """Monthly guarantee period divides by 12."""
        from app.services.royalty_calc import apply_minimum_guarantee
        # Monthly minimum = 12000 / 12 = 1000; calculated = 500
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("500"),
            minimum_guarantee=Decimal("12000"),
            guarantee_period="monthly",
            periods_in_year=12,
        )
        assert result.royalty == Decimal("1000")
        assert result.minimum_applied is True

    def test_annually_minimum_applies_full_amount(self):
        """Annual guarantee period uses full guarantee amount (no division)."""
        from app.services.royalty_calc import apply_minimum_guarantee
        # Annual guarantee = 50000; calculated = 30000 → raise to 50000
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("30000"),
            minimum_guarantee=Decimal("50000"),
            guarantee_period="annually",
            periods_in_year=1,
        )
        assert result.royalty == Decimal("50000")
        assert result.minimum_applied is True

    def test_zero_sales_with_quarterly_minimum(self):
        """Zero sales still triggers minimum guarantee."""
        from app.services.royalty_calc import apply_minimum_guarantee
        result = apply_minimum_guarantee(
            calculated_royalty=Decimal("0"),
            minimum_guarantee=Decimal("8000"),
            guarantee_period="quarterly",
            periods_in_year=4,
        )
        assert result.royalty == Decimal("2000")
        assert result.minimum_applied is True


class TestCalculateRoyaltyWithMinimum:
    """calculate_royalty_with_minimum() wraps calculate_royalty + apply_minimum_guarantee."""

    def test_returns_calculated_when_no_minimum(self):
        """No minimum guarantee → same as calculate_royalty."""
        from app.services.royalty_calc import calculate_royalty_with_minimum
        result = calculate_royalty_with_minimum(
            royalty_rate="8%",
            net_sales=Decimal("100000"),
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
        )
        assert result.royalty == Decimal("8000")
        assert result.minimum_applied is False

    def test_minimum_applied_when_below_floor(self):
        """Minimum guarantee is applied when calculated < floor."""
        from app.services.royalty_calc import calculate_royalty_with_minimum
        # 1% of 1000 = 10; quarterly min = 5000/4 = 1250 → apply minimum
        result = calculate_royalty_with_minimum(
            royalty_rate="1%",
            net_sales=Decimal("1000"),
            minimum_guarantee=Decimal("5000"),
            guarantee_period="quarterly",
        )
        assert result.royalty == Decimal("1250")
        assert result.minimum_applied is True

    def test_category_rate_with_minimum(self):
        """Category rates also respect minimum guarantee."""
        from app.services.royalty_calc import calculate_royalty_with_minimum
        rates = {"apparel": "5%"}
        breakdown = {"apparel": Decimal("1000")}
        # Calculated = 50; quarterly min = 2000/4 = 500 → apply minimum
        result = calculate_royalty_with_minimum(
            royalty_rate=rates,
            net_sales=Decimal("1000"),
            category_breakdown=breakdown,
            minimum_guarantee=Decimal("2000"),
            guarantee_period="quarterly",
        )
        assert result.royalty == Decimal("500")
        assert result.minimum_applied is True


# ---------------------------------------------------------------------------
# Advance payment tracking (pure unit tests)
# ---------------------------------------------------------------------------

class TestCalculateAdvanceRemaining:
    """calculate_advance_remaining() tracks advance credit deduction."""

    def test_no_advance_returns_zero(self):
        """No advance payment → remaining is always 0."""
        from app.services.royalty_calc import calculate_advance_remaining
        remaining = calculate_advance_remaining(
            advance_payment=Decimal("0"),
            total_royalties_ytd=Decimal("50000"),
            contract_year=1,
        )
        assert remaining == Decimal("0")

    def test_advance_fully_remaining_when_no_royalties(self):
        """Full advance remains when no royalties have been earned."""
        from app.services.royalty_calc import calculate_advance_remaining
        remaining = calculate_advance_remaining(
            advance_payment=Decimal("10000"),
            total_royalties_ytd=Decimal("0"),
            contract_year=1,
        )
        assert remaining == Decimal("10000")

    def test_advance_partially_credited(self):
        """Advance is partially consumed by royalties earned so far."""
        from app.services.royalty_calc import calculate_advance_remaining
        # $10K advance, $6K royalties earned → $4K still to be credited
        remaining = calculate_advance_remaining(
            advance_payment=Decimal("10000"),
            total_royalties_ytd=Decimal("6000"),
            contract_year=1,
        )
        assert remaining == Decimal("4000")

    def test_advance_fully_credited_returns_zero(self):
        """Once royalties exceed advance, remaining credit is 0 (not negative)."""
        from app.services.royalty_calc import calculate_advance_remaining
        remaining = calculate_advance_remaining(
            advance_payment=Decimal("10000"),
            total_royalties_ytd=Decimal("15000"),
            contract_year=1,
        )
        assert remaining == Decimal("0")

    def test_advance_resets_for_year_2(self):
        """Advance credit only applies to Year 1; Year 2+ returns 0."""
        from app.services.royalty_calc import calculate_advance_remaining
        remaining = calculate_advance_remaining(
            advance_payment=Decimal("10000"),
            total_royalties_ytd=Decimal("3000"),
            contract_year=2,
        )
        assert remaining == Decimal("0")

    def test_advance_none_treated_as_zero(self):
        """None advance_payment is treated as 0."""
        from app.services.royalty_calc import calculate_advance_remaining
        remaining = calculate_advance_remaining(
            advance_payment=None,
            total_royalties_ytd=Decimal("5000"),
            contract_year=1,
        )
        assert remaining == Decimal("0")


# ---------------------------------------------------------------------------
# YTD summary calculation (pure unit tests — no HTTP)
# ---------------------------------------------------------------------------

class TestCalculateYtdSummary:
    """calculate_ytd_summary() aggregates sales_periods into a RoyaltySummary."""

    def test_empty_periods_returns_zero_totals(self):
        """No sales periods → all totals are 0."""
        from app.services.royalty_calc import calculate_ytd_summary
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=[],
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.total_sales_ytd == Decimal("0")
        assert summary.total_royalties_ytd == Decimal("0")
        assert summary.shortfall == Decimal("0")
        assert summary.advance_remaining == Decimal("0")

    def test_single_period_sums_correctly(self):
        """A single sales period is summed into the YTD totals."""
        from app.services.royalty_calc import calculate_ytd_summary
        period = _make_db_sales_period(
            net_sales="100000",
            royalty_calculated="8000",
        )
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=[period],
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.total_sales_ytd == Decimal("100000")
        assert summary.total_royalties_ytd == Decimal("8000")

    def test_multiple_periods_summed(self):
        """Multiple sales periods are correctly aggregated."""
        from app.services.royalty_calc import calculate_ytd_summary
        periods = [
            _make_db_sales_period(period_id="sp-1", net_sales="100000", royalty_calculated="8000"),
            _make_db_sales_period(period_id="sp-2", net_sales="150000", royalty_calculated="12000"),
            _make_db_sales_period(period_id="sp-3", net_sales="200000", royalty_calculated="16000"),
        ]
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=periods,
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.total_sales_ytd == Decimal("450000")
        assert summary.total_royalties_ytd == Decimal("36000")

    def test_shortfall_calculated_when_below_minimum(self):
        """shortfall is positive when total royalties < annual minimum guarantee."""
        from app.services.royalty_calc import calculate_ytd_summary
        period = _make_db_sales_period(net_sales="100000", royalty_calculated="8000")
        # Annual minimum = 50000, earned = 8000 → shortfall = 42000
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=[period],
            minimum_guarantee=Decimal("50000"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.minimum_guarantee_ytd == Decimal("50000")
        assert summary.shortfall == Decimal("42000")

    def test_shortfall_is_zero_when_above_minimum(self):
        """shortfall is 0 when total royalties meet or exceed minimum guarantee."""
        from app.services.royalty_calc import calculate_ytd_summary
        period = _make_db_sales_period(net_sales="1000000", royalty_calculated="80000")
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=[period],
            minimum_guarantee=Decimal("50000"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.shortfall == Decimal("0")

    def test_advance_remaining_tracked_in_year_1(self):
        """Advance credit is deducted from royalties in Year 1."""
        from app.services.royalty_calc import calculate_ytd_summary
        period = _make_db_sales_period(net_sales="100000", royalty_calculated="8000")
        # Advance = 10000, earned so far = 8000 → remaining = 2000
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=1,
            sales_periods=[period],
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=Decimal("10000"),
        )
        assert summary.advance_remaining == Decimal("2000")

    def test_advance_remaining_zero_in_year_2(self):
        """Advance credit is not applied in Year 2+."""
        from app.services.royalty_calc import calculate_ytd_summary
        period = _make_db_sales_period(net_sales="100000", royalty_calculated="8000")
        summary = calculate_ytd_summary(
            contract_id="c-1",
            contract_year=2,
            sales_periods=[period],
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=Decimal("10000"),
        )
        assert summary.advance_remaining == Decimal("0")

    def test_contract_id_and_year_populated(self):
        """Summary includes the contract_id and contract_year."""
        from app.services.royalty_calc import calculate_ytd_summary
        summary = calculate_ytd_summary(
            contract_id="contract-xyz",
            contract_year=2,
            sales_periods=[],
            minimum_guarantee=Decimal("0"),
            guarantee_period="annually",
            advance_payment=None,
        )
        assert summary.contract_id == "contract-xyz"
        assert summary.contract_year == 2


# ---------------------------------------------------------------------------
# GET /api/sales/summary/{contract_id} — HTTP endpoint tests
# ---------------------------------------------------------------------------

class TestGetRoyaltySummaryEndpoint:
    """GET /api/sales/summary/{contract_id} returns a RoyaltySummary."""

    def _setup_mocks(self, mock_supabase, contract_data, sales_periods_data):
        """Configure the supabase mock to return contract + sales period data."""
        # Chain: table("contracts").select("*").eq("id", ...).execute()
        mock_contracts_query = MagicMock()
        mock_contracts_query.execute.return_value = Mock(data=[contract_data])
        mock_contracts_select = MagicMock()
        mock_contracts_select.eq.return_value = mock_contracts_query
        mock_contracts_table = MagicMock()
        mock_contracts_table.select.return_value = mock_contracts_select

        # Chain: table("sales_periods").select("*").eq("contract_id", ...).execute()
        mock_periods_query = MagicMock()
        mock_periods_query.execute.return_value = Mock(data=sales_periods_data)
        mock_periods_select = MagicMock()
        mock_periods_select.eq.return_value = mock_periods_query
        mock_periods_table = MagicMock()
        mock_periods_table.select.return_value = mock_periods_select

        def side_effect(table_name):
            if table_name == "contracts":
                return mock_contracts_table
            elif table_name == "sales_periods":
                return mock_periods_table
            return MagicMock()

        mock_supabase.table.side_effect = side_effect

    @pytest.mark.asyncio
    async def test_returns_summary_with_zero_minimum(self):
        """Returns a complete RoyaltySummary for a contract with no minimum guarantee."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                contract_id="contract-123",
                user_id="user-123",
                minimum_guarantee="0",
                advance_payment=None,
            )
            periods = [
                _make_db_sales_period(
                    period_id="sp-1",
                    contract_id="contract-123",
                    net_sales="100000",
                    royalty_calculated="8000",
                ),
            ]
            self._setup_mocks(mock_supabase, contract, periods)

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        assert result.contract_id == "contract-123"
        assert result.contract_year == 1
        assert result.total_sales_ytd == Decimal("100000")
        assert result.total_royalties_ytd == Decimal("8000")
        assert result.minimum_guarantee_ytd == Decimal("0")
        assert result.shortfall == Decimal("0")
        assert result.advance_remaining == Decimal("0")

    @pytest.mark.asyncio
    async def test_returns_summary_with_annual_minimum_shortfall(self):
        """Returns shortfall when total royalties < annual minimum guarantee."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                minimum_guarantee="50000",
                minimum_guarantee_period="annually",
                advance_payment=None,
            )
            periods = [
                _make_db_sales_period(net_sales="100000", royalty_calculated="8000"),
            ]
            self._setup_mocks(mock_supabase, contract, periods)

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        assert result.minimum_guarantee_ytd == Decimal("50000")
        assert result.shortfall == Decimal("42000")  # 50000 - 8000

    @pytest.mark.asyncio
    async def test_returns_summary_with_advance_remaining(self):
        """Advance remaining is correctly reported in Year 1."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                minimum_guarantee="0",
                advance_payment="10000",
            )
            periods = [
                _make_db_sales_period(net_sales="100000", royalty_calculated="8000"),
            ]
            self._setup_mocks(mock_supabase, contract, periods)

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        # $10K advance - $8K earned = $2K remaining
        assert result.advance_remaining == Decimal("2000")

    @pytest.mark.asyncio
    async def test_returns_zero_advance_remaining_in_year_2(self):
        """Advance credit does not apply in Year 2+."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                minimum_guarantee="0",
                advance_payment="10000",
            )
            periods = [
                _make_db_sales_period(net_sales="100000", royalty_calculated="8000"),
            ]
            self._setup_mocks(mock_supabase, contract, periods)

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=2,
                user_id="user-123",
            )

        assert result.advance_remaining == Decimal("0")

    @pytest.mark.asyncio
    async def test_returns_empty_summary_when_no_periods(self):
        """Returns zero totals when no sales periods exist for the contract."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(minimum_guarantee="0", advance_payment=None)
            self._setup_mocks(mock_supabase, contract, [])

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        assert result.total_sales_ytd == Decimal("0")
        assert result.total_royalties_ytd == Decimal("0")
        assert result.shortfall == Decimal("0")

    @pytest.mark.asyncio
    async def test_raises_404_when_contract_not_found(self):
        """Returns 404 when the contract does not exist."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            # Contract query returns empty data
            mock_query = MagicMock()
            mock_query.execute.return_value = Mock(data=[])
            mock_select = MagicMock()
            mock_select.eq.return_value = mock_query
            mock_table = MagicMock()
            mock_table.select.return_value = mock_select
            mock_supabase.table.return_value = mock_table

            from app.routers.sales import get_royalty_summary
            with pytest.raises(HTTPException) as exc_info:
                await get_royalty_summary(
                    contract_id="nonexistent-id",
                    contract_year=1,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_summary_updated_at_is_populated(self):
        """summary.updated_at is an ISO timestamp string."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(minimum_guarantee="0", advance_payment=None)
            self._setup_mocks(mock_supabase, contract, [])

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        assert result.updated_at is not None
        assert isinstance(result.updated_at, str)
        # Should be a valid ISO timestamp (contains T and Z or +)
        assert "T" in result.updated_at or result.updated_at.count("-") >= 2

    @pytest.mark.asyncio
    async def test_multiple_periods_summed_correctly(self):
        """All sales periods for the contract year are aggregated."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(minimum_guarantee="0", advance_payment=None)
            periods = [
                _make_db_sales_period(period_id="sp-1", net_sales="100000", royalty_calculated="8000"),
                _make_db_sales_period(period_id="sp-2", net_sales="200000", royalty_calculated="16000"),
                _make_db_sales_period(period_id="sp-3", net_sales="150000", royalty_calculated="12000"),
            ]
            self._setup_mocks(mock_supabase, contract, periods)

            from app.routers.sales import get_royalty_summary
            result = await get_royalty_summary(
                contract_id="contract-123",
                contract_year=1,
                user_id="user-123",
            )

        assert result.total_sales_ytd == Decimal("450000")
        assert result.total_royalties_ytd == Decimal("36000")


# ---------------------------------------------------------------------------
# POST /api/sales/ — minimum guarantee applied at period creation
# ---------------------------------------------------------------------------

class TestCreateSalesPeriodWithMinimum:
    """POST /api/sales/ applies minimum guarantee logic when creating a period."""

    def _setup_mocks_for_create(
        self, mock_supabase, contract_data, inserted_period_data
    ):
        """Set up mocks for the create sales period endpoint."""
        # Contracts query
        mock_contract_query = MagicMock()
        mock_contract_query.execute.return_value = Mock(data=[contract_data])
        mock_contract_select = MagicMock()
        mock_contract_select.eq.return_value = mock_contract_query
        mock_contracts_table = MagicMock()
        mock_contracts_table.select.return_value = mock_contract_select

        # Insert returns the inserted period
        mock_insert_result = MagicMock()
        mock_insert_result.execute.return_value = Mock(data=[inserted_period_data])
        mock_periods_insert = MagicMock()
        mock_periods_insert.execute.return_value = Mock(data=[inserted_period_data])
        mock_periods_table = MagicMock()
        mock_periods_table.select.return_value = MagicMock()
        mock_periods_table.insert.return_value = mock_insert_result

        def side_effect(table_name):
            if table_name == "contracts":
                return mock_contracts_table
            elif table_name == "sales_periods":
                return mock_periods_table
            return MagicMock()

        mock_supabase.table.side_effect = side_effect

    @pytest.mark.asyncio
    async def test_minimum_applied_flag_set_when_below_quarterly_floor(self):
        """minimum_applied=True is stored when royalty < quarterly minimum."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                minimum_guarantee="10000",
                minimum_guarantee_period="quarterly",
                advance_payment=None,
            )
            # With 1% rate on $1000 = $10 royalty, quarterly min = 2500 → minimum applied
            inserted = _make_db_sales_period(
                net_sales="1000",
                royalty_calculated="2500",  # floor applied
                minimum_applied=True,
            )
            self._setup_mocks_for_create(mock_supabase, contract, inserted)

            from app.routers.sales import create_sales_period
            from app.models.sales import SalesPeriodCreate

            period_data = SalesPeriodCreate(
                contract_id="contract-123",
                period_start=date(2026, 1, 1),
                period_end=date(2026, 3, 31),
                net_sales=Decimal("1000"),
            )
            # Override royalty_rate so calculation is predictable
            contract["royalty_rate"] = "1%"

            result = await create_sales_period(period=period_data, user_id="user-123")

        # Check that insert was called with minimum_applied=True
        insert_call_kwargs = mock_supabase.table("sales_periods").insert.call_args[0][0]
        assert insert_call_kwargs["minimum_applied"] is True

    @pytest.mark.asyncio
    async def test_minimum_not_applied_when_above_quarterly_floor(self):
        """minimum_applied=False when calculated royalty >= quarterly minimum."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-123"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            contract = _make_db_contract(
                minimum_guarantee="4000",
                minimum_guarantee_period="quarterly",
                advance_payment=None,
            )
            # 8% of 100000 = 8000; quarterly min = 1000 → no minimum applied
            inserted = _make_db_sales_period(
                net_sales="100000",
                royalty_calculated="8000",
                minimum_applied=False,
            )
            self._setup_mocks_for_create(mock_supabase, contract, inserted)

            from app.routers.sales import create_sales_period
            from app.models.sales import SalesPeriodCreate

            period_data = SalesPeriodCreate(
                contract_id="contract-123",
                period_start=date(2026, 1, 1),
                period_end=date(2026, 3, 31),
                net_sales=Decimal("100000"),
            )

            result = await create_sales_period(period=period_data, user_id="user-123")

        insert_call_kwargs = mock_supabase.table("sales_periods").insert.call_args[0][0]
        assert insert_call_kwargs["minimum_applied"] is False
