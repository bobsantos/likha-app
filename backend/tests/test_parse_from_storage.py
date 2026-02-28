"""
Tests for POST /api/sales/parse-from-storage endpoint.

TDD: tests written before implementation.

The endpoint downloads a file from Supabase Storage and passes it through the
same parsing pipeline as the existing file-upload endpoint, returning the same
UploadPreviewResponse shape so the frontend column mapper works unchanged.

Test cases:
  - Successful parse from storage path returns same shape as upload endpoint
  - Storage file not found → 404
  - Invalid file format (non-spreadsheet bytes) → 400
  - Auth required (no token) → 401
  - Response shape matches existing upload parse response (field presence)
"""

import io
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_xlsx_bytes(rows: list[list]) -> bytes:
    """Build an in-memory xlsx file from a list-of-lists."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _make_csv_bytes(rows: list[list]) -> bytes:
    """Build in-memory CSV bytes from a list-of-lists."""
    import csv
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    licensee_name="Sunrise Apparel Co.",
    royalty_rate="8%",
):
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": "active",
        "filename": "test.pdf",
        "licensee_name": licensee_name,
        "pdf_url": "https://test.supabase.co/storage/test.pdf",
        "extracted_terms": {},
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2025-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": "0",
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/test.pdf",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    }


def _mock_contract_query(contract_data):
    """Return a mock table object that satisfies .select().eq().execute()."""
    mock_exec = MagicMock()
    mock_exec.execute.return_value = Mock(data=[contract_data])
    mock_eq = MagicMock()
    mock_eq.eq.return_value = mock_exec
    mock_select = MagicMock()
    mock_select.select.return_value = mock_eq
    return mock_select


def _mock_mapping_query(mapping_data=None):
    """Return a mock table for licensee_column_mappings."""
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


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

class TestParseFromStorageSuccess:
    """POST /api/sales/parse-from-storage — successful parses."""

    @pytest.mark.asyncio
    async def test_returns_same_shape_as_upload_endpoint(self):
        """
        Successful parse from a storage path returns the same response shape
        as the existing POST /upload/{contract_id} endpoint.

        Required top-level keys: upload_id, filename, total_rows, data_rows,
        detected_columns, sample_rows, suggested_mapping, mapping_source,
        mapping_sources, period_start, period_end.
        """
        rows = [
            ["Product", "Net Sales", "Royalty Due"],
            ["Apparel", 10000, 800],
            ["Accessories", 5000, 400],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

        # Simulate storage returning the xlsx bytes
        mock_storage_download = MagicMock(return_value=xlsx_bytes)

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            # Mock the storage download on the admin client
            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/report.xlsx",
                    contract_id="contract-123",
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                ),
                user_id="user-123",
            )

        # Verify required fields are present (same shape as upload endpoint)
        assert "upload_id" in result
        assert result["upload_id"] is not None
        assert "filename" in result
        assert "total_rows" in result
        assert "data_rows" in result
        assert "detected_columns" in result
        assert "sample_rows" in result
        assert "suggested_mapping" in result
        assert "mapping_source" in result
        assert "mapping_sources" in result
        assert result["period_start"] == "2025-01-01"
        assert result["period_end"] == "2025-03-31"

    @pytest.mark.asyncio
    async def test_detected_columns_match_spreadsheet_headers(self):
        """Column names from the spreadsheet appear in detected_columns."""
        rows = [
            ["SKU", "Category", "Net Sales"],
            ["APP-001", "Apparel", 12000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect
            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/report.xlsx",
                    contract_id="contract-123",
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                ),
                user_id="user-123",
            )

        assert "SKU" in result["detected_columns"]
        assert "Net Sales" in result["detected_columns"]

    @pytest.mark.asyncio
    async def test_csv_file_parses_successfully(self):
        """CSV files stored in Supabase Storage are parsed correctly."""
        rows = [
            ["Product", "Net Sales"],
            ["Apparel", "10000"],
            ["Accessories", "5000"],
        ]
        csv_bytes = _make_csv_bytes(rows)
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect
            mock_admin.storage.from_.return_value.download.return_value = csv_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/report.csv",
                    contract_id="contract-123",
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                ),
                user_id="user-123",
            )

        assert "upload_id" in result
        assert "Product" in result["detected_columns"]

    @pytest.mark.asyncio
    async def test_filename_derived_from_storage_path(self):
        """The filename in the response is derived from the tail of storage_path."""
        rows = [
            ["Net Sales"],
            [50000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect
            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/Q1_2025_royalty_report.xlsx",
                    contract_id="contract-123",
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                ),
                user_id="user-123",
            )

        assert result["filename"] == "Q1_2025_royalty_report.xlsx"

    @pytest.mark.asyncio
    async def test_period_dates_default_to_empty_string_when_not_provided(self):
        """
        period_start and period_end are optional in the request.
        When omitted they default to empty string in the response.
        """
        rows = [["Net Sales"], [50000]]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect
            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/report.xlsx",
                    contract_id="contract-123",
                ),
                user_id="user-123",
            )

        assert result["period_start"] == ""
        assert result["period_end"] == ""


# ---------------------------------------------------------------------------
# Error-case tests
# ---------------------------------------------------------------------------

class TestParseFromStorageErrors:
    """Error paths for POST /api/sales/parse-from-storage."""

    @pytest.mark.asyncio
    async def test_storage_file_not_found_raises_404(self):
        """
        When Supabase Storage raises a StorageException (or any exception
        indicating the object does not exist), the endpoint returns 404.
        """
        from fastapi import HTTPException

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            # Simulate storage download failure (file not found)
            mock_admin.storage.from_.return_value.download.side_effect = Exception(
                "Object not found"
            )

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            with pytest.raises(HTTPException) as exc_info:
                await parse_from_storage(
                    body=ParseFromStorageRequest(
                        storage_path="inbound/user-123/report-abc/missing.xlsx",
                        contract_id="contract-123",
                        period_start="2025-01-01",
                        period_end="2025-03-31",
                    ),
                    user_id="user-123",
                )

            assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_invalid_file_format_raises_400(self):
        """
        When the downloaded bytes are not a valid spreadsheet (e.g. plain text
        or a PDF), the endpoint returns 400.
        """
        from fastapi import HTTPException

        garbage_bytes = b"This is not a spreadsheet"

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            mock_admin.storage.from_.return_value.download.return_value = garbage_bytes

            # Ensure contracts query doesn't blow up before we get to parsing
            contract = _make_db_contract()

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            with pytest.raises(HTTPException) as exc_info:
                await parse_from_storage(
                    body=ParseFromStorageRequest(
                        storage_path="inbound/user-123/report-abc/garbage.txt",
                        contract_id="contract-123",
                        period_start="2025-01-01",
                        period_end="2025-03-31",
                    ),
                    user_id="user-123",
                )

            assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_auth_required(self):
        """
        The endpoint requires authentication. Calling it without a user raises
        HTTPException 401 (enforced by get_current_user dependency).

        We verify this by checking that get_current_user is declared as a
        dependency on the function — the auth check is the same as all other
        protected endpoints.
        """
        import inspect
        from app.routers.sales_upload import parse_from_storage
        from app.auth import get_current_user
        from fastapi import Depends

        # Inspect the function signature to confirm user_id uses Depends(get_current_user)
        sig = inspect.signature(parse_from_storage)
        user_id_param = sig.parameters.get("user_id")
        assert user_id_param is not None, "parse_from_storage must have a user_id parameter"
        # The default should be a fastapi.Depends wrapping get_current_user
        default = user_id_param.default
        assert hasattr(default, "dependency"), (
            "user_id parameter must use Depends(...) for auth"
        )
        assert default.dependency is get_current_user, (
            "user_id must depend on get_current_user"
        )

    @pytest.mark.asyncio
    async def test_contract_not_found_raises_404(self):
        """
        When the contract does not exist, the endpoint returns 404.
        This happens after a successful storage download but before parsing.
        """
        from fastapi import HTTPException

        rows = [["Net Sales"], [50000]]
        xlsx_bytes = _make_xlsx_bytes(rows)

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            # No contract data returned
            mock_exec = MagicMock()
            mock_exec.execute.return_value = Mock(data=[])
            mock_eq = MagicMock()
            mock_eq.eq.return_value = mock_exec
            mock_contracts = MagicMock()
            mock_contracts.select.return_value = mock_eq

            def table_side_effect(name):
                if name == "contracts":
                    return mock_contracts
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            with pytest.raises(HTTPException) as exc_info:
                await parse_from_storage(
                    body=ParseFromStorageRequest(
                        storage_path="inbound/user-123/report-abc/report.xlsx",
                        contract_id="contract-does-not-exist",
                        period_start="2025-01-01",
                        period_end="2025-03-31",
                    ),
                    user_id="user-123",
                )

            assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Response-shape parity test
# ---------------------------------------------------------------------------

class TestParseFromStorageResponseShape:
    """
    Verify that parse-from-storage returns the exact same set of top-level keys
    as the existing upload endpoint, so the frontend UploadPreviewResponse type
    is satisfied without any changes.
    """

    @pytest.mark.asyncio
    async def test_response_has_all_upload_preview_keys(self):
        """
        The response must contain every key returned by POST /upload/{contract_id}.

        Required keys (from UploadPreviewResponse TypeScript type):
          upload_id, filename, sheet_name, total_rows, data_rows,
          detected_columns, sample_rows, suggested_mapping,
          mapping_source, mapping_sources, period_start, period_end,
          category_resolution
        """
        rows = [
            ["Product", "Net Sales", "Royalty Due"],
            ["Apparel", 50000, 4000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.db.supabase_admin") as mock_admin:

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect
            mock_admin.storage.from_.return_value.download.return_value = xlsx_bytes

            from app.routers.sales_upload import parse_from_storage, ParseFromStorageRequest

            result = await parse_from_storage(
                body=ParseFromStorageRequest(
                    storage_path="inbound/user-123/report-abc/report.xlsx",
                    contract_id="contract-123",
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                ),
                user_id="user-123",
            )

        REQUIRED_KEYS = {
            "upload_id",
            "filename",
            "sheet_name",
            "total_rows",
            "data_rows",
            "detected_columns",
            "sample_rows",
            "suggested_mapping",
            "mapping_source",
            "mapping_sources",
            "period_start",
            "period_end",
            "category_resolution",
        }

        missing = REQUIRED_KEYS - set(result.keys())
        assert not missing, f"Response is missing keys: {missing}"
