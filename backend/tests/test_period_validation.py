"""
Period validation tests (TDD).

Covers two gaps in sales upload period validation:
  Gap 1: Metadata period mismatch detection and warning
  Gap 2: Duplicate period check (both dates) + override

Tests mock the Supabase client entirely — no real DB.
"""

import os
import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import Mock, MagicMock, AsyncMock, patch

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
        "storage_path": "contracts/user-123/test.pdf",
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
):
    return {
        "id": period_id,
        "contract_id": contract_id,
        "period_start": period_start,
        "period_end": period_end,
        "net_sales": net_sales,
        "category_breakdown": None,
        "royalty_calculated": royalty_calculated,
        "minimum_applied": False,
        "licensee_reported_royalty": None,
        "created_at": "2025-04-01T00:00:00Z",
        "updated_at": "2025-04-01T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Gap 1 Tests: _extract_metadata_periods
# ---------------------------------------------------------------------------

class TestExtractMetadataPeriods:
    """Unit tests for the _extract_metadata_periods helper in spreadsheet_parser."""

    def test_extract_metadata_periods_start_and_end(self):
        """Rows with known period labels before header extract correct start/end values."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        # Simulate rows before the header (index 0..header_idx-1)
        # Row 0: label in col 0, value in col 1
        # Row 1: label in col 0, value in col 1
        raw_rows = [
            ["Reporting Period Start", "2025-01-01", None, None],
            ["Period End", "2025-03-31", None, None],
            # header row at index 2 (not passed to helper)
            ["Product", "Net Sales", "Royalty"],
            ["Widget A", 5000, 400],
        ]
        # header_idx = 2, so we scan rows 0..1
        start, end = _extract_metadata_periods(raw_rows, header_idx=2)
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_extract_metadata_periods_no_metadata(self):
        """Returns (None, None) when no period labels appear before the header."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        raw_rows = [
            ["Licensee", "Sunrise Apparel"],  # not a period label
            ["Product", "Net Sales", "Royalty"],
            ["Widget A", 5000, 400],
        ]
        start, end = _extract_metadata_periods(raw_rows, header_idx=1)
        assert start is None
        assert end is None

    def test_extract_metadata_periods_case_insensitive(self):
        """Label matching is case-insensitive."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        raw_rows = [
            ["PERIOD FROM", "Q1 2025", None],
            ["PERIOD THROUGH", "Q1 2025", None],
            ["Product", "Net Sales"],
        ]
        start, end = _extract_metadata_periods(raw_rows, header_idx=2)
        assert start == "Q1 2025"
        assert end == "Q1 2025"

    def test_extract_metadata_periods_partial(self):
        """If only start is found, end is None (and vice versa)."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        raw_rows = [
            ["Start Date", "2025-01-01", None],
            ["Some other label", "irrelevant", None],
            ["Product", "Net Sales"],
        ]
        start, end = _extract_metadata_periods(raw_rows, header_idx=2)
        assert start == "2025-01-01"
        assert end is None

    def test_extract_metadata_periods_no_rows_before_header(self):
        """When header_idx=0 there are no rows to scan; returns (None, None)."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        raw_rows = [
            ["Product", "Net Sales"],
            ["Widget", 5000],
        ]
        start, end = _extract_metadata_periods(raw_rows, header_idx=0)
        assert start is None
        assert end is None

    def test_extract_metadata_periods_all_start_label_variants(self):
        """All start label variants are recognised."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        start_labels = [
            "reporting period start",
            "period start",
            "from",
            "start date",
            "period from",
        ]
        for label in start_labels:
            raw_rows = [
                [label, "2025-01-01"],
                ["Product", "Net Sales"],
            ]
            start, end = _extract_metadata_periods(raw_rows, header_idx=1)
            assert start == "2025-01-01", f"Failed for label: {label!r}"

    def test_extract_metadata_periods_all_end_label_variants(self):
        """All end label variants are recognised."""
        from app.services.spreadsheet_parser import _extract_metadata_periods

        end_labels = [
            "reporting period end",
            "period end",
            "through",
            "end date",
            "period through",
            "to",
            "period to",
        ]
        for label in end_labels:
            raw_rows = [
                [label, "2025-03-31"],
                ["Product", "Net Sales"],
            ]
            start, end = _extract_metadata_periods(raw_rows, header_idx=1)
            assert end == "2025-03-31", f"Failed for label: {label!r}"


# ---------------------------------------------------------------------------
# Gap 1 Tests: ParsedSheet.metadata_period_start / metadata_period_end
# ---------------------------------------------------------------------------

class TestParsedSheetMetadataPeriodFields:
    """ParsedSheet dataclass carries metadata period fields."""

    def test_parsed_sheet_has_metadata_period_fields(self):
        """ParsedSheet can be constructed with metadata period start and end fields."""
        from app.services.spreadsheet_parser import ParsedSheet

        ps = ParsedSheet(
            column_names=["Product", "Net Sales"],
            all_rows=[],
            sample_rows=[],
            data_rows=0,
            metadata_period_start="2025-01-01",
            metadata_period_end="2025-03-31",
        )
        assert ps.metadata_period_start == "2025-01-01"
        assert ps.metadata_period_end == "2025-03-31"

    def test_parsed_sheet_metadata_fields_default_none(self):
        """metadata_period_start and metadata_period_end default to None."""
        from app.services.spreadsheet_parser import ParsedSheet

        ps = ParsedSheet(
            column_names=["Product", "Net Sales"],
            all_rows=[],
            sample_rows=[],
            data_rows=0,
        )
        assert ps.metadata_period_start is None
        assert ps.metadata_period_end is None


# ---------------------------------------------------------------------------
# Gap 1 Tests: parse_upload populates metadata period fields
# ---------------------------------------------------------------------------

class TestParseUploadPopulatesMetadataPeriods:
    """parse_upload() extracts metadata periods into ParsedSheet when present."""

    def test_parse_upload_extracts_metadata_period_start_and_end(self):
        """parse_upload populates metadata_period_start/end from rows before the header."""
        import io
        import openpyxl
        from app.services.spreadsheet_parser import parse_upload

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Reporting Period Start", "2025-01-01"])
        ws.append(["Period End", "2025-03-31"])
        ws.append(["Product", "Net Sales"])
        ws.append(["Widget A", 5000])

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        result = parse_upload(buf.read(), "report.xlsx")

        assert result.metadata_period_start == "2025-01-01"
        assert result.metadata_period_end == "2025-03-31"

    def test_parse_upload_no_metadata_periods_stays_none(self):
        """parse_upload leaves metadata periods as None when no labels found."""
        import io
        import openpyxl
        from app.services.spreadsheet_parser import parse_upload

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Product", "Net Sales"])
        ws.append(["Widget A", 5000])

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        result = parse_upload(buf.read(), "report.xlsx")

        assert result.metadata_period_start is None
        assert result.metadata_period_end is None


# ---------------------------------------------------------------------------
# Gap 1 Tests: _build_upload_warnings metadata period mismatch
# ---------------------------------------------------------------------------

class TestBuildUploadWarningsMetadataPeriod:
    """_build_upload_warnings emits a warning when metadata period does not overlap user dates."""

    def test_metadata_period_mismatch_warning(self):
        """When metadata period does not overlap user dates, a warning is emitted."""
        from app.routers.sales_upload import _build_upload_warnings

        # Metadata says Q3 2025, user entered Q1 2025 — no overlap
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=_make_db_contract(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 3, 31),
            metadata_period_start="2025-07-01",
            metadata_period_end="2025-09-30",
        )

        assert len(warnings) == 1
        w = warnings[0]
        assert w["field"] == "metadata_period"
        assert "2025-07-01" in w["message"]
        assert "2025-01-01" in w["message"]

    def test_metadata_period_match_no_warning(self):
        """When metadata period overlaps user dates, no warning is emitted."""
        from app.routers.sales_upload import _build_upload_warnings

        # Metadata says Jan-Mar 2025, user entered Q1 2025 — full overlap
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=_make_db_contract(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 3, 31),
            metadata_period_start="2025-01-01",
            metadata_period_end="2025-03-31",
        )

        assert len(warnings) == 0

    def test_metadata_period_partial_overlap_no_warning(self):
        """Partial overlap (e.g., metadata starts mid-user-period) produces no warning."""
        from app.routers.sales_upload import _build_upload_warnings

        # Metadata says Feb 2025 only, user entered Q1 2025 — overlaps Feb
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=_make_db_contract(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 3, 31),
            metadata_period_start="2025-02-01",
            metadata_period_end="2025-02-28",
        )

        assert len(warnings) == 0

    def test_metadata_period_none_values_no_warning(self):
        """When metadata period fields are None, no warning is produced."""
        from app.routers.sales_upload import _build_upload_warnings

        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=_make_db_contract(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 3, 31),
            metadata_period_start=None,
            metadata_period_end=None,
        )

        assert len(warnings) == 0

    def test_metadata_period_unparseable_no_warning(self):
        """When metadata period cannot be parsed, no warning is produced (non-blocking)."""
        from app.routers.sales_upload import _build_upload_warnings

        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=_make_db_contract(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 3, 31),
            metadata_period_start="not a date",
            metadata_period_end="also not a date",
        )

        assert len(warnings) == 0


# ---------------------------------------------------------------------------
# Gap 2 Tests: Duplicate check matches both dates
# ---------------------------------------------------------------------------

class TestOverlappingPeriodCheck:
    """Duplicate/overlap check must find periods that overlap the new date range."""

    @pytest.mark.asyncio
    async def test_overlap_check_uses_range_comparison(self):
        """
        The overlap check should use lte/gte range comparison (A.start <= B.end AND A.end >= B.start)
        instead of exact date matching, to mirror the DB exclusion constraint.
        """
        import io
        import openpyxl
        from app.routers.sales_upload import confirm_upload, _store_upload
        from app.services.spreadsheet_parser import ParsedSheet

        parsed = ParsedSheet(
            column_names=["Net Sales"],
            all_rows=[{"Net Sales": "50000"}],
            sample_rows=[{"Net Sales": "50000"}],
            data_rows=1,
        )

        upload_id = _store_upload(
            parsed=parsed,
            contract_id="contract-123",
            user_id="user-123",
        )

        from app.routers.sales_upload import UploadConfirmRequest
        body = UploadConfirmRequest(
            upload_id=upload_id,
            column_mapping={"Net Sales": "net_sales"},
            period_start="2025-01-01",
            period_end="2025-03-31",
            save_mapping=False,
        )

        contract = _make_db_contract()
        inserted_period = _make_db_sales_period()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.routers.sales_upload.upload_sales_report", return_value="path/to/file.xlsx"):

            # Simulate: no overlapping periods found
            mock_dupe_chain = MagicMock()
            mock_dupe_chain.execute.return_value = Mock(data=[])
            mock_dupe_chain.eq.return_value = mock_dupe_chain
            mock_dupe_chain.lte.return_value = mock_dupe_chain
            mock_dupe_chain.gte.return_value = mock_dupe_chain

            mock_dupe_select = MagicMock()
            mock_dupe_select.eq.return_value = mock_dupe_chain

            mock_insert_exec = MagicMock()
            mock_insert_exec.execute.return_value = Mock(data=[inserted_period])

            mock_periods_table = MagicMock()
            mock_periods_table.select.return_value = mock_dupe_select
            mock_periods_table.insert.return_value = mock_insert_exec

            mock_contract_exec = MagicMock()
            mock_contract_exec.execute.return_value = Mock(data=[contract])
            mock_contract_select = MagicMock()
            mock_contract_select.eq.return_value = mock_contract_exec
            mock_contract_table = MagicMock()
            mock_contract_table.select.return_value = mock_contract_select

            def table_side_effect(name):
                if name == "contracts":
                    return mock_contract_table
                if name == "sales_periods":
                    return mock_periods_table
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            result = await confirm_upload(
                contract_id="contract-123",
                body=body,
                user_id="user-123",
            )

        # Should succeed — no overlapping period found
        assert result is not None

        # Verify the overlap check uses lte/gte range comparison
        assert mock_dupe_chain.lte.called, "Overlap check should use .lte() for range comparison"
        assert mock_dupe_chain.gte.called, "Overlap check should use .gte() for range comparison"

    @pytest.mark.asyncio
    async def test_overlap_no_override_returns_409(self):
        """When override_duplicate=False and an overlapping period exists, return 409."""
        import io
        import openpyxl
        from fastapi import HTTPException
        from app.routers.sales_upload import confirm_upload, _store_upload
        from app.services.spreadsheet_parser import ParsedSheet

        parsed = ParsedSheet(
            column_names=["Net Sales"],
            all_rows=[{"Net Sales": "50000"}],
            sample_rows=[{"Net Sales": "50000"}],
            data_rows=1,
        )

        upload_id = _store_upload(
            parsed=parsed,
            contract_id="contract-123",
            user_id="user-123",
        )

        from app.routers.sales_upload import UploadConfirmRequest
        body = UploadConfirmRequest(
            upload_id=upload_id,
            column_mapping={"Net Sales": "net_sales"},
            period_start="2025-01-01",
            period_end="2025-03-31",
            save_mapping=False,
            override_duplicate=False,  # explicit False — no override
        )

        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):

            # Overlap check returns an existing record
            existing_record = {"id": "sp-existing"}
            mock_dupe_chain = MagicMock()
            mock_dupe_chain.execute.return_value = Mock(data=[existing_record])
            mock_dupe_chain.eq.return_value = mock_dupe_chain
            mock_dupe_chain.lte.return_value = mock_dupe_chain
            mock_dupe_chain.gte.return_value = mock_dupe_chain

            mock_dupe_select = MagicMock()
            mock_dupe_select.eq.return_value = mock_dupe_chain

            mock_periods_table = MagicMock()
            mock_periods_table.select.return_value = mock_dupe_select

            mock_contract_exec = MagicMock()
            mock_contract_exec.execute.return_value = Mock(data=[contract])
            mock_contract_select = MagicMock()
            mock_contract_select.eq.return_value = mock_contract_exec
            mock_contract_table = MagicMock()
            mock_contract_table.select.return_value = mock_contract_select

            def table_side_effect(name):
                if name == "contracts":
                    return mock_contract_table
                if name == "sales_periods":
                    return mock_periods_table
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            with pytest.raises(HTTPException) as exc_info:
                await confirm_upload(
                    contract_id="contract-123",
                    body=body,
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert detail.get("error_code") == "duplicate_period"

    @pytest.mark.asyncio
    async def test_overlap_override_deletes_existing(self):
        """When override_duplicate=True and an overlapping period exists, existing record is deleted before insert."""
        import io
        import openpyxl
        from app.routers.sales_upload import confirm_upload, _store_upload
        from app.services.spreadsheet_parser import ParsedSheet

        parsed = ParsedSheet(
            column_names=["Net Sales"],
            all_rows=[{"Net Sales": "50000"}],
            sample_rows=[{"Net Sales": "50000"}],
            data_rows=1,
        )

        upload_id = _store_upload(
            parsed=parsed,
            contract_id="contract-123",
            user_id="user-123",
        )

        from app.routers.sales_upload import UploadConfirmRequest
        body = UploadConfirmRequest(
            upload_id=upload_id,
            column_mapping={"Net Sales": "net_sales"},
            period_start="2025-01-01",
            period_end="2025-03-31",
            save_mapping=False,
            override_duplicate=True,  # user explicitly wants to replace
        )

        contract = _make_db_contract()
        inserted_period = _make_db_sales_period()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock), \
             patch("app.routers.sales_upload.upload_sales_report", return_value="path/to/file.xlsx"):

            existing_record = {"id": "sp-existing"}

            # Overlap check returns existing record
            mock_dupe_chain = MagicMock()
            mock_dupe_chain.execute.return_value = Mock(data=[existing_record])
            mock_dupe_chain.eq.return_value = mock_dupe_chain
            mock_dupe_chain.lte.return_value = mock_dupe_chain
            mock_dupe_chain.gte.return_value = mock_dupe_chain

            mock_dupe_select = MagicMock()
            mock_dupe_select.eq.return_value = mock_dupe_chain

            # Delete chain: .delete().eq("id", ...).execute()
            mock_delete_exec = MagicMock()
            mock_delete_exec.execute.return_value = Mock(data=[])
            mock_delete_eq = MagicMock()
            mock_delete_eq.execute.return_value = Mock(data=[])
            mock_delete_chain = MagicMock()
            mock_delete_chain.eq.return_value = mock_delete_exec

            # Insert chain
            mock_insert_exec = MagicMock()
            mock_insert_exec.execute.return_value = Mock(data=[inserted_period])

            mock_periods_table = MagicMock()
            mock_periods_table.select.return_value = mock_dupe_select
            mock_periods_table.delete.return_value = mock_delete_chain
            mock_periods_table.insert.return_value = mock_insert_exec

            mock_contract_exec = MagicMock()
            mock_contract_exec.execute.return_value = Mock(data=[contract])
            mock_contract_select = MagicMock()
            mock_contract_select.eq.return_value = mock_contract_exec
            mock_contract_table = MagicMock()
            mock_contract_table.select.return_value = mock_contract_select

            def table_side_effect(name):
                if name == "contracts":
                    return mock_contract_table
                if name == "sales_periods":
                    return mock_periods_table
                return MagicMock()

            mock_supabase.table.side_effect = table_side_effect

            result = await confirm_upload(
                contract_id="contract-123",
                body=body,
                user_id="user-123",
            )

        # Should succeed
        assert result is not None

        # Verify delete was called on sales_periods
        assert mock_periods_table.delete.called, "Expected sales_periods.delete() to be called for override"

        # Verify insert was called after delete
        assert mock_periods_table.insert.called, "Expected sales_periods.insert() to be called after override delete"


# ---------------------------------------------------------------------------
# Gap 2 Tests: UploadConfirmRequest.override_duplicate field
# ---------------------------------------------------------------------------

class TestUploadConfirmRequestOverrideDuplicate:
    """UploadConfirmRequest Pydantic model includes override_duplicate field."""

    def test_override_duplicate_defaults_false(self):
        """override_duplicate defaults to False when not provided."""
        from app.routers.sales_upload import UploadConfirmRequest

        req = UploadConfirmRequest(
            upload_id="test-id",
            column_mapping={"Net Sales": "net_sales"},
            period_start="2025-01-01",
            period_end="2025-03-31",
        )
        assert req.override_duplicate is False

    def test_override_duplicate_can_be_set_true(self):
        """override_duplicate can be set to True."""
        from app.routers.sales_upload import UploadConfirmRequest

        req = UploadConfirmRequest(
            upload_id="test-id",
            column_mapping={"Net Sales": "net_sales"},
            period_start="2025-01-01",
            period_end="2025-03-31",
            override_duplicate=True,
        )
        assert req.override_duplicate is True


# ---------------------------------------------------------------------------
# Gap 2 Tests: GET /upload/{contract_id}/period-check endpoint
# ---------------------------------------------------------------------------

def _mock_period_check_query(overlap_records: list) -> MagicMock:
    """
    Build a mock for the sales_periods table that handles the period-check
    select chain: .select(...).eq(...).lte(...).gte(...).execute()
    """
    mock_exec = MagicMock()
    mock_exec.execute.return_value = Mock(data=overlap_records)
    mock_exec.eq.return_value = mock_exec
    mock_exec.lte.return_value = mock_exec
    mock_exec.gte.return_value = mock_exec

    mock_select = MagicMock()
    mock_select.eq.return_value = mock_exec

    mock_t = MagicMock()
    mock_t.select.return_value = mock_select
    return mock_t


def _mock_verify_ownership(contract: dict) -> AsyncMock:
    """Return an AsyncMock for verify_contract_ownership that returns the given contract dict."""
    mock = AsyncMock(return_value=contract)
    return mock


class TestPeriodCheckEndpoint:
    """GET /upload/{contract_id}/period-check — early overlap detection."""

    @pytest.mark.asyncio
    async def test_period_check_returns_overlapping_periods(self):
        """When the DB returns one overlapping record, the response has has_overlap=True and the record listed."""
        from app.routers.sales_upload import period_check

        overlap_record = {
            "id": "sp-overlap-1",
            "period_start": "2025-01-01",
            "period_end": "2025-03-31",
            "net_sales": "95000.00",
            "royalty_calculated": "7600.00",
            "created_at": "2025-04-15T10:23:00Z",
        }
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership",
                   _mock_verify_ownership(contract)):

            mock_supabase.table.return_value = _mock_period_check_query([overlap_record])

            result = await period_check(
                contract_id="contract-123",
                start="2025-01-01",
                end="2025-03-31",
                user_id="user-123",
            )

        assert result["has_overlap"] is True
        assert len(result["overlapping_periods"]) == 1
        rec = result["overlapping_periods"][0]
        assert rec["id"] == "sp-overlap-1"
        assert rec["period_start"] == "2025-01-01"
        assert rec["period_end"] == "2025-03-31"
        assert rec["net_sales"] == "95000.00"
        assert rec["royalty_calculated"] == "7600.00"
        assert rec["created_at"] == "2025-04-15T10:23:00Z"

    @pytest.mark.asyncio
    async def test_period_check_no_overlap_returns_empty(self):
        """When the DB returns no records, has_overlap is False and overlapping_periods is empty."""
        from app.routers.sales_upload import period_check
        contract = _make_db_contract()

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership",
                   _mock_verify_ownership(contract)):

            mock_supabase.table.return_value = _mock_period_check_query([])

            result = await period_check(
                contract_id="contract-123",
                start="2025-04-01",
                end="2025-06-30",
                user_id="user-123",
            )

        assert result["has_overlap"] is False
        assert result["overlapping_periods"] == []

    @pytest.mark.asyncio
    async def test_period_check_rejects_invalid_range(self):
        """When end < start, the endpoint returns 400."""
        from fastapi import HTTPException
        from app.routers.sales_upload import period_check

        with patch("app.routers.sales_upload.verify_contract_ownership", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc_info:
                await period_check(
                    contract_id="contract-123",
                    start="2025-03-31",
                    end="2025-01-01",
                    user_id="user-123",
                )

        assert exc_info.value.status_code == 400
        detail = exc_info.value.detail
        assert detail.get("error_code") == "period_end_before_start"

    @pytest.mark.asyncio
    async def test_period_check_multiple_overlaps(self):
        """When the DB returns multiple overlapping records, all are listed."""
        from app.routers.sales_upload import period_check
        contract = _make_db_contract()

        overlap_records = [
            {
                "id": "sp-overlap-1",
                "period_start": "2025-01-01",
                "period_end": "2025-03-31",
                "net_sales": "95000.00",
                "royalty_calculated": "7600.00",
                "created_at": "2025-04-15T10:23:00Z",
            },
            {
                "id": "sp-overlap-2",
                "period_start": "2025-02-01",
                "period_end": "2025-04-30",
                "net_sales": "40000.00",
                "royalty_calculated": "3200.00",
                "created_at": "2025-05-01T08:00:00Z",
            },
        ]

        with patch("app.routers.sales_upload.supabase") as mock_supabase, \
             patch("app.routers.sales_upload.verify_contract_ownership",
                   _mock_verify_ownership(contract)):

            mock_supabase.table.return_value = _mock_period_check_query(overlap_records)

            result = await period_check(
                contract_id="contract-123",
                start="2025-01-01",
                end="2025-06-30",
                user_id="user-123",
            )

        assert result["has_overlap"] is True
        assert len(result["overlapping_periods"]) == 2
        ids = {r["id"] for r in result["overlapping_periods"]}
        assert ids == {"sp-overlap-1", "sp-overlap-2"}


# ---------------------------------------------------------------------------
# Gap 3 Tests: Contract date range and reporting frequency validation
# ---------------------------------------------------------------------------

async def _run_period_check(
    contract: dict,
    start: str,
    end: str,
    overlap_records: list | None = None,
) -> dict:
    """
    Helper to call the period_check endpoint with a mocked supabase and
    verify_contract_ownership returning the given contract.
    """
    from app.routers.sales_upload import period_check

    if overlap_records is None:
        overlap_records = []

    with patch("app.routers.sales_upload.supabase") as mock_supabase, \
         patch("app.routers.sales_upload.verify_contract_ownership",
               _mock_verify_ownership(contract)):

        mock_supabase.table.return_value = _mock_period_check_query(overlap_records)

        return await period_check(
            contract_id=contract["id"],
            start=start,
            end=end,
            user_id=contract["user_id"],
        )


class TestPeriodCheckContractRange:
    """Gap 3a: out_of_range flag in period-check response."""

    @pytest.mark.asyncio
    async def test_period_check_out_of_range_true(self):
        """Period starting before contract_start_date → out_of_range: True."""
        contract = _make_db_contract()
        # contract runs 2025-01-01 to 2025-12-31
        # entering a period that starts in 2024 is out of range
        result = await _run_period_check(contract, "2024-10-01", "2024-12-31")

        assert result["out_of_range"] is True
        assert result["contract_start_date"] == "2025-01-01"
        assert result["contract_end_date"] == "2025-12-31"

    @pytest.mark.asyncio
    async def test_period_check_out_of_range_end_after_contract_end(self):
        """Period ending after contract_end_date → out_of_range: True."""
        contract = _make_db_contract()
        # period end extends beyond 2025-12-31
        result = await _run_period_check(contract, "2025-10-01", "2026-03-31")

        assert result["out_of_range"] is True

    @pytest.mark.asyncio
    async def test_period_check_out_of_range_false(self):
        """Period fully within contract dates → out_of_range: False."""
        contract = _make_db_contract()
        # Q1 2025 is within 2025-01-01 to 2025-12-31
        result = await _run_period_check(contract, "2025-01-01", "2025-03-31")

        assert result["out_of_range"] is False
        assert result["contract_start_date"] == "2025-01-01"
        assert result["contract_end_date"] == "2025-12-31"

    @pytest.mark.asyncio
    async def test_period_check_out_of_range_null_contract_dates(self):
        """Null contract dates → out_of_range: False (skip the check)."""
        contract = _make_db_contract()
        contract["contract_start_date"] = None
        contract["contract_end_date"] = None

        result = await _run_period_check(contract, "2024-01-01", "2024-12-31")

        assert result["out_of_range"] is False
        assert result["contract_start_date"] is None
        assert result["contract_end_date"] is None

    @pytest.mark.asyncio
    async def test_period_check_out_of_range_null_start_only(self):
        """Only one contract date is null → skip the check, out_of_range: False."""
        contract = _make_db_contract()
        contract["contract_start_date"] = None
        # contract_end_date remains 2025-12-31

        result = await _run_period_check(contract, "2024-01-01", "2025-06-30")

        assert result["out_of_range"] is False


class TestPeriodCheckFrequencyWarning:
    """Gap 3b: frequency_warning in period-check response."""

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_quarterly_too_long(self):
        """181 days on a quarterly contract → frequency_warning with message."""
        contract = _make_db_contract()  # reporting_frequency = "quarterly"
        # 2025-01-01 to 2025-06-30 = 181 days inclusive (31+28+31+30+31+30=181)
        result = await _run_period_check(contract, "2025-01-01", "2025-06-30")

        assert result["frequency_warning"] is not None
        fw = result["frequency_warning"]
        assert fw["expected_frequency"] == "quarterly"
        assert fw["entered_days"] == 181
        assert fw["expected_range"] == [45, 135]
        assert "quarterly" in fw["message"].lower()
        assert "181" in fw["message"]

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_quarterly_ok(self):
        """91 days on a quarterly contract → no frequency_warning."""
        contract = _make_db_contract()  # reporting_frequency = "quarterly"
        # 2025-01-01 to 2025-04-01 = 91 days (inclusive)
        result = await _run_period_check(contract, "2025-01-01", "2025-04-01")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_null_frequency(self):
        """Null reporting_frequency → frequency_warning: null (skip the check)."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = None

        result = await _run_period_check(contract, "2025-01-01", "2025-07-01")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_monthly_ok(self):
        """31 days on a monthly contract → no frequency_warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "monthly"
        # January has 31 days
        result = await _run_period_check(contract, "2025-01-01", "2025-01-31")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_monthly_too_short(self):
        """10 days on a monthly contract (mid-contract) → frequency_warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "monthly"
        # Use mid-contract dates so partial-period suppression does not apply
        result = await _run_period_check(contract, "2025-06-01", "2025-06-10")

        assert result["frequency_warning"] is not None
        fw = result["frequency_warning"]
        assert fw["expected_frequency"] == "monthly"
        assert fw["expected_range"] == [15, 55]

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_annually_ok(self):
        """365 days on an annual contract → no frequency_warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "annually"
        contract["contract_start_date"] = "2024-01-01"
        contract["contract_end_date"] = "2026-12-31"
        result = await _run_period_check(contract, "2025-01-01", "2025-12-31")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_semi_annually_ok(self):
        """181 days on a semi_annually contract → no frequency_warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "semi_annually"
        result = await _run_period_check(contract, "2025-01-01", "2025-06-30")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_period_check_frequency_warning_semi_annually_too_long(self):
        """300 days on a semi_annually contract → frequency_warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "semi_annually"
        contract["contract_start_date"] = "2024-01-01"
        contract["contract_end_date"] = "2026-12-31"
        result = await _run_period_check(contract, "2025-01-01", "2025-10-28")

        assert result["frequency_warning"] is not None
        fw = result["frequency_warning"]
        assert fw["expected_frequency"] == "semi_annually"
        assert fw["expected_range"] == [120, 215]

    @pytest.mark.asyncio
    async def test_period_check_unknown_frequency_no_warning(self):
        """Unrecognised frequency string → no frequency_warning (skip gracefully)."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "biweekly"

        result = await _run_period_check(contract, "2025-01-01", "2025-03-31")

        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_frequency_warning_suppressed_for_first_partial_period(self):
        """A short period near the contract start date is a first partial period — no warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "quarterly"
        contract["contract_start_date"] = "2025-03-01"
        contract["contract_end_date"] = "2026-02-28"

        # March 1–31 = 31 days, below quarterly minimum of 45,
        # but starts at the contract start date — suppress warning
        result = await _run_period_check(contract, "2025-03-01", "2025-03-31", [])
        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_frequency_warning_suppressed_for_last_partial_period(self):
        """A short period near the contract end date is a last partial period — no warning."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "quarterly"
        contract["contract_start_date"] = "2025-01-01"
        contract["contract_end_date"] = "2025-11-15"

        # Nov 1–15 = 15 days, below quarterly minimum,
        # but ends at the contract end date — suppress warning
        result = await _run_period_check(contract, "2025-11-01", "2025-11-15", [])
        assert result["frequency_warning"] is None

    @pytest.mark.asyncio
    async def test_frequency_warning_not_suppressed_for_mid_contract_short_period(self):
        """A short period in the middle of the contract should still warn."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "quarterly"
        contract["contract_start_date"] = "2025-01-01"
        contract["contract_end_date"] = "2025-12-31"

        # June 1–30 = 30 days, below quarterly minimum,
        # NOT near contract start or end — should warn
        result = await _run_period_check(contract, "2025-06-01", "2025-06-30", [])
        assert result["frequency_warning"] is not None


class TestPeriodCheckSuggestedEndDate:
    """Gap 3: suggested_end_date when start aligns to a natural period boundary."""

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_quarterly_jan1(self):
        """Quarterly contract, start=Jan 1 → suggested Mar 31."""
        contract = _make_db_contract()  # reporting_frequency = "quarterly"
        # Use a very long range so frequency warning fires
        result = await _run_period_check(contract, "2025-01-01", "2025-07-01")

        assert result["suggested_end_date"] == "2025-03-31"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_quarterly_apr1(self):
        """Quarterly contract, start=Apr 1 → suggested Jun 30."""
        contract = _make_db_contract()
        contract["contract_end_date"] = "2026-12-31"
        result = await _run_period_check(contract, "2025-04-01", "2025-10-01")

        assert result["suggested_end_date"] == "2025-06-30"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_not_aligned(self):
        """Quarterly contract, start=Jan 15 → suggested_end_date is null."""
        contract = _make_db_contract()
        result = await _run_period_check(contract, "2025-01-15", "2025-07-01")

        assert result["suggested_end_date"] is None

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_monthly_jan1(self):
        """Monthly contract, start=Jan 1 → suggested Jan 31."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "monthly"
        result = await _run_period_check(contract, "2025-01-01", "2025-06-01")

        assert result["suggested_end_date"] == "2025-01-31"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_annually_jan1(self):
        """Annual contract, start=Jan 1 → suggested Dec 31 of same year."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "annually"
        contract["contract_start_date"] = "2024-01-01"
        contract["contract_end_date"] = "2026-12-31"
        # Enter a short period to trigger frequency warning
        result = await _run_period_check(contract, "2025-01-01", "2025-06-30")

        assert result["suggested_end_date"] == "2025-12-31"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_semi_annually_jan1(self):
        """Semi-annual contract, start=Jan 1 → suggested Jun 30."""
        contract = _make_db_contract()
        contract["reporting_frequency"] = "semi_annually"
        contract["contract_start_date"] = "2024-01-01"
        contract["contract_end_date"] = "2026-12-31"
        # Enter a very short period to trigger frequency warning
        result = await _run_period_check(contract, "2025-01-01", "2025-01-31")

        assert result["suggested_end_date"] == "2025-06-30"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_no_warning_no_suggestion(self):
        """When there is no frequency warning, suggested_end_date is null."""
        contract = _make_db_contract()  # quarterly
        # 91 days is fine for quarterly — no warning
        result = await _run_period_check(contract, "2025-01-01", "2025-04-01")

        assert result["suggested_end_date"] is None

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_near_boundary(self):
        """Quarterly contract, start=Jan 3 (within 3 days of Jan 1) → suggested Mar 31."""
        contract = _make_db_contract()
        result = await _run_period_check(contract, "2025-01-03", "2025-07-01")

        assert result["suggested_end_date"] == "2025-03-31"

    @pytest.mark.asyncio
    async def test_period_check_suggested_end_date_too_far_from_boundary(self):
        """Quarterly contract, start=Jan 5 (4 days past Jan 1, outside tolerance) → null."""
        contract = _make_db_contract()
        result = await _run_period_check(contract, "2025-01-05", "2025-07-01")

        assert result["suggested_end_date"] is None


# ---------------------------------------------------------------------------
# Gap 3 Tests: _build_upload_warnings contract range and frequency checks
# ---------------------------------------------------------------------------

class TestBuildUploadWarningsContractRange:
    """_build_upload_warnings emits contract_range warning when period is outside contract dates."""

    def test_build_warnings_contract_range_outside_before_start(self):
        """Period starts before contract_start_date → contract_range warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        # contract runs 2025-01-01 to 2025-12-31
        # period starts 2024-10-01 — before contract start
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2024, 10, 1),
            period_end=date(2024, 12, 31),
        )

        fields = [w["field"] for w in warnings]
        assert "contract_range" in fields

        w = next(w for w in warnings if w["field"] == "contract_range")
        assert "2024-10-01" in w["extracted_value"]
        assert "2025-01-01" in w["contract_value"]
        assert "outside" in w["message"].lower() or "range" in w["message"].lower()

    def test_build_warnings_contract_range_outside_after_end(self):
        """Period ends after contract_end_date → contract_range warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 10, 1),
            period_end=date(2026, 3, 31),
        )

        fields = [w["field"] for w in warnings]
        assert "contract_range" in fields

    def test_build_warnings_contract_range_inside(self):
        """Period fully inside contract dates → no contract_range warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 4, 1),
            period_end=date(2025, 6, 30),
        )

        fields = [w["field"] for w in warnings]
        assert "contract_range" not in fields

    def test_build_warnings_contract_range_null_dates_no_warning(self):
        """Null contract dates → no contract_range warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        contract["contract_start_date"] = None
        contract["contract_end_date"] = None

        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2024, 1, 1),
            period_end=date(2024, 12, 31),
        )

        fields = [w["field"] for w in warnings]
        assert "contract_range" not in fields


class TestBuildUploadWarningsFrequencyMismatch:
    """_build_upload_warnings emits frequency_mismatch warning when duration mismatches."""

    def test_build_warnings_frequency_mismatch(self):
        """181 days on quarterly contract → frequency_mismatch warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()  # reporting_frequency = "quarterly"
        # 2025-01-01 to 2025-06-30 = 181 days inclusive (31+28+31+30+31+30=181)
        # This is way outside the 45-135 quarterly range
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 1, 1),
            period_end=date(2025, 6, 30),
        )

        fields = [w["field"] for w in warnings]
        assert "frequency_mismatch" in fields

        w = next(w for w in warnings if w["field"] == "frequency_mismatch")
        assert "181" in w["extracted_value"]
        assert w["contract_value"] == "quarterly"
        assert "quarterly" in w["message"].lower()

    def test_build_warnings_frequency_ok(self):
        """91 days on quarterly contract → no frequency_mismatch warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 1, 1),
            period_end=date(2025, 4, 1),
        )

        fields = [w["field"] for w in warnings]
        assert "frequency_mismatch" not in fields

    def test_build_warnings_frequency_null_no_warning(self):
        """Null reporting_frequency → no frequency_mismatch warning."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        contract["reporting_frequency"] = None

        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 1, 1),
            period_end=date(2025, 7, 1),
        )

        fields = [w["field"] for w in warnings]
        assert "frequency_mismatch" not in fields

    def test_build_warnings_frequency_unknown_no_warning(self):
        """Unknown reporting_frequency value → no frequency_mismatch warning (skip gracefully)."""
        from app.routers.sales_upload import _build_upload_warnings

        contract = _make_db_contract()
        contract["reporting_frequency"] = "biweekly"

        warnings = _build_upload_warnings(
            cross_check_values={},
            contract=contract,
            period_start=date(2025, 1, 1),
            period_end=date(2025, 7, 1),
        )

        fields = [w["field"] for w in warnings]
        assert "frequency_mismatch" not in fields
