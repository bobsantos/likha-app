"""
Unit tests for Supabase Storage service.
Tests PDF upload, signed URL generation, and deletion.
"""

import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'

from app.services.storage import upload_contract_pdf, delete_contract_pdf, get_signed_url


class TestUploadContractPdf:
    """Test PDF upload to Supabase Storage."""

    def test_successful_upload_returns_storage_path(self):
        """Uploading a PDF should return the storage path."""
        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock successful upload
            mock_supabase.storage.from_.return_value.upload.return_value = {
                "path": f"contracts/{user_id}/{filename}"
            }

            result = upload_contract_pdf(file_content, user_id, filename)

            # Result includes a short UUID prefix to avoid 409 Conflict on duplicate names,
            # so match the directory prefix and the sanitized base filename instead of exact path.
            assert result.startswith(f"contracts/{user_id}/")
            assert result.endswith(f"_{filename}")
            mock_supabase.storage.from_.assert_called_once_with("contracts")

    def test_upload_generates_unique_filename_if_not_provided(self):
        """If no filename is provided, should generate a unique one with UUID."""
        file_content = b"fake pdf content"
        user_id = "user-123"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            with patch('app.services.storage.uuid4') as mock_uuid:
                mock_uuid.return_value = Mock(hex="abc123")

                mock_supabase.storage.from_.return_value.upload.return_value = {
                    "path": f"contracts/{user_id}/abc123.pdf"
                }

                result = upload_contract_pdf(file_content, user_id)

                assert result == f"contracts/{user_id}/abc123.pdf"
                # Verify UUID was used in the path
                mock_supabase.storage.from_.return_value.upload.assert_called_once()
                upload_call_args = mock_supabase.storage.from_.return_value.upload.call_args
                assert "abc123.pdf" in upload_call_args[0][0]

    def test_upload_failure_raises_exception(self):
        """Failed upload should raise an exception."""
        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock upload failure
            mock_supabase.storage.from_.return_value.upload.side_effect = Exception("Storage error")

            with pytest.raises(Exception) as exc_info:
                upload_contract_pdf(file_content, user_id, filename)

            assert "Storage error" in str(exc_info.value)

    def test_upload_with_sanitized_filename(self):
        """Filename with spaces and special characters should be sanitized."""
        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "My Contract (2024).pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {
                "path": f"contracts/{user_id}/My_Contract__2024_.pdf"
            }

            result = upload_contract_pdf(file_content, user_id, filename)

            # Verify the filename was sanitized in the upload call
            upload_call_args = mock_supabase.storage.from_.return_value.upload.call_args
            uploaded_path = upload_call_args[0][0]
            # Should have underscores instead of spaces/special chars (parentheses and spaces replaced)
            assert "My_Contract" in uploaded_path
            assert ".pdf" in uploaded_path
            # Should not contain original special characters
            assert "(" not in uploaded_path
            assert ")" not in uploaded_path


class TestGetSignedUrl:
    """Test generating signed URLs for PDFs."""

    def test_get_signed_url_returns_public_url(self):
        """Should return a signed URL for accessing the PDF."""
        storage_path = "contracts/user-123/contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock signed URL generation
            mock_supabase.storage.from_.return_value.create_signed_url.return_value = {
                "signedURL": "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc123"
            }

            result = get_signed_url(storage_path)

            assert result.startswith("https://")
            assert "contract.pdf" in result
            mock_supabase.storage.from_.assert_called_once_with("contracts")
            mock_supabase.storage.from_.return_value.create_signed_url.assert_called_once_with(
                storage_path, 3600  # 1 hour expiry
            )

    def test_get_signed_url_with_custom_expiry(self):
        """Should support custom expiry time."""
        storage_path = "contracts/user-123/contract.pdf"
        expiry_seconds = 7200  # 2 hours

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.create_signed_url.return_value = {
                "signedURL": "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc123"
            }

            result = get_signed_url(storage_path, expiry_seconds)

            mock_supabase.storage.from_.return_value.create_signed_url.assert_called_once_with(
                storage_path, expiry_seconds
            )

    def test_get_signed_url_failure_raises_exception(self):
        """Failed signed URL generation should raise an exception."""
        storage_path = "contracts/user-123/contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.create_signed_url.side_effect = Exception("URL generation failed")

            with pytest.raises(Exception) as exc_info:
                get_signed_url(storage_path)

            assert "URL generation failed" in str(exc_info.value)


class TestDeleteContractPdf:
    """Test PDF deletion from Supabase Storage."""

    def test_successful_delete_returns_true(self):
        """Deleting a PDF should return True on success."""
        storage_path = "contracts/user-123/contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock successful deletion
            mock_supabase.storage.from_.return_value.remove.return_value = [
                {"name": "contract.pdf"}
            ]

            result = delete_contract_pdf(storage_path)

            assert result is True
            mock_supabase.storage.from_.assert_called_once_with("contracts")
            mock_supabase.storage.from_.return_value.remove.assert_called_once_with([storage_path])

    def test_delete_nonexistent_file_returns_false(self):
        """Deleting a non-existent file should return False."""
        storage_path = "contracts/user-123/nonexistent.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock deletion returning empty list (file not found)
            mock_supabase.storage.from_.return_value.remove.return_value = []

            result = delete_contract_pdf(storage_path)

            assert result is False

    def test_delete_failure_raises_exception(self):
        """Failed deletion should raise an exception."""
        storage_path = "contracts/user-123/contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock deletion failure
            mock_supabase.storage.from_.return_value.remove.side_effect = Exception("Deletion failed")

            with pytest.raises(Exception) as exc_info:
                delete_contract_pdf(storage_path)

            assert "Deletion failed" in str(exc_info.value)

    def test_delete_with_url_instead_of_path(self):
        """Should extract storage path from full URL if provided."""
        full_url = "https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc123"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.remove.return_value = [
                {"name": "contract.pdf"}
            ]

            result = delete_contract_pdf(full_url)

            assert result is True
            # Verify it extracted the path correctly
            mock_supabase.storage.from_.return_value.remove.assert_called_once()
            call_args = mock_supabase.storage.from_.return_value.remove.call_args
            # Should have extracted just the path
            assert "contracts/user-123/contract.pdf" in call_args[0][0]
