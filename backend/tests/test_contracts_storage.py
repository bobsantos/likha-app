"""
Integration tests for contracts router with Supabase Storage.
Tests PDF upload during extraction and deletion on contract removal.
"""

import pytest
import os
from unittest.mock import Mock, patch, AsyncMock
from fastapi import HTTPException

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'
os.environ['SUPABASE_SERVICE_KEY'] = 'test-service-key'


class TestExtractEndpointWithStorage:
    """Test /extract endpoint uploads PDF to storage."""

    def _mock_no_duplicate(self, mock_supabase):
        """Helper: configure supabase mock so the duplicate check returns no matches."""
        mock_supabase.table.return_value.select.return_value \
            .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])

    def _mock_draft_insert(self, mock_supabase, contract_id="draft-001", filename="test_contract.pdf"):
        """Helper: configure supabase mock to return a draft row on insert."""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
            data=[{
                "id": contract_id,
                "user_id": "user-123",
                "status": "draft",
                "filename": filename,
                "pdf_url": f"https://test.supabase.co/storage/v1/object/sign/contracts/user-123/{filename}?token=abc",
                "storage_path": f"contracts/user-123/{filename}",
                "extracted_terms": {},
                "licensee_name": None,
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
                "created_at": "2026-02-19T08:15:00Z",
                "updated_at": "2026-02-19T08:15:00Z",
            }]
        )

    @pytest.mark.asyncio
    async def test_extract_uploads_pdf_to_storage(self):
        """Extraction should upload PDF to storage and return storage path."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile
        from io import BytesIO

        # Create mock PDF file
        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "test_contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            self._mock_no_duplicate(mock_supabase)
            self._mock_draft_insert(mock_supabase)

            with patch('app.routers.contracts.extract_contract') as mock_extract:
                with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                    with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            # Mock extraction returning terms
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {"licensee_name": "Test Corp"}),
                                {"input_tokens": 100, "output_tokens": 50}
                            )

                            # Mock storage upload
                            mock_upload.return_value = "contracts/user-123/test_contract.pdf"

                            # Mock signed URL generation
                            mock_signed_url.return_value = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/test_contract.pdf?token=abc"

                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            result = await extract_contract_terms(mock_file, user_id="user-123")

                            # Verify PDF was uploaded to storage
                            mock_upload.assert_called_once()
                            upload_call = mock_upload.call_args
                            assert upload_call[0][0] == pdf_content  # file_content
                            assert upload_call[0][1] == "user-123"  # user_id
                            assert "test_contract.pdf" in upload_call[0][2]  # filename

                            # Verify response includes storage path
                            assert "storage_path" in result
                            assert result["storage_path"] == "contracts/user-123/test_contract.pdf"

    @pytest.mark.asyncio
    async def test_extract_returns_signed_url(self):
        """Extraction should return a signed URL for the uploaded PDF."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile
        from io import BytesIO

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "test_contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            self._mock_no_duplicate(mock_supabase)
            self._mock_draft_insert(mock_supabase)

            with patch('app.routers.contracts.extract_contract') as mock_extract:
                with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                    with patch('app.routers.contracts.get_signed_url') as mock_signed_url:
                        with patch('app.routers.contracts.normalize_extracted_terms') as mock_norm:
                            mock_extract.return_value = (
                                Mock(model_dump=lambda: {"licensee_name": "Test Corp"}),
                                {"input_tokens": 100, "output_tokens": 50}
                            )

                            mock_upload.return_value = "contracts/user-123/test_contract.pdf"
                            mock_signed_url.return_value = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/test_contract.pdf?token=abc123"
                            mock_norm.return_value = Mock(model_dump=lambda: {})

                            result = await extract_contract_terms(mock_file, user_id="user-123")

                            # Verify signed URL was generated
                            mock_signed_url.assert_called_once_with("contracts/user-123/test_contract.pdf")

                            # Verify response includes PDF URL
                            assert "pdf_url" in result
                            assert result["pdf_url"].startswith("https://")
                            assert "test_contract.pdf" in result["pdf_url"]

    @pytest.mark.asyncio
    async def test_extract_cleans_up_temp_file_on_storage_failure(self):
        """If storage upload fails, temp file should still be cleaned up."""
        from app.routers.contracts import extract_contract_terms
        from fastapi import UploadFile

        pdf_content = b"%PDF-1.4 fake pdf content"
        mock_file = Mock(spec=UploadFile)
        mock_file.filename = "test_contract.pdf"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            self._mock_no_duplicate(mock_supabase)

            with patch('app.routers.contracts.extract_contract') as mock_extract:
                with patch('app.routers.contracts.upload_contract_pdf') as mock_upload:
                    with patch('os.unlink') as mock_unlink:
                        mock_extract.return_value = (
                            Mock(model_dump=lambda: {"licensee_name": "Test Corp"}),
                            {"input_tokens": 100, "output_tokens": 50}
                        )

                        # Mock storage upload failure
                        mock_upload.side_effect = Exception("Storage error")

                        with pytest.raises(HTTPException) as exc_info:
                            await extract_contract_terms(mock_file, user_id="user-123")

                        # Verify temp file was still cleaned up
                        assert mock_unlink.called
                        assert "Storage error" in str(exc_info.value.detail) or "Extraction failed" in str(exc_info.value.detail)


class TestCreateContractWithStorage:
    """Test creating contract uses storage URL."""

    @pytest.mark.asyncio
    async def test_create_contract_uses_provided_pdf_url(self):
        """Create contract should use the PDF URL from extraction."""
        from app.routers.contracts import create_contract
        from app.models.contract import ContractCreate, ExtractedTerms
        from decimal import Decimal
        from datetime import date

        contract_data = ContractCreate(
            licensee_name="Test Corp",
            pdf_url="https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc",
            extracted_terms=ExtractedTerms(),
            royalty_rate="8% of Net Sales",
            royalty_base="net_sales",
            territories=["USA"],
            product_categories=None,
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
            minimum_guarantee=Decimal("10000"),
            minimum_guarantee_period="quarterly",
            advance_payment=None,
            reporting_frequency="quarterly"
        )

        with patch('app.routers.contracts.supabase_admin') as mock_supabase:
            # Mock database insert
            mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
                data=[{
                    "id": "contract-123",
                    "user_id": "user-123",
                    "status": "active",
                    "filename": "contract.pdf",
                    "licensee_name": "Test Corp",
                    "pdf_url": contract_data.pdf_url,
                    "extracted_terms": {},
                    "royalty_rate": "8% of Net Sales",
                    "royalty_base": "net_sales",
                    "territories": ["USA"],
                    "product_categories": None,
                    "contract_start_date": "2024-01-01",
                    "contract_end_date": "2025-12-31",
                    "minimum_guarantee": "10000",
                    "minimum_guarantee_period": "quarterly",
                    "advance_payment": None,
                    "reporting_frequency": "quarterly",
                    "storage_path": None,
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z"
                }]
            )

            result = await create_contract(contract_data, user_id="user-123")

            # Verify the contract was created with the storage URL
            insert_call = mock_supabase.table.return_value.insert.call_args
            assert insert_call[0][0]["pdf_url"] == contract_data.pdf_url
            assert "https://test.supabase.co" in insert_call[0][0]["pdf_url"]


class TestDeleteContractWithStorage:
    """Test deleting contract also deletes PDF from storage."""

    @pytest.mark.asyncio
    async def test_delete_contract_removes_pdf_from_storage(self):
        """Deleting a contract should also delete the PDF from storage."""
        from app.routers.contracts import delete_contract

        contract_id = "contract-123"
        user_id = "user-123"
        pdf_url = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc"

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                with patch('app.routers.contracts.delete_contract_pdf') as mock_delete_pdf:
                    # Mock ownership verification (async)
                    mock_verify.return_value = None

                    # Mock fetching contract to get PDF URL
                    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{
                            "id": contract_id,
                            "user_id": user_id,
                            "pdf_url": pdf_url,
                            "licensee_name": "Test Corp"
                        }]
                    )

                    # Mock contract deletion
                    mock_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{"id": contract_id}]
                    )

                    # Mock PDF deletion
                    mock_delete_pdf.return_value = True

                    result = await delete_contract(contract_id, user_id)

                    # Verify PDF was deleted from storage
                    mock_delete_pdf.assert_called_once_with(pdf_url)

                    assert result["message"] == "Contract deleted"

    @pytest.mark.asyncio
    async def test_delete_contract_continues_if_pdf_not_found(self):
        """Contract deletion should succeed even if PDF not found in storage."""
        from app.routers.contracts import delete_contract

        contract_id = "contract-123"
        user_id = "user-123"
        pdf_url = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc"

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                with patch('app.routers.contracts.delete_contract_pdf') as mock_delete_pdf:
                    mock_verify.return_value = None

                    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{
                            "id": contract_id,
                            "user_id": user_id,
                            "pdf_url": pdf_url,
                            "licensee_name": "Test Corp"
                        }]
                    )

                    mock_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{"id": contract_id}]
                    )

                    # Mock PDF not found (returns False)
                    mock_delete_pdf.return_value = False

                    result = await delete_contract(contract_id, user_id)

                    # Contract should still be deleted successfully
                    assert result["message"] == "Contract deleted"

    @pytest.mark.asyncio
    async def test_delete_contract_continues_on_storage_error(self):
        """Contract deletion should succeed even if storage deletion fails."""
        from app.routers.contracts import delete_contract

        contract_id = "contract-123"
        user_id = "user-123"
        pdf_url = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc"

        with patch('app.routers.contracts.verify_contract_ownership') as mock_verify:
            with patch('app.routers.contracts.supabase_admin') as mock_supabase:
                with patch('app.routers.contracts.delete_contract_pdf') as mock_delete_pdf:
                    mock_verify.return_value = None

                    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{
                            "id": contract_id,
                            "user_id": user_id,
                            "pdf_url": pdf_url,
                            "licensee_name": "Test Corp"
                        }]
                    )

                    mock_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = Mock(
                        data=[{"id": contract_id}]
                    )

                    # Mock storage deletion failure (raises exception)
                    mock_delete_pdf.side_effect = Exception("Storage error")

                    result = await delete_contract(contract_id, user_id)

                    # Contract should still be deleted successfully (storage error is logged but not raised)
                    assert result["message"] == "Contract deleted"
