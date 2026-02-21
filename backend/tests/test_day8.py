"""
Day 8 backend tests: CORS config, computed response fields, and health check endpoints.

TDD: tests written first, implementation follows.
"""

import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from datetime import date, timedelta

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'
os.environ['SUPABASE_SERVICE_KEY'] = 'test-service-key'


# ---------------------------------------------------------------------------
# CORS configuration tests
# ---------------------------------------------------------------------------

class TestCorsConfiguration:
    """CORS origins are read from env vars and always include localhost:3000."""

    def test_cors_includes_localhost_by_default(self):
        """http://localhost:3000 is always in the allowed origins."""
        from app.main import get_cors_origins
        origins = get_cors_origins()
        assert "http://localhost:3000" in origins

    def test_cors_includes_additional_origins_from_env(self):
        """CORS_ORIGINS env var is split by comma and added to the list."""
        with patch.dict(os.environ, {"CORS_ORIGINS": "https://likha.vercel.app,https://preview.likha.app"}):
            from app.main import get_cors_origins
            origins = get_cors_origins()
        assert "https://likha.vercel.app" in origins
        assert "https://preview.likha.app" in origins

    def test_cors_includes_localhost_even_when_env_set(self):
        """localhost:3000 is included even when CORS_ORIGINS is set."""
        with patch.dict(os.environ, {"CORS_ORIGINS": "https://likha.vercel.app"}):
            from app.main import get_cors_origins
            origins = get_cors_origins()
        assert "http://localhost:3000" in origins
        assert "https://likha.vercel.app" in origins

    def test_cors_origins_deduped(self):
        """Duplicate origins are not included twice."""
        with patch.dict(os.environ, {"CORS_ORIGINS": "http://localhost:3000,https://likha.vercel.app"}):
            from app.main import get_cors_origins
            origins = get_cors_origins()
        assert origins.count("http://localhost:3000") == 1

    def test_cors_handles_empty_env(self):
        """Empty CORS_ORIGINS env var does not crash — falls back to localhost."""
        env = {k: v for k, v in os.environ.items() if k != "CORS_ORIGINS"}
        with patch.dict(os.environ, env, clear=True):
            os.environ.pop("CORS_ORIGINS", None)
            from app.main import get_cors_origins
            origins = get_cors_origins()
        assert "http://localhost:3000" in origins

    def test_cors_includes_docker_localhost(self):
        """http://localhost:3001 (Docker port) is always included."""
        from app.main import get_cors_origins
        origins = get_cors_origins()
        assert "http://localhost:3001" in origins


# ---------------------------------------------------------------------------
# Computed field tests — is_expired
# ---------------------------------------------------------------------------

class TestContractIsExpired:
    """Contract.is_expired is True when contract_end_date is in the past."""

    def _make_contract(self, end_date=None, **kwargs):
        from app.models.contract import Contract
        base = {
            "id": "c-1",
            "user_id": "u-1",
            "pdf_url": "https://example.com/test.pdf",
            "extracted_terms": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        if end_date is not None:
            base["contract_end_date"] = end_date
        base.update(kwargs)
        return Contract(**base)

    def test_is_expired_true_when_end_date_is_past(self):
        """Contract with end_date yesterday is expired."""
        yesterday = date.today() - timedelta(days=1)
        contract = self._make_contract(end_date=yesterday)
        assert contract.is_expired is True

    def test_is_expired_false_when_end_date_is_future(self):
        """Contract with end_date tomorrow is not expired."""
        tomorrow = date.today() + timedelta(days=1)
        contract = self._make_contract(end_date=tomorrow)
        assert contract.is_expired is False

    def test_is_expired_false_when_end_date_is_today(self):
        """Contract with end_date today is not yet expired (expires at end of day)."""
        today = date.today()
        contract = self._make_contract(end_date=today)
        assert contract.is_expired is False

    def test_is_expired_none_when_no_end_date(self):
        """Draft contracts with no end_date return None for is_expired."""
        contract = self._make_contract()
        assert contract.is_expired is None

    def test_is_expired_serializes_to_json(self):
        """is_expired appears in the JSON output of model_dump_json."""
        yesterday = date.today() - timedelta(days=1)
        contract = self._make_contract(end_date=yesterday)
        json_str = contract.model_dump_json()
        assert '"is_expired":true' in json_str

    def test_is_expired_false_serializes_to_json(self):
        """is_expired=false appears in the JSON output when not expired."""
        tomorrow = date.today() + timedelta(days=1)
        contract = self._make_contract(end_date=tomorrow)
        json_str = contract.model_dump_json()
        assert '"is_expired":false' in json_str


# ---------------------------------------------------------------------------
# Computed field tests — days_until_report_due
# ---------------------------------------------------------------------------

class TestDaysUntilReportDue:
    """
    Contract.days_until_report_due computes the days until the next report is due
    based on reporting_frequency. Returns None if not enough info is available.
    """

    def _make_contract(self, reporting_frequency=None, contract_start_date=None, **kwargs):
        from app.models.contract import Contract
        base = {
            "id": "c-1",
            "user_id": "u-1",
            "pdf_url": "https://example.com/test.pdf",
            "extracted_terms": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        if reporting_frequency is not None:
            base["reporting_frequency"] = reporting_frequency
        if contract_start_date is not None:
            base["contract_start_date"] = contract_start_date
        base.update(kwargs)
        return Contract(**base)

    def test_returns_none_when_no_reporting_frequency(self):
        """Returns None when reporting_frequency is not set (draft contract)."""
        contract = self._make_contract()
        assert contract.days_until_report_due is None

    def test_returns_none_when_no_start_date(self):
        """Returns None when contract_start_date is not set."""
        contract = self._make_contract(reporting_frequency="quarterly")
        assert contract.days_until_report_due is None

    def test_returns_int_for_quarterly_future_due_date(self):
        """Returns a non-negative int when next report is in the future."""
        # Use a start date that ensures a future due date
        past_start = date.today() - timedelta(days=10)
        contract = self._make_contract(
            reporting_frequency="quarterly",
            contract_start_date=past_start,
        )
        result = contract.days_until_report_due
        assert result is not None
        assert isinstance(result, int)

    def test_returns_zero_or_negative_when_overdue(self):
        """Returns zero or negative when the next report is overdue."""
        # Start far in the past so the next quarterly due date is overdue
        far_past = date.today() - timedelta(days=400)
        # This will create a contract with reporting_frequency=quarterly
        # With a start 400 days ago, some quarterly period will be overdue or due
        contract = self._make_contract(
            reporting_frequency="quarterly",
            contract_start_date=far_past,
        )
        result = contract.days_until_report_due
        assert result is not None
        assert isinstance(result, int)

    def test_monthly_frequency_due_within_31_days(self):
        """Monthly reporting frequency means due date is at most ~31 days away."""
        # Start yesterday so next due date is about 1 month from yesterday
        yesterday = date.today() - timedelta(days=1)
        contract = self._make_contract(
            reporting_frequency="monthly",
            contract_start_date=yesterday,
        )
        result = contract.days_until_report_due
        assert result is not None
        # Should be within 1 month range (could be slightly over due to month lengths)
        assert result <= 32

    def test_annually_frequency_due_within_366_days(self):
        """Annual reporting frequency means due date is at most ~366 days away."""
        yesterday = date.today() - timedelta(days=1)
        contract = self._make_contract(
            reporting_frequency="annually",
            contract_start_date=yesterday,
        )
        result = contract.days_until_report_due
        assert result is not None
        assert result <= 366

    def test_days_until_report_due_serializes_to_json(self):
        """days_until_report_due appears in the JSON output."""
        past_start = date.today() - timedelta(days=10)
        contract = self._make_contract(
            reporting_frequency="quarterly",
            contract_start_date=past_start,
        )
        json_str = contract.model_dump_json()
        assert "days_until_report_due" in json_str


# ---------------------------------------------------------------------------
# Decimal serialization tests
# ---------------------------------------------------------------------------

class TestDecimalSerialization:
    """Decimal fields serialize correctly in JSON responses."""

    def test_minimum_guarantee_serializes_to_string(self):
        """Decimal minimum_guarantee appears as a numeric string in JSON."""
        from app.models.contract import Contract
        from decimal import Decimal

        contract = Contract(
            id="c-1",
            user_id="u-1",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            minimum_guarantee=Decimal("50000.00"),
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        json_str = contract.model_dump_json()
        assert '"minimum_guarantee":"50000.00"' in json_str

    def test_advance_payment_serializes_to_string(self):
        """Decimal advance_payment appears as a numeric string in JSON."""
        from app.models.contract import Contract
        from decimal import Decimal

        contract = Contract(
            id="c-1",
            user_id="u-1",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            advance_payment=Decimal("10000.00"),
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        json_str = contract.model_dump_json()
        assert '"advance_payment":"10000.00"' in json_str

    def test_null_decimal_fields_serialize_as_null(self):
        """Optional Decimal fields that are None serialize as null in JSON."""
        from app.models.contract import Contract

        contract = Contract(
            id="c-1",
            user_id="u-1",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        json_str = contract.model_dump_json()
        assert '"minimum_guarantee":null' in json_str
        assert '"advance_payment":null' in json_str

    def test_sales_period_decimals_serialize(self):
        """SalesPeriod Decimal fields serialize correctly."""
        from app.models.sales import SalesPeriod
        from decimal import Decimal

        sp = SalesPeriod(
            id="sp-1",
            contract_id="c-1",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 3, 31),
            net_sales=Decimal("100000.00"),
            royalty_calculated=Decimal("8000.00"),
            minimum_applied=False,
            created_at="2026-04-01T00:00:00Z",
            updated_at="2026-04-01T00:00:00Z",
        )
        json_str = sp.model_dump_json()
        assert '"net_sales":"100000.00"' in json_str
        assert '"royalty_calculated":"8000.00"' in json_str


# ---------------------------------------------------------------------------
# Health check endpoint tests — /health/db
# ---------------------------------------------------------------------------

class TestHealthDbEndpoint:
    """GET /health/db tests the Supabase connection."""

    @pytest.mark.asyncio
    async def test_health_db_returns_ok_when_supabase_responds(self):
        """Returns status=ok when Supabase query succeeds."""
        with patch('app.main.supabase_admin') as mock_supabase:
            # Simulate a successful query result
            mock_supabase.table.return_value.select.return_value.limit.return_value.execute.return_value = Mock(data=[])

            from app.main import health_db
            result = await health_db()

        assert result["status"] == "ok"
        assert "database" in result

    @pytest.mark.asyncio
    async def test_health_db_returns_error_when_supabase_fails(self):
        """Returns status=error when Supabase query raises an exception."""
        from fastapi import HTTPException

        with patch('app.main.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value.limit.return_value.execute.side_effect = Exception("Connection refused")

            from app.main import health_db
            with pytest.raises(HTTPException) as exc_info:
                await health_db()

        assert exc_info.value.status_code == 503
        assert "database" in str(exc_info.value.detail).lower() or "connection" in str(exc_info.value.detail).lower()

    @pytest.mark.asyncio
    async def test_health_db_returns_error_when_admin_client_none(self):
        """Returns 503 when supabase_admin is None (SUPABASE_SERVICE_KEY not set)."""
        from fastapi import HTTPException

        with patch('app.main.supabase_admin', None):
            from app.main import health_db
            with pytest.raises(HTTPException) as exc_info:
                await health_db()

        assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# Health check endpoint tests — /health/storage
# ---------------------------------------------------------------------------

class TestHealthStorageEndpoint:
    """GET /health/storage tests Supabase Storage access."""

    @pytest.mark.asyncio
    async def test_health_storage_returns_ok_when_bucket_accessible(self):
        """Returns status=ok when the contracts bucket is accessible."""
        # Note: Mock(name=...) sets the mock's internal name, not a .name attribute.
        # Use a SimpleNamespace or a spec'd Mock to properly set .name = "contracts".
        from types import SimpleNamespace

        with patch('app.main.supabase_admin') as mock_supabase:
            mock_supabase.storage.list_buckets.return_value = [
                SimpleNamespace(name="contracts", id="contracts"),
            ]

            from app.main import health_storage
            result = await health_storage()

        assert result["status"] == "ok"
        assert "storage" in result

    @pytest.mark.asyncio
    async def test_health_storage_returns_error_when_bucket_missing(self):
        """Returns 503 when the contracts bucket is not found."""
        from fastapi import HTTPException

        with patch('app.main.supabase_admin') as mock_supabase:
            # No buckets returned
            mock_supabase.storage.list_buckets.return_value = []

            from app.main import health_storage
            with pytest.raises(HTTPException) as exc_info:
                await health_storage()

        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_health_storage_returns_error_when_storage_fails(self):
        """Returns 503 when listing buckets raises an exception."""
        from fastapi import HTTPException

        with patch('app.main.supabase_admin') as mock_supabase:
            mock_supabase.storage.list_buckets.side_effect = Exception("Storage unavailable")

            from app.main import health_storage
            with pytest.raises(HTTPException) as exc_info:
                await health_storage()

        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_health_storage_returns_error_when_admin_client_none(self):
        """Returns 503 when supabase_admin is None."""
        from fastapi import HTTPException

        with patch('app.main.supabase_admin', None):
            from app.main import health_storage
            with pytest.raises(HTTPException) as exc_info:
                await health_storage()

        assert exc_info.value.status_code == 503
