"""
Phase 1 backend tests: draft persistence, duplicate detection, confirm endpoint,
status filter, and storage deterministic paths.

TDD: tests written first, implementation follows.
"""

import pytest
import os
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from fastapi import HTTPException

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'
os.environ['SUPABASE_SERVICE_KEY'] = 'test-service-key'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    status="active",
    filename="Nike_License_2024.pdf",
    licensee_name="Nike Inc.",
    created_at="2026-01-15T10:30:00Z",
):
    """Return a minimal dict that mimics a Supabase contracts row."""
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": status,
        "filename": filename,
        "licensee_name": licensee_name,
        "pdf_url": f"https://test.supabase.co/storage/v1/object/sign/contracts/{user_id}/{filename}?token=abc",
        "extracted_terms": {"licensee_name": licensee_name},
        "royalty_rate": "8% of Net Sales",
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2024-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": "0",
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/{filename}",
        "created_at": created_at,
        "updated_at": created_at,
    }


def _make_draft_db_contract(**overrides):
    base = _make_db_contract(**overrides)
    base.update({
        "status": "draft",
        "licensee_name": None,
        "royalty_rate": None,
        "royalty_base": None,
        "contract_start_date": None,
        "contract_end_date": None,
        "minimum_guarantee": None,
        "minimum_guarantee_period": None,
        "reporting_frequency": None,
        "created_at": "2026-02-19T08:15:00Z",
        "updated_at": "2026-02-19T08:15:00Z",
    })
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

class TestContractStatusEnum:
    """ContractStatus enum has draft and active values."""

    def test_draft_value(self):
        from app.models.contract import ContractStatus
        assert ContractStatus.DRAFT == "draft"

    def test_active_value(self):
        from app.models.contract import ContractStatus
        assert ContractStatus.ACTIVE == "active"

    def test_is_str_enum(self):
        from app.models.contract import ContractStatus
        assert isinstance(ContractStatus.DRAFT, str)
        assert isinstance(ContractStatus.ACTIVE, str)


class TestContractDraftCreate:
    """ContractDraftCreate model for draft insertion at extraction time."""

    def test_required_fields(self):
        from app.models.contract import ContractDraftCreate, ExtractedTerms, ContractStatus
        draft = ContractDraftCreate(
            filename="Nike_License_2024.pdf",
            pdf_url="https://example.com/contract.pdf",
            storage_path="contracts/user-123/Nike_License_2024.pdf",
            extracted_terms=ExtractedTerms(),
        )
        assert draft.filename == "Nike_License_2024.pdf"
        assert draft.pdf_url == "https://example.com/contract.pdf"
        assert draft.storage_path == "contracts/user-123/Nike_License_2024.pdf"
        assert draft.status == ContractStatus.DRAFT

    def test_status_defaults_to_draft(self):
        from app.models.contract import ContractDraftCreate, ExtractedTerms, ContractStatus
        draft = ContractDraftCreate(
            filename="test.pdf",
            pdf_url="https://example.com/test.pdf",
            storage_path="contracts/user-123/test.pdf",
            extracted_terms=ExtractedTerms(),
        )
        assert draft.status == ContractStatus.DRAFT


class TestContractConfirm:
    """ContractConfirm model for the PUT /{id}/confirm endpoint."""

    def test_required_fields(self):
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.licensee_name == "Nike Inc."
        assert confirm.royalty_rate == "8% of Net Sales"

    def test_optional_fields_have_defaults(self):
        from app.models.contract import ContractConfirm, MinimumGuaranteePeriod, ReportingFrequency
        from datetime import date
        from decimal import Decimal

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.royalty_base == "net sales"
        assert confirm.territories == []
        assert confirm.product_categories is None
        assert confirm.minimum_guarantee == Decimal("0")
        assert confirm.minimum_guarantee_period == MinimumGuaranteePeriod.ANNUALLY
        assert confirm.advance_payment is None
        assert confirm.reporting_frequency == ReportingFrequency.QUARTERLY

    def test_royalty_rate_coerces_float_to_string(self):
        """A plain float royalty_rate (e.g. 0.10) is coerced to a '0.1%' string."""
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate=0.10,
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.royalty_rate == "0.1%"

    def test_royalty_rate_coerces_int_to_string(self):
        """A plain integer royalty_rate (e.g. 10) is coerced to '10%'."""
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate=10,
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.royalty_rate == "10%"

    def test_royalty_rate_string_passes_through_unchanged(self):
        """A pre-formatted string royalty_rate is not modified by the validator."""
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.royalty_rate == "8% of Net Sales"

    def test_royalty_rate_large_float_coerced(self):
        """A percentage-style float (e.g. 10.5) is coerced to '10.5%'."""
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate=10.5,
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )
        assert confirm.royalty_rate == "10.5%"

    def test_dates_are_required(self):
        """contract_start_date and contract_end_date must be provided."""
        from app.models.contract import ContractConfirm
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            ContractConfirm(
                licensee_name="Nike Inc.",
                royalty_rate="8%",
            )
        errors = exc_info.value.errors()
        missing_fields = {e["loc"][0] for e in errors if e["type"] == "missing"}
        assert "contract_start_date" in missing_fields
        assert "contract_end_date" in missing_fields


class TestContractModelNullableFields:
    """Contract response model accommodates nullable fields for drafts."""

    def test_contract_has_status_field(self):
        from app.models.contract import Contract, ContractStatus
        # Build with all required fields
        contract = Contract(
            id="c-1",
            user_id="u-1",
            status=ContractStatus.ACTIVE,
            filename="test.pdf",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert contract.status == ContractStatus.ACTIVE

    def test_contract_has_filename_field(self):
        from app.models.contract import Contract, ContractStatus
        contract = Contract(
            id="c-1",
            user_id="u-1",
            status=ContractStatus.DRAFT,
            filename="Nike_License_2024.pdf",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert contract.filename == "Nike_License_2024.pdf"

    def test_contract_filename_can_be_none(self):
        from app.models.contract import Contract, ContractStatus
        contract = Contract(
            id="c-1",
            user_id="u-1",
            status=ContractStatus.ACTIVE,
            filename=None,
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert contract.filename is None

    def test_contract_licensee_name_can_be_none(self):
        """Draft contracts have no licensee_name yet."""
        from app.models.contract import Contract, ContractStatus
        contract = Contract(
            id="c-1",
            user_id="u-1",
            status=ContractStatus.DRAFT,
            filename="test.pdf",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            licensee_name=None,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert contract.licensee_name is None

    def test_contract_royalty_rate_can_be_none(self):
        from app.models.contract import Contract, ContractStatus
        contract = Contract(
            id="c-1",
            user_id="u-1",
            status=ContractStatus.DRAFT,
            filename="test.pdf",
            pdf_url="https://example.com/test.pdf",
            extracted_terms={},
            royalty_rate=None,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert contract.royalty_rate is None


# ---------------------------------------------------------------------------
# Storage tests
# ---------------------------------------------------------------------------

class TestStorageDeterministicPath:
    """upload_contract_pdf uses deterministic path (no UUID prefix)."""

    def test_upload_uses_deterministic_path(self):
        """Storage path is contracts/{user_id}/{sanitized_filename} — no UUID prefix."""
        from app.services.storage import upload_contract_pdf

        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "Nike_License_2024.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {"path": ""}

            result = upload_contract_pdf(file_content, user_id, filename)

            assert result == f"contracts/{user_id}/{filename}"

    def test_upload_sanitizes_filename_spaces(self):
        """Spaces and special chars are replaced with underscores in the path."""
        from app.services.storage import upload_contract_pdf

        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "My Contract (2024).pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {"path": ""}

            result = upload_contract_pdf(file_content, user_id, filename)

            # No UUID prefix — just sanitized filename
            assert result == "contracts/user-123/My_Contract__2024_.pdf"
            # Verify no 8-char hex prefix before the filename
            filename_part = result.split("/")[-1]
            assert not filename_part[0:8].isalnum() or "My" in filename_part

    def test_upload_uses_upsert_true(self):
        """Upload options must include upsert: true so re-uploads overwrite orphaned files."""
        from app.services.storage import upload_contract_pdf

        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {"path": ""}

            upload_contract_pdf(file_content, user_id, filename)

            upload_call = mock_supabase.storage.from_.return_value.upload.call_args
            options = upload_call[0][2]  # third positional arg is options dict
            assert options.get("upsert") == "true"

    def test_upload_no_uuid_prefix_in_path(self):
        """The storage path must NOT start with a UUID hex before the filename."""
        from app.services.storage import upload_contract_pdf
        import re

        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {"path": ""}

            result = upload_contract_pdf(file_content, user_id, filename)

            filename_part = result.split("/")[-1]
            # Should be exactly 'contract.pdf', not 'abcd1234_contract.pdf'
            uuid_prefix_pattern = re.compile(r'^[a-f0-9]{8}_')
            assert not uuid_prefix_pattern.match(filename_part), (
                f"Filename part '{filename_part}' still has a UUID prefix"
            )


class TestStorageExistingTests:
    """Existing storage tests that need updating for no-UUID behaviour."""

    def test_successful_upload_returns_exact_path(self):
        """Upload with filename returns exact deterministic path (no UUID suffix)."""
        from app.services.storage import upload_contract_pdf

        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {
                "path": f"contracts/{user_id}/{filename}"
            }

            result = upload_contract_pdf(file_content, user_id, filename)

            assert result == f"contracts/{user_id}/{filename}"


# ---------------------------------------------------------------------------
# POST /extract — duplicate check tests
# ---------------------------------------------------------------------------

class TestExtractDuplicateCheck:
    """POST /extract returns 409 when a filename match is found."""

    @pytest.mark.asyncio
    async def test_409_duplicate_filename_for_active_contract(self):
        """Active contract with same filename → 409 DUPLICATE_FILENAME."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "Nike_License_2024.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        existing = _make_db_contract(status="active", filename="Nike_License_2024.pdf")

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # Duplicate check query returns an existing active contract
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(
                    data=[existing]
                )

            with pytest.raises(HTTPException) as exc_info:
                await extract_contract_terms(mock_file, user_id="user-123")

            assert exc_info.value.status_code == 409
            detail = exc_info.value.detail
            assert detail["code"] == "DUPLICATE_FILENAME"
            assert "existing_contract" in detail
            assert detail["existing_contract"]["id"] == existing["id"]
            assert detail["existing_contract"]["status"] == "active"
            assert "licensee_name" in detail["existing_contract"]

    @pytest.mark.asyncio
    async def test_409_incomplete_draft_for_draft_contract(self):
        """Draft contract with same filename → 409 INCOMPLETE_DRAFT."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "Nike_License_2024.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        existing = _make_draft_db_contract(
            contract_id="draft-456",
            filename="Nike_License_2024.pdf",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(
                    data=[existing]
                )

            with pytest.raises(HTTPException) as exc_info:
                await extract_contract_terms(mock_file, user_id="user-123")

            assert exc_info.value.status_code == 409
            detail = exc_info.value.detail
            assert detail["code"] == "INCOMPLETE_DRAFT"
            assert "existing_contract" in detail
            assert detail["existing_contract"]["id"] == "draft-456"
            assert detail["existing_contract"]["status"] == "draft"

    @pytest.mark.asyncio
    async def test_no_duplicate_check_proceeds_to_extraction(self):
        """No matching filename → upload and extract as normal."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "new_contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        draft_row = _make_draft_db_contract(
            contract_id="new-draft-789",
            filename="new_contract.pdf",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # No existing contract
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])
            # Draft insert returns new draft row
            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[draft_row]
            )

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_upload.return_value = "contracts/user-123/new_contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/new_contract.pdf?token=abc"
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {"licensee_name": "Test Corp"}),
                                {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
                            )
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            result = await extract_contract_terms(mock_file, user_id="user-123")

                            # Should have called upload and extract
                            mock_upload.assert_called_once()
                            mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_duplicate_check_is_case_insensitive(self):
        """Filename matching must be case-insensitive (uses ilike or lower()).
        The ilike query is passed the filename as-is and Postgres handles case.
        We simulate the DB returning a match even for mixed-case input.
        """
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        # Use lowercase .pdf but mixed-case body to test ilike is used
        mock_file.filename = "Nike_License_2024.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        # Simulate DB returning a match (case-insensitive query finds it)
        existing = _make_db_contract(status="active", filename="nike_license_2024.pdf")

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(
                    data=[existing]
                )

            with pytest.raises(HTTPException) as exc_info:
                await extract_contract_terms(mock_file, user_id="user-123")

            # Should still be 409 — match was found
            assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_duplicate_check_uses_ilike_query(self):
        """The duplicate check query uses ilike for case-insensitive filename matching."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        draft_row = _make_draft_db_contract(
            contract_id="new-draft-789",
            filename="contract.pdf",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            ilike_mock = Mock()
            ilike_mock.execute.return_value = Mock(data=[])  # no duplicates
            eq_mock = Mock()
            eq_mock.ilike.return_value = ilike_mock
            mock_supabase.table.return_value.select.return_value.eq.return_value = eq_mock

            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[draft_row]
            )

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_upload.return_value = "contracts/user-123/contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/..."
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {}),
                                {"total_tokens": 100}
                            )
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            await extract_contract_terms(mock_file, user_id="user-123")

            # Verify ilike was called (case-insensitive match)
            eq_mock.ilike.assert_called_once()
            ilike_call_args = eq_mock.ilike.call_args
            assert ilike_call_args[0][0] == "filename"
            assert ilike_call_args[0][1] == "contract.pdf"


# ---------------------------------------------------------------------------
# POST /extract — draft insertion tests
# ---------------------------------------------------------------------------

class TestExtractDraftInsertion:
    """POST /extract inserts a draft row and returns contract_id."""

    @pytest.mark.asyncio
    async def test_extract_inserts_draft_row(self):
        """After extraction, a draft row is inserted into contracts table."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        draft_row = _make_draft_db_contract(
            contract_id="draft-001",
            filename="contract.pdf",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # No duplicates
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])
            # Insert returns draft row
            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[draft_row]
            )

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_upload.return_value = "contracts/user-123/contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/signed/contract.pdf"
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {"licensee_name": "Test"}),
                                {"total_tokens": 100}
                            )
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            result = await extract_contract_terms(mock_file, user_id="user-123")

            # Verify insert was called
            mock_supabase.table.return_value.insert.assert_called_once()
            insert_data = mock_supabase.table.return_value.insert.call_args[0][0]
            assert insert_data["status"] == "draft"
            assert insert_data["filename"] == "contract.pdf"
            assert "pdf_url" in insert_data
            assert "extracted_terms" in insert_data
            assert "user_id" in insert_data

    @pytest.mark.asyncio
    async def test_extract_response_includes_contract_id(self):
        """Response from /extract includes contract_id of the new draft."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        draft_row = _make_draft_db_contract(
            contract_id="draft-999",
            filename="contract.pdf",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])
            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[draft_row]
            )

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_upload.return_value = "contracts/user-123/contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/signed/contract.pdf"
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {}),
                                {"total_tokens": 100}
                            )
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            result = await extract_contract_terms(mock_file, user_id="user-123")

            assert "contract_id" in result
            assert result["contract_id"] == "draft-999"

    @pytest.mark.asyncio
    async def test_extract_cleans_up_storage_on_extraction_failure(self):
        """If extraction fails after upload, the storage file is deleted (best-effort)."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.delete_contract_pdf') as mock_delete:
                            mock_upload.return_value = "contracts/user-123/contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/signed/contract.pdf"
                            # Extraction fails
                            mock_extract.side_effect = Exception("Claude API error")
                            mock_delete.return_value = True

                            with pytest.raises(HTTPException) as exc_info:
                                await extract_contract_terms(mock_file, user_id="user-123")

                            # Cleanup should have been attempted
                            mock_delete.assert_called_once_with("contracts/user-123/contract.pdf")
                            assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_extract_draft_insert_failure_raises_500(self):
        """If draft insert fails after extraction, a 500 is raised."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])
            # Insert returns empty data (failure)
            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[]
            )

            with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                    with patch('app.routers.contracts.extract_contract') as mock_extract:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_upload.return_value = "contracts/user-123/contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/signed/contract.pdf"
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {}),
                                {"total_tokens": 100}
                            )
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            with pytest.raises(HTTPException) as exc_info:
                                await extract_contract_terms(mock_file, user_id="user-123")

                            assert exc_info.value.status_code == 500


# ---------------------------------------------------------------------------
# PUT /{id}/confirm tests
# ---------------------------------------------------------------------------

class TestConfirmEndpoint:
    """PUT /api/contracts/{id}/confirm promotes draft to active."""

    @pytest.mark.asyncio
    async def test_confirm_promotes_draft_to_active(self):
        """Confirming a draft contract sets status='active' and populates fields."""
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm
        from datetime import date

        contract_id = "draft-123"
        user_id = "user-123"

        draft_row = _make_draft_db_contract(contract_id=contract_id)
        active_row = _make_db_contract(contract_id=contract_id, status="active")

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None

                # Fetch draft
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                # Update returns active row
                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                result = await confirm_contract(contract_id, confirm_data, user_id=user_id)

                # Verify update was called with status='active'
                update_data = mock_supabase.table.return_value.update.call_args[0][0]
                assert update_data["status"] == "active"
                assert update_data["licensee_name"] == "Nike Inc."
                assert update_data["royalty_rate"] == "8% of Net Sales"

    @pytest.mark.asyncio
    async def test_confirm_returns_contract_model(self):
        """PUT /{id}/confirm returns the updated Contract model."""
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm, Contract
        from datetime import date

        contract_id = "draft-123"
        user_id = "user-123"

        draft_row = _make_draft_db_contract(contract_id=contract_id)
        active_row = _make_db_contract(contract_id=contract_id, status="active")

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                mock_supabase.table.return_value.update.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                result = await confirm_contract(contract_id, confirm_data, user_id=user_id)

                assert isinstance(result, Contract)
                assert result.status == "active"

    @pytest.mark.asyncio
    async def test_confirm_returns_409_if_already_active(self):
        """Confirming an already-active contract returns 409."""
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm
        from datetime import date

        contract_id = "active-contract-123"
        user_id = "user-123"

        active_row = _make_db_contract(contract_id=contract_id, status="active")

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                with pytest.raises(HTTPException) as exc_info:
                    await confirm_contract(contract_id, confirm_data, user_id=user_id)

                assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_confirm_returns_404_if_contract_not_found(self):
        """Confirming a non-existent contract returns 404."""
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None

                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[])

                with pytest.raises(HTTPException) as exc_info:
                    await confirm_contract("nonexistent-id", confirm_data, user_id="user-123")

                assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_confirm_verifies_ownership(self):
        """PUT /{id}/confirm calls verify_contract_ownership."""
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm
        from datetime import date

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8% of Net Sales",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                # Ownership check raises 403
                mock_verify.side_effect = HTTPException(
                    status_code=403, detail="You are not authorized to access this contract"
                )

                with pytest.raises(HTTPException) as exc_info:
                    await confirm_contract("contract-xyz", confirm_data, user_id="user-456")

                assert exc_info.value.status_code == 403
                mock_verify.assert_called_once_with("contract-xyz", "user-456")


# ---------------------------------------------------------------------------
# GET / — status filter tests
# ---------------------------------------------------------------------------

class TestListContractsStatusFilter:
    """GET /api/contracts/ filters by status correctly."""

    @pytest.mark.asyncio
    async def test_list_returns_only_active_by_default(self):
        """Default GET / returns only active contracts."""
        from app.routers.contracts import list_contracts

        active_1 = _make_db_contract(contract_id="a-1", status="active")
        active_2 = _make_db_contract(contract_id="a-2", status="active")
        # draft should NOT appear in default response

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            eq_mock = Mock()
            eq_mock.eq.return_value.execute.return_value = Mock(data=[active_1, active_2])
            mock_supabase.table.return_value.select.return_value.eq.return_value = eq_mock

            result = await list_contracts(include_drafts=False, user_id="user-123")

            # Verify status filter was applied
            second_eq_call = eq_mock.eq.call_args
            assert second_eq_call[0] == ("status", "active")

            assert len(result) == 2

    @pytest.mark.asyncio
    async def test_list_returns_all_statuses_when_include_drafts_true(self):
        """GET /?include_drafts=true returns both active and draft contracts."""
        from app.routers.contracts import list_contracts

        active_row = _make_db_contract(contract_id="a-1", status="active")
        draft_row = _make_draft_db_contract(contract_id="d-1")

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # When include_drafts=True, no status filter applied — just eq on user_id
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.execute.return_value = Mock(data=[active_row, draft_row])

            result = await list_contracts(include_drafts=True, user_id="user-123")

            assert len(result) == 2

    @pytest.mark.asyncio
    async def test_list_include_drafts_false_filters_to_active(self):
        """include_drafts=False must apply an eq('status','active') filter."""
        from app.routers.contracts import list_contracts

        active_row = _make_db_contract(contract_id="a-1", status="active")

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # Track the chain so we can verify filter calls
            user_eq_mock = Mock()
            status_eq_mock = Mock()
            status_eq_mock.execute.return_value = Mock(data=[active_row])
            user_eq_mock.eq.return_value = status_eq_mock
            mock_supabase.table.return_value.select.return_value.eq.return_value = user_eq_mock

            result = await list_contracts(include_drafts=False, user_id="user-123")

            # Should have a second .eq() call for status
            user_eq_mock.eq.assert_called_once_with("status", "active")
            assert len(result) == 1


# ---------------------------------------------------------------------------
# 409 response shape tests
# ---------------------------------------------------------------------------

class Test409ResponseShape:
    """Verify the exact 409 response structure matches the spec."""

    @pytest.mark.asyncio
    async def test_duplicate_filename_response_shape(self):
        """DUPLICATE_FILENAME 409 has correct fields."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "Nike_License_2024.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        existing = _make_db_contract(
            contract_id="c-abc",
            status="active",
            filename="Nike_License_2024.pdf",
            licensee_name="Nike Inc.",
            created_at="2026-01-15T10:30:00Z",
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[existing])

            with pytest.raises(HTTPException) as exc_info:
                await extract_contract_terms(mock_file, user_id="user-123")

        detail = exc_info.value.detail
        assert detail["code"] == "DUPLICATE_FILENAME"
        assert "message" in detail
        ec = detail["existing_contract"]
        assert ec["id"] == "c-abc"
        assert ec["filename"] == "Nike_License_2024.pdf"
        assert ec["licensee_name"] == "Nike Inc."
        assert ec["created_at"] == "2026-01-15T10:30:00Z"
        assert ec["status"] == "active"

    @pytest.mark.asyncio
    async def test_incomplete_draft_response_shape(self):
        """INCOMPLETE_DRAFT 409 has correct fields (no licensee_name)."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "Nike_License_2024.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        existing = _make_draft_db_contract(
            contract_id="d-abc",
            filename="Nike_License_2024.pdf",
        )
        existing["created_at"] = "2026-02-19T08:15:00Z"

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            mock_supabase.table.return_value.select.return_value \
                .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[existing])

            with pytest.raises(HTTPException) as exc_info:
                await extract_contract_terms(mock_file, user_id="user-123")

        detail = exc_info.value.detail
        assert detail["code"] == "INCOMPLETE_DRAFT"
        assert "message" in detail
        ec = detail["existing_contract"]
        assert ec["id"] == "d-abc"
        assert ec["filename"] == "Nike_License_2024.pdf"
        assert ec["created_at"] == "2026-02-19T08:15:00Z"
        assert ec["status"] == "draft"
        # Draft has no licensee_name in existing_contract
        assert "licensee_name" not in ec or ec.get("licensee_name") is None


# ---------------------------------------------------------------------------
# GET /{id} — form_values for draft contracts
# ---------------------------------------------------------------------------

class TestGetContractFormValues:
    """GET /api/contracts/{id} returns form_values for draft contracts."""

    @pytest.mark.asyncio
    async def test_get_draft_includes_form_values(self):
        """Draft contract response includes a non-None form_values field."""
        from app.routers.contracts import get_contract
        from app.models.contract import ContractWithFormValues

        draft_row = _make_draft_db_contract(
            contract_id="draft-fv-1",
            filename="test.pdf",
        )
        # Provide rich extracted_terms so normalization has something to work with
        draft_row["extracted_terms"] = {
            "licensor_name": "Brand Owner",
            "licensee_name": "Nike Inc.",
            "royalty_rate": "8% of net sales",
            "royalty_base": "net sales",
            "territories": ["US", "Canada"],
            "reporting_frequency": "quarterly",
            "contract_start_date": "2024-01-01",
            "contract_end_date": "2025-12-31",
            "minimum_guarantee": "$50,000",
            "advance_payment": None,
        }

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                result = await get_contract("draft-fv-1", user_id="user-123")

                assert isinstance(result, ContractWithFormValues)
                assert result.form_values is not None

    @pytest.mark.asyncio
    async def test_get_draft_form_values_has_correct_licensee_name(self):
        """form_values.licensee_name is populated from extracted_terms."""
        from app.routers.contracts import get_contract

        draft_row = _make_draft_db_contract(contract_id="draft-fv-2", filename="test.pdf")
        draft_row["extracted_terms"] = {
            "licensee_name": "Nike Inc.",
            "licensor_name": "Brand Owner",
            "royalty_rate": "8%",
            "royalty_base": "net sales",
            "territories": [],
            "reporting_frequency": "quarterly",
            "contract_start_date": "2024-01-01",
            "contract_end_date": "2025-12-31",
            "minimum_guarantee": None,
            "advance_payment": None,
        }

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                result = await get_contract("draft-fv-2", user_id="user-123")

                assert result.form_values.licensee_name == "Nike Inc."
                assert result.form_values.licensor_name == "Brand Owner"

    @pytest.mark.asyncio
    async def test_get_draft_form_values_normalizes_royalty_rate(self):
        """form_values.royalty_rate is a normalized float, not a raw string."""
        from app.routers.contracts import get_contract

        draft_row = _make_draft_db_contract(contract_id="draft-fv-3", filename="test.pdf")
        draft_row["extracted_terms"] = {
            "licensee_name": "Test Corp",
            "licensor_name": None,
            "royalty_rate": "15% of net sales",
            "royalty_base": None,
            "territories": [],
            "reporting_frequency": None,
            "contract_start_date": None,
            "contract_end_date": None,
            "minimum_guarantee": None,
            "advance_payment": None,
        }

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                result = await get_contract("draft-fv-3", user_id="user-123")

                # "15% of net sales" -> 15.0 (float, not the raw string)
                assert result.form_values.royalty_rate == 15.0

    @pytest.mark.asyncio
    async def test_get_draft_form_values_normalizes_monetary_values(self):
        """form_values.minimum_guarantee is a float parsed from the raw string."""
        from app.routers.contracts import get_contract

        draft_row = _make_draft_db_contract(contract_id="draft-fv-4", filename="test.pdf")
        draft_row["extracted_terms"] = {
            "licensee_name": "Test Corp",
            "licensor_name": None,
            "royalty_rate": None,
            "royalty_base": None,
            "territories": [],
            "reporting_frequency": None,
            "contract_start_date": None,
            "contract_end_date": None,
            "minimum_guarantee": "$50,000 USD",
            "advance_payment": "$10,000",
        }

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                result = await get_contract("draft-fv-4", user_id="user-123")

                assert result.form_values.minimum_guarantee == 50000.0
                assert result.form_values.advance_payment == 10000.0

    @pytest.mark.asyncio
    async def test_get_active_contract_has_no_form_values(self):
        """Active contracts do not include form_values (it is None)."""
        from app.routers.contracts import get_contract
        from app.models.contract import ContractWithFormValues

        active_row = _make_db_contract(contract_id="active-1", status="active")

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[active_row])

                result = await get_contract("active-1", user_id="user-123")

                assert isinstance(result, ContractWithFormValues)
                assert result.form_values is None

    @pytest.mark.asyncio
    async def test_get_draft_form_values_none_when_extracted_terms_empty(self):
        """form_values is None when extracted_terms is empty/missing."""
        from app.routers.contracts import get_contract

        draft_row = _make_draft_db_contract(contract_id="draft-fv-5", filename="test.pdf")
        draft_row["extracted_terms"] = {}  # Empty

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[draft_row])

                result = await get_contract("draft-fv-5", user_id="user-123")

                # Empty extracted_terms is falsy — form_values should be None
                assert result.form_values is None

    @pytest.mark.asyncio
    async def test_get_contract_returns_404_if_not_found(self):
        """GET /{id} returns 404 if the contract does not exist."""
        from app.routers.contracts import get_contract

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                mock_verify.return_value = None
                mock_supabase.table.return_value.select.return_value \
                    .eq.return_value.execute.return_value = Mock(data=[])

                with pytest.raises(HTTPException) as exc_info:
                    await get_contract("nonexistent-id", user_id="user-123")

                assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_contract_verifies_ownership(self):
        """GET /{id} calls verify_contract_ownership and propagates 403."""
        from app.routers.contracts import get_contract

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            mock_verify.side_effect = HTTPException(
                status_code=403, detail="You are not authorized to access this contract"
            )

            with pytest.raises(HTTPException) as exc_info:
                await get_contract("contract-xyz", user_id="user-456")

            assert exc_info.value.status_code == 403
            mock_verify.assert_called_once_with("contract-xyz", "user-456")
