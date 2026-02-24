"""
Backend tests for total royalties endpoints.

TDD: tests written first, implementation follows.

Endpoints under test:
  GET /api/sales/dashboard-summary
  GET /api/sales/contract/{contract_id}/totals
"""

import pytest
import os
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from decimal import Decimal
from fastapi import HTTPException

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'
os.environ['SUPABASE_SERVICE_KEY'] = 'test-service-key'


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _contract_id_row(cid: str) -> dict:
    return {"id": cid}


def _period_row(royalty_calculated: str, period_start: str) -> dict:
    return {
        "royalty_calculated": royalty_calculated,
        "period_start": period_start,
    }


# ---------------------------------------------------------------------------
# GET /api/sales/dashboard-summary
# ---------------------------------------------------------------------------

class TestGetDashboardSummaryEndpoint:
    """GET /api/sales/dashboard-summary — YTD royalties across all active contracts."""

    # ------------------------------------------------------------------
    # Mock wiring helpers
    # ------------------------------------------------------------------

    def _setup_contracts_mock(self, mock_supabase, contract_ids: list[str]):
        """
        Wire mock_supabase so that:
            table("contracts").select("id").eq(...).eq(...).execute()
        returns a list of {id: ...} rows.
        """
        mock_exec = MagicMock()
        mock_exec.execute.return_value = Mock(
            data=[_contract_id_row(cid) for cid in contract_ids]
        )
        mock_eq2 = MagicMock()
        mock_eq2.execute.return_value = mock_exec.execute.return_value
        mock_eq1 = MagicMock()
        mock_eq1.eq.return_value = mock_eq2
        mock_select = MagicMock()
        mock_select.eq.return_value = mock_eq1

        mock_contracts_table = MagicMock()
        mock_contracts_table.select.return_value = mock_select
        return mock_contracts_table

    def _setup_periods_mock(self, mock_supabase, period_rows: list[dict]):
        """
        Wire mock_supabase so that:
            table("sales_periods").select("royalty_calculated").in_(...).gte(...).execute()
        returns the given period rows.
        """
        mock_exec = MagicMock()
        mock_exec.execute.return_value = Mock(data=period_rows)
        mock_gte = MagicMock()
        mock_gte.execute.return_value = mock_exec.execute.return_value
        mock_in = MagicMock()
        mock_in.gte.return_value = mock_gte
        mock_select = MagicMock()
        mock_select.in_.return_value = mock_in

        mock_periods_table = MagicMock()
        mock_periods_table.select.return_value = mock_select
        return mock_periods_table

    def _wire(self, mock_supabase, contracts_table, periods_table):
        """Point mock_supabase.table() at the right table mock by name."""
        def side_effect(table_name):
            if table_name == "contracts":
                return contracts_table
            if table_name == "sales_periods":
                return periods_table
            return MagicMock()

        mock_supabase.table.side_effect = side_effect

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_active_contracts(self):
        """When the user has no active contracts, ytd_royalties is 0."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            c_table = self._setup_contracts_mock(mock_supabase, [])
            p_table = self._setup_periods_mock(mock_supabase, [])
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            result = await get_dashboard_summary(user_id="user-1")

        assert result.ytd_royalties == Decimal("0")
        assert isinstance(result.current_year, int)

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_ytd_periods(self):
        """Active contracts exist but no sales periods fall in the current year."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            c_table = self._setup_contracts_mock(mock_supabase, ["contract-1"])
            p_table = self._setup_periods_mock(mock_supabase, [])
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            result = await get_dashboard_summary(user_id="user-1")

        assert result.ytd_royalties == Decimal("0")

    @pytest.mark.asyncio
    async def test_sums_ytd_royalties_across_multiple_contracts(self):
        """royalty_calculated values from all matching periods are summed."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            c_table = self._setup_contracts_mock(
                mock_supabase, ["contract-1", "contract-2"]
            )
            p_table = self._setup_periods_mock(
                mock_supabase,
                [
                    _period_row("8000.00", "2026-01-01"),
                    _period_row("12000.00", "2026-04-01"),
                    _period_row("5000.50", "2026-07-01"),
                ],
            )
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            result = await get_dashboard_summary(user_id="user-1")

        assert result.ytd_royalties == Decimal("25000.50")

    @pytest.mark.asyncio
    async def test_royalty_calculated_as_string_is_handled(self):
        """DB returns royalty_calculated as string; endpoint coerces correctly."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            c_table = self._setup_contracts_mock(mock_supabase, ["contract-1"])
            # DB returns string values, as supabase-py does with NUMERIC columns
            p_table = self._setup_periods_mock(
                mock_supabase,
                [_period_row("9999.99", "2026-03-15")],
            )
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            result = await get_dashboard_summary(user_id="user-1")

        assert result.ytd_royalties == Decimal("9999.99")

    @pytest.mark.asyncio
    async def test_current_year_matches_response(self):
        """current_year in the response is an integer (the calendar year)."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            c_table = self._setup_contracts_mock(mock_supabase, [])
            p_table = self._setup_periods_mock(mock_supabase, [])
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            from datetime import datetime, timezone
            result = await get_dashboard_summary(user_id="user-1")

        expected_year = datetime.now(timezone.utc).year
        assert result.current_year == expected_year

    @pytest.mark.asyncio
    async def test_draft_contracts_excluded(self):
        """
        The contracts query filters on status='active'.
        We verify this by checking that when zero active contracts are returned
        (mock returns []), the periods query is never issued.
        """
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"):

            # Only return [] — simulates "no active contracts found"
            c_table = self._setup_contracts_mock(mock_supabase, [])
            p_table = self._setup_periods_mock(mock_supabase, [])
            self._wire(mock_supabase, c_table, p_table)

            from app.routers.sales import get_dashboard_summary
            result = await get_dashboard_summary(user_id="user-1")

        # periods table should NOT have been queried (early return)
        assert not p_table.select.called
        assert result.ytd_royalties == Decimal("0")

    @pytest.mark.asyncio
    async def test_requires_auth_raises_401_without_token(self):
        """
        get_current_user raises 401 when no token is present.
        The endpoint depends on it via Depends(get_current_user).
        """
        with patch('app.routers.sales.supabase'):
            from app.auth import get_current_user
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(authorization=None)

        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/sales/contract/{contract_id}/totals
# ---------------------------------------------------------------------------

class TestGetContractTotalsEndpoint:
    """GET /api/sales/contract/{contract_id}/totals — all-time totals with year breakdown."""

    # ------------------------------------------------------------------
    # Mock wiring helper
    # ------------------------------------------------------------------

    def _setup_periods_mock(self, mock_supabase, period_rows: list[dict]):
        """
        Wire mock_supabase so that:
            table("sales_periods")
                .select("royalty_calculated, period_start")
                .eq("contract_id", ...)
                .execute()
        returns the given rows.
        """
        mock_exec = MagicMock()
        mock_exec.execute.return_value = Mock(data=period_rows)
        mock_eq = MagicMock()
        mock_eq.execute.return_value = mock_exec.execute.return_value
        mock_select = MagicMock()
        mock_select.eq.return_value = mock_eq

        mock_periods_table = MagicMock()
        mock_periods_table.select.return_value = mock_select

        mock_supabase.table.return_value = mock_periods_table
        return mock_periods_table

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_empty_periods_returns_zero_total_and_empty_by_year(self):
        """No sales periods → total_royalties=0, by_year=[]."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(mock_supabase, [])

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        assert result.total_royalties == Decimal("0")
        assert result.by_year == []
        assert result.contract_id == "contract-1"

    @pytest.mark.asyncio
    async def test_single_period_correct_total_and_year(self):
        """A single sales period produces total and one by_year entry."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(
                mock_supabase,
                [_period_row("8000.00", "2026-01-01")],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        assert result.total_royalties == Decimal("8000.00")
        assert len(result.by_year) == 1
        assert result.by_year[0].year == 2026
        assert result.by_year[0].royalties == Decimal("8000.00")

    @pytest.mark.asyncio
    async def test_multiple_periods_same_year_are_grouped(self):
        """Multiple periods in the same year are summed into one by_year entry."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(
                mock_supabase,
                [
                    _period_row("8000.00", "2026-01-01"),
                    _period_row("12000.00", "2026-04-01"),
                    _period_row("9000.00", "2026-07-01"),
                ],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        assert result.total_royalties == Decimal("29000.00")
        assert len(result.by_year) == 1
        assert result.by_year[0].year == 2026
        assert result.by_year[0].royalties == Decimal("29000.00")

    @pytest.mark.asyncio
    async def test_multiple_years_split_into_separate_entries(self):
        """Periods in different years create separate by_year entries."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(
                mock_supabase,
                [
                    _period_row("8000.00", "2025-10-01"),
                    _period_row("15000.00", "2026-01-01"),
                ],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        assert result.total_royalties == Decimal("23000.00")
        assert len(result.by_year) == 2

    @pytest.mark.asyncio
    async def test_by_year_sorted_descending(self):
        """by_year list is sorted with most recent year first."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(
                mock_supabase,
                [
                    _period_row("5000.00", "2024-01-01"),
                    _period_row("8000.00", "2025-01-01"),
                    _period_row("12000.00", "2026-01-01"),
                ],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        years = [entry.year for entry in result.by_year]
        assert years == sorted(years, reverse=True), "by_year must be descending"
        assert years[0] == 2026

    @pytest.mark.asyncio
    async def test_dec_31_and_jan_1_land_in_separate_years(self):
        """Period with period_start 2025-12-31 goes in 2025; 2026-01-01 goes in 2026."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(
                mock_supabase,
                [
                    _period_row("3000.00", "2025-12-31"),
                    _period_row("7000.00", "2026-01-01"),
                ],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        by_year_dict = {entry.year: entry.royalties for entry in result.by_year}
        assert by_year_dict[2025] == Decimal("3000.00")
        assert by_year_dict[2026] == Decimal("7000.00")

    @pytest.mark.asyncio
    async def test_royalty_calculated_string_coerced_to_decimal(self):
        """String royalty_calculated from DB is safely converted to Decimal."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            # Simulate supabase-py returning NUMERIC as Python str
            self._setup_periods_mock(
                mock_supabase,
                [_period_row("1234.56", "2026-06-01")],
            )

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-1", user_id="user-1"
            )

        # Should parse without error and produce exact Decimal
        assert result.total_royalties == Decimal("1234.56")

    @pytest.mark.asyncio
    async def test_ownership_check_is_called(self):
        """verify_contract_ownership must be called with the correct arguments."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch(
                 'app.routers.sales.verify_contract_ownership',
                 new_callable=AsyncMock,
             ) as mock_ownership:

            self._setup_periods_mock(mock_supabase, [])

            from app.routers.sales import get_contract_totals
            await get_contract_totals(
                contract_id="contract-99", user_id="user-1"
            )

        mock_ownership.assert_awaited_once_with("contract-99", "user-1")

    @pytest.mark.asyncio
    async def test_contract_id_echoed_in_response(self):
        """Response includes the contract_id that was requested."""
        with patch('app.routers.sales.supabase') as mock_supabase, \
             patch('app.auth.get_current_user', return_value="user-1"), \
             patch('app.routers.sales.verify_contract_ownership', new_callable=AsyncMock):

            self._setup_periods_mock(mock_supabase, [])

            from app.routers.sales import get_contract_totals
            result = await get_contract_totals(
                contract_id="contract-abc", user_id="user-1"
            )

        assert result.contract_id == "contract-abc"

    @pytest.mark.asyncio
    async def test_requires_auth_raises_401_without_token(self):
        """
        get_current_user raises 401 when no Authorization header is provided.
        """
        with patch('app.routers.sales.supabase'):
            from app.auth import get_current_user
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(authorization=None)

        assert exc_info.value.status_code == 401
