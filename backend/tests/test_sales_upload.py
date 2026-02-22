"""
Sales upload router tests (Phase 1.1).

Tests mock the Supabase client and in-memory upload store entirely.
No real database or file I/O.

TDD: these tests were written before the implementation.
"""

import io
import os
import pytest
from decimal import Decimal
from unittest.mock import Mock, patch, AsyncMock, MagicMock

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ---------------------------------------------------------------------------
# Helpers for building in-memory files
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


def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    licensee_name="Sunrise Apparel Co.",
    royalty_rate="8%",
    minimum_guarantee="0",
    minimum_guarantee_period="annually",
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
        "minimum_guarantee": minimum_guarantee,
        "minimum_guarantee_period": minimum_guarantee_period,
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/test.pdf",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    }


def _make_db_sales_period(
    period_id="sp-1",
    contract_id="contract-123",
    period_start="2025-01-01",
    period_end="2025-03-31",
    net_sales="100000",
    royalty_calculated="8000",
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


# ---------------------------------------------------------------------------
# Supabase mock helpers
# ---------------------------------------------------------------------------

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
    # Duplicate check chain: .select("id").eq("contract_id",...).eq("period_start",...).execute()
    mock_dupe_exec = MagicMock()
    mock_dupe_exec.execute.return_value = Mock(data=[])

    mock_dupe_chain = MagicMock()
    # Any .eq() call on mock_dupe_chain returns another mock with no data
    mock_dupe_chain.eq.return_value = mock_dupe_exec
    mock_dupe_exec.eq.return_value = mock_dupe_exec  # chain continues with no data

    mock_insert_result = MagicMock()
    mock_insert_result.execute.return_value = Mock(data=[insert_result])

    mock_t = MagicMock()
    mock_t.select.return_value = mock_dupe_chain
    mock_t.insert.return_value = mock_insert_result
    return mock_t


# ---------------------------------------------------------------------------
# POST /api/sales/upload/{contract_id} — upload endpoint
# ---------------------------------------------------------------------------

class TestUploadEndpointReturnsPreview:
    """POST /api/sales/upload/{contract_id} returns a preview response."""

    @pytest.mark.asyncio
    async def test_upload_xlsx_returns_200_with_preview(self):
        rows = [
            ["SKU", "Category", "Net Sales", "Royalty Due"],
            ["APP-001", "Apparel", 12000, 960],
            ["APP-002", "Apparel", 9000, 720],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.auth.get_current_user", return_value="user-123"):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile
            import io as _io

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

        assert result["upload_id"] is not None
        assert "SKU" in result["detected_columns"]
        assert "Net Sales" in result["detected_columns"]
        assert result["data_rows"] == 2
        assert len(result["sample_rows"]) == 2
        assert "suggested_mapping" in result
        assert result["period_start"] == "2025-01-01"
        assert result["period_end"] == "2025-03-31"


class TestUploadEndpointKeywordMapping:
    """Upload endpoint returns suggested mapping from keyword matching when no saved mapping."""

    @pytest.mark.asyncio
    async def test_no_saved_mapping_uses_keywords(self):
        rows = [
            ["Product Category", "Net Sales", "Royalty Due"],
            ["Apparel", 12000, 960],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract()

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

        assert result["mapping_source"] == "suggested"
        assert result["suggested_mapping"]["Net Sales"] == "net_sales"
        assert result["suggested_mapping"]["Product Category"] == "product_category"
        assert result["suggested_mapping"]["Royalty Due"] == "licensee_reported_royalty"


class TestUploadEndpointSavedMapping:
    """Upload endpoint uses saved mapping when one exists for the licensee."""

    @pytest.mark.asyncio
    async def test_saved_mapping_applied_and_source_is_saved(self):
        rows = [
            ["Net Sales Amount", "SKU", "Product Category"],
            [12000, "APP-001", "Apparel"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        contract = _make_db_contract(licensee_name="Sunrise Apparel Co.")

        saved_mapping_row = {
            "id": "map-1",
            "user_id": "user-123",
            "licensee_name": "Sunrise Apparel Co.",
            "column_mapping": {
                "Net Sales Amount": "net_sales",
                "SKU": "ignore",
                "Product Category": "product_category",
            },
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

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

        assert result["mapping_source"] == "saved"
        assert result["suggested_mapping"]["Net Sales Amount"] == "net_sales"
        assert result["suggested_mapping"]["SKU"] == "ignore"


class TestUploadEndpointRejectsUnsupportedType:
    """Upload endpoint returns 400 for unsupported file types."""

    @pytest.mark.asyncio
    async def test_pdf_file_rejected_with_400(self):
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            mock_supabase.table.return_value = _mock_contract_query(mock_supabase, contract)

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile, HTTPException

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.pdf"
            upload_file_mock.read = AsyncMock(return_value=b"%PDF-1.4")
            upload_file_mock.size = 100

            with pytest.raises(HTTPException) as exc_info:
                await upload_file(
                    contract_id="contract-123",
                    file=upload_file_mock,
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "unsupported_file_type"


class TestUploadEndpointRejectsOversizedFile:
    """Upload endpoint returns 400 when file exceeds 10 MB."""

    @pytest.mark.asyncio
    async def test_oversized_file_rejected_with_400(self):
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            mock_supabase.table.return_value = _mock_contract_query(mock_supabase, contract)

            from app.routers.sales_upload import upload_file
            from fastapi import UploadFile, HTTPException

            upload_file_mock = MagicMock(spec=UploadFile)
            upload_file_mock.filename = "report.xlsx"
            upload_file_mock.size = 11 * 1024 * 1024  # 11 MB
            upload_file_mock.read = AsyncMock(return_value=b"x" * (11 * 1024 * 1024))

            with pytest.raises(HTTPException) as exc_info:
                await upload_file(
                    contract_id="contract-123",
                    file=upload_file_mock,
                    period_start="2025-01-01",
                    period_end="2025-03-31",
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "file_too_large"


class TestUploadEndpointRequiresAuth:
    """Upload endpoint returns 401 when no auth token is provided."""

    @pytest.mark.asyncio
    async def test_no_auth_returns_401(self):
        from fastapi import HTTPException
        from app.auth import get_current_user

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization=None)

        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/sales/upload/{contract_id}/confirm — confirm endpoint
# ---------------------------------------------------------------------------

class TestConfirmEndpointCreatesSalesPeriod:
    """POST confirm endpoint creates a sales period with correct values."""

    @pytest.mark.asyncio
    async def test_confirm_creates_period_and_returns_201_shape(self):
        rows = [
            ["SKU", "Net Sales", "Royalty Due"],
            ["APP-001", 50000, 4000],
            ["APP-002", 50000, 4000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {
            "SKU": "ignore",
            "Net Sales": "net_sales",
            "Royalty Due": "licensee_reported_royalty",
        }
        contract = _make_db_contract(royalty_rate="8%")
        inserted_period = _make_db_sales_period(
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty="8000",
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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert result.id == "sp-1"
        assert result.net_sales == Decimal("100000")
        assert result.royalty_calculated == Decimal("8000")

    @pytest.mark.asyncio
    async def test_confirm_populates_licensee_reported_royalty(self):
        """licensee_reported_royalty is correctly extracted from the mapped column."""
        rows = [
            ["Net Sales", "Royalty Due"],
            [50000, 3000],
            [50000, 4000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {
            "Net Sales": "net_sales",
            "Royalty Due": "licensee_reported_royalty",
        }
        contract = _make_db_contract(royalty_rate="8%")
        # licensee reported 7000 total (3000 + 4000), system calculates 8000
        inserted_period = _make_db_sales_period(
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty="7000",
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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert result.licensee_reported_royalty == Decimal("7000")
        assert result.has_discrepancy is True
        assert result.discrepancy_amount == Decimal("1000")  # 8000 - 7000


class TestConfirmEndpointExpiredUploadId:
    """Confirm endpoint returns 400 when upload_id is not in memory."""

    @pytest.mark.asyncio
    async def test_expired_upload_id_returns_400(self):
        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import confirm_upload, UploadConfirmRequest
            from fastapi import HTTPException

            request = UploadConfirmRequest(
                upload_id="nonexistent-id-that-does-not-exist",
                column_mapping={"Net Sales": "net_sales"},
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
            )

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=request,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "upload_expired"


class TestConfirmEndpointMissingNetSalesMapping:
    """Confirm endpoint returns 400 when no column maps to net_sales."""

    @pytest.mark.asyncio
    async def test_no_net_sales_column_returns_400(self):
        rows = [
            ["SKU", "Product Category"],
            ["APP-001", "Apparel"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry, confirm_upload, UploadConfirmRequest
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

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping={"SKU": "ignore", "Product Category": "product_category"},
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
            )

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=request,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "net_sales_column_required"


class TestConfirmEndpointSavesMappingWhenFlagTrue:
    """Confirm endpoint calls upsert on licensee_column_mappings when save_mapping=True."""

    @pytest.mark.asyncio
    async def test_upsert_called_when_save_mapping_true(self):
        rows = [
            ["Net Sales", "SKU"],
            [50000, "APP-001"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {"Net Sales": "net_sales", "SKU": "ignore"}
        contract = _make_db_contract(royalty_rate="8%")
        inserted_period = _make_db_sales_period(net_sales="50000", royalty_calculated="4000")

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
            )

            await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # Assert upsert was called on the mappings table
        mock_mapping_t.upsert.assert_called_once()


class TestConfirmEndpointDoesNotSaveMappingWhenFlagFalse:
    """Confirm endpoint does NOT call upsert when save_mapping=False."""

    @pytest.mark.asyncio
    async def test_upsert_not_called_when_save_mapping_false(self):
        rows = [
            ["Net Sales", "SKU"],
            [50000, "APP-001"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {"Net Sales": "net_sales", "SKU": "ignore"}
        contract = _make_db_contract(royalty_rate="8%")
        inserted_period = _make_db_sales_period(net_sales="50000", royalty_calculated="4000")

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
            )

            await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # upsert should NOT have been called
        mock_mapping_t.upsert.assert_not_called()


class TestConfirmEndpointCategoryContractRequiresCategoryColumn:
    """Confirm returns 400 when contract has category rates but no category column mapped."""

    @pytest.mark.asyncio
    async def test_category_contract_without_category_column_returns_400(self):
        rows = [
            ["Net Sales"],
            [50000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        # Category rate contract
        contract = _make_db_contract(royalty_rate={"Apparel": "8%", "Accessories": "10%"})

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry, confirm_upload, UploadConfirmRequest
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

            mock_contract_q = MagicMock()
            mock_contract_q.execute.return_value = Mock(data=[contract])
            mock_contract_sel = MagicMock()
            mock_contract_sel.eq.return_value = mock_contract_q
            mock_contracts_t = MagicMock()
            mock_contracts_t.select.return_value = mock_contract_sel
            mock_supabase.table.return_value = mock_contracts_t

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping={"Net Sales": "net_sales"},
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
            )

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=request,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "category_breakdown_required"


class TestConfirmEndpointUnknownCategoryInFile:
    """Confirm returns 400 when uploaded file has a category not in contract rates."""

    @pytest.mark.asyncio
    async def test_unknown_category_returns_400(self):
        rows = [
            ["Product Category", "Net Sales"],
            ["Handbags", 50000],  # Not in contract rates
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        # Contract only has Apparel and Accessories rates
        contract = _make_db_contract(royalty_rate={"Apparel": "8%", "Accessories": "10%"})

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            from app.routers.sales_upload import _upload_store, _UploadEntry, confirm_upload, UploadConfirmRequest
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

            mock_contract_q = MagicMock()
            mock_contract_q.execute.return_value = Mock(data=[contract])
            mock_contract_sel = MagicMock()
            mock_contract_sel.eq.return_value = mock_contract_q
            mock_contracts_t = MagicMock()
            mock_contracts_t.select.return_value = mock_contract_sel
            mock_supabase.table.return_value = mock_contracts_t

            request = UploadConfirmRequest(
                upload_id=upload_id,
                column_mapping={
                    "Product Category": "product_category",
                    "Net Sales": "net_sales",
                },
                period_start="2025-01-01",
                period_end="2025-03-31",
                save_mapping=False,
            )

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=request,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error_code"] == "unknown_category"


class TestConfirmEndpointZeroSalesPeriodAllowed:
    """Confirm endpoint allows zero net sales (no error)."""

    @pytest.mark.asyncio
    async def test_zero_net_sales_returns_201(self):
        rows = [
            ["Net Sales"],
            [0],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {"Net Sales": "net_sales"}
        contract = _make_db_contract(royalty_rate="8%")
        inserted_period = _make_db_sales_period(net_sales="0", royalty_calculated="0")

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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # Should succeed (no 400 error)
        assert result.net_sales == Decimal("0")


class TestConfirmEndpointSunriseApparelScenario:
    """
    Regression tests for the Sunrise Apparel (BC-2024-0042) royalty calculation bug.

    Bug: The confirm endpoint was calling calculate_royalty_with_minimum() with the
    annual MG ($20,000) and guarantee_period='annually', which produced period_floor =
    $20,000/1 = $20,000. Since the real royalty ($6,664) < $20,000, the system bumped
    the royalty to $20,000 — roughly a 24% effective rate instead of 8%.

    Fix: The confirm endpoint now calls calculate_royalty() directly. Minimum guarantee
    is an annual true-up check handled by the YTD summary, not a per-period floor.
    """

    @pytest.mark.asyncio
    async def test_gross_sales_minus_returns_royalty_is_not_inflated_by_annual_mg(self):
        """
        Scenario:
          - Gross sales: $87,500  Returns: $4,200
          - Net Sales: $83,300  (mapped as gross_sales + returns in spreadsheet)
          - Rate: 8% of Net Sales  →  royalty = $6,664
          - Annual MG: $20,000  (must NOT be applied per-period)
        Expected: royalty_calculated = $6,664, minimum_applied = False
        """
        rows = [
            ["Gross Sales", "Returns", "SKU"],
            [87500, 4200, "APP-001"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {
            "Gross Sales": "gross_sales",
            "Returns": "returns",
            "SKU": "ignore",
        }
        contract = _make_db_contract(
            royalty_rate="8% of Net Sales",
            minimum_guarantee="20000",
            minimum_guarantee_period="annually",
        )
        # Net sales = 87500 - 4200 = 83300; royalty = 8% * 83300 = 6664.00
        inserted_period = _make_db_sales_period(
            net_sales="83300",
            royalty_calculated="6664.00",
            minimum_applied=False,
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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # Royalty must be 8% of net sales ($83,300), not the annual MG ($20,000)
        assert result.royalty_calculated == Decimal("6664.00")
        assert result.minimum_applied is False
        # Net sales correctly derived as gross - returns
        assert result.net_sales == Decimal("83300")

    @pytest.mark.asyncio
    async def test_gross_sales_only_royalty_is_8_percent_of_gross(self):
        """
        When the spreadsheet only has a gross sales column (no returns mapped),
        net_sales = gross_sales = $87,500.
        Royalty = 8% × $87,500 = $7,000.
        Annual MG $20,000 must NOT inflate this.
        """
        rows = [
            ["Gross Sales", "SKU"],
            [87500, "APP-001"],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {
            "Gross Sales": "gross_sales",
            "SKU": "ignore",
        }
        contract = _make_db_contract(
            royalty_rate="8% of Net Sales",
            minimum_guarantee="20000",
            minimum_guarantee_period="annually",
        )
        inserted_period = _make_db_sales_period(
            net_sales="87500",
            royalty_calculated="7000.00",
            minimum_applied=False,
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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        assert result.royalty_calculated == Decimal("7000.00")
        assert result.minimum_applied is False
        assert result.net_sales == Decimal("87500")

    @pytest.mark.asyncio
    async def test_low_sales_period_royalty_not_bumped_by_annual_mg(self):
        """
        A slow quarter: net sales = $10,000, royalty = 8% × $10,000 = $800.
        Annual MG = $20,000. The per-period royalty must stay at $800,
        NOT be bumped to $20,000.
        """
        rows = [
            ["Net Sales"],
            [10000],
        ]
        xlsx_bytes = _make_xlsx_bytes(rows)
        column_mapping = {"Net Sales": "net_sales"}
        contract = _make_db_contract(
            royalty_rate="8%",
            minimum_guarantee="20000",
            minimum_guarantee_period="annually",
        )
        inserted_period = _make_db_sales_period(
            net_sales="10000",
            royalty_calculated="800",
            minimum_applied=False,
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
            )

            result = await confirm_upload(
                contract_id="contract-123",
                body=request,
                user_id="user-123",
            )

        # Royalty stays at $800, NOT $20,000
        assert result.royalty_calculated == Decimal("800")
        assert result.minimum_applied is False


class TestConfirmEndpointRequiresContractOwnership:
    """Confirm endpoint returns 403 when user does not own the contract."""

    @pytest.mark.asyncio
    async def test_wrong_user_returns_403(self):
        from fastapi import HTTPException
        from app.auth import verify_contract_ownership

        with patch("app.auth.supabase_admin") as mock_admin:
            mock_result = MagicMock()
            mock_result.data = [{"id": "contract-123", "user_id": "other-user-456"}]
            mock_admin.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership("contract-123", "user-123")

        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# GET /api/sales/upload/mapping/{contract_id}
# ---------------------------------------------------------------------------

class TestGetMappingReturnsSavedMapping:
    """GET mapping endpoint returns saved mapping when one exists."""

    @pytest.mark.asyncio
    async def test_returns_saved_mapping(self):
        contract = _make_db_contract(licensee_name="Sunrise Apparel Co.")
        saved_mapping_row = {
            "id": "map-1",
            "user_id": "user-123",
            "licensee_name": "Sunrise Apparel Co.",
            "column_mapping": {
                "Net Sales Amount": "net_sales",
                "SKU": "ignore",
            },
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-15T09:22:00Z",
        }

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, saved_mapping_row)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import get_saved_mapping

            result = await get_saved_mapping(
                contract_id="contract-123",
                user_id="user-123",
            )

        assert result["licensee_name"] == "Sunrise Apparel Co."
        assert result["column_mapping"] is not None
        assert result["column_mapping"]["Net Sales Amount"] == "net_sales"
        assert result["updated_at"] == "2025-01-15T09:22:00Z"


class TestGetMappingReturnsNullWhenNoneExists:
    """GET mapping endpoint returns null column_mapping when none exists."""

    @pytest.mark.asyncio
    async def test_returns_null_column_mapping_when_none_exists(self):
        contract = _make_db_contract(licensee_name="New Licensee LLC")

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            def table_side_effect(name):
                if name == "contracts":
                    return _mock_contract_query(mock_supabase, contract)
                if name == "licensee_column_mappings":
                    return _mock_mapping_query(mock_supabase, None)
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            from app.routers.sales_upload import get_saved_mapping

            result = await get_saved_mapping(
                contract_id="contract-123",
                user_id="user-123",
            )

        assert result["licensee_name"] == "New Licensee LLC"
        assert result["column_mapping"] is None
        assert result["updated_at"] is None
