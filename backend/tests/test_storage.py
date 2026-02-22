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

from app.services.storage import upload_contract_pdf, delete_contract_pdf, get_signed_url, upload_sales_report, _rewrite_signed_url_host


class TestUploadContractPdf:
    """Test PDF upload to Supabase Storage."""

    def test_successful_upload_returns_storage_path(self):
        """Uploading a PDF should return the deterministic storage path (no UUID prefix)."""
        file_content = b"fake pdf content"
        user_id = "user-123"
        filename = "contract.pdf"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            # Mock successful upload
            mock_supabase.storage.from_.return_value.upload.return_value = {
                "path": f"contracts/{user_id}/{filename}"
            }

            result = upload_contract_pdf(file_content, user_id, filename)

            # Path is deterministic: contracts/{user_id}/{sanitized_filename}
            assert result == f"contracts/{user_id}/{filename}"
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


class TestRewriteSignedUrlHost:
    """Test _rewrite_signed_url_host helper."""

    def test_no_env_var_returns_url_unchanged(self):
        """When SUPABASE_PUBLIC_URL is not set, the URL is returned as-is."""
        url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/user-1/file.pdf?token=abc"
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SUPABASE_PUBLIC_URL", None)
            result = _rewrite_signed_url_host(url)
        assert result == url

    def test_env_var_set_replaces_host_and_scheme(self):
        """When SUPABASE_PUBLIC_URL is set, scheme+host are replaced."""
        url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/user-1/file.pdf?token=abc"
        expected = "http://localhost:54321/storage/v1/object/sign/contracts/user-1/file.pdf?token=abc"
        with patch.dict(os.environ, {"SUPABASE_PUBLIC_URL": "http://localhost:54321"}):
            result = _rewrite_signed_url_host(url)
        assert result == expected

    def test_production_url_replacement(self):
        """Works when replacing an internal URL with a production Supabase URL."""
        url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/user-1/file.pdf?token=xyz"
        expected = "https://myproject.supabase.co/storage/v1/object/sign/contracts/user-1/file.pdf?token=xyz"
        with patch.dict(os.environ, {"SUPABASE_PUBLIC_URL": "https://myproject.supabase.co"}):
            result = _rewrite_signed_url_host(url)
        assert result == expected

    def test_path_query_fragment_preserved(self):
        """Path, query string, and fragment are kept exactly as-is after rewrite."""
        url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/u/f.xlsx?token=tok&foo=bar"
        with patch.dict(os.environ, {"SUPABASE_PUBLIC_URL": "http://localhost:54321"}):
            result = _rewrite_signed_url_host(url)
        assert result.endswith("/storage/v1/object/sign/contracts/u/f.xlsx?token=tok&foo=bar")

    def test_empty_env_var_returns_url_unchanged(self):
        """Empty string env var is treated the same as unset — URL is returned unchanged."""
        url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/u/f.pdf?token=t"
        with patch.dict(os.environ, {"SUPABASE_PUBLIC_URL": ""}):
            result = _rewrite_signed_url_host(url)
        assert result == url


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

    def test_get_signed_url_rewrites_docker_host_when_env_set(self):
        """When SUPABASE_PUBLIC_URL is set, the docker-internal host is replaced."""
        storage_path = "contracts/user-123/report.xlsx"
        docker_url = "http://host.docker.internal:54321/storage/v1/object/sign/contracts/user-123/report.xlsx?token=tok"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.create_signed_url.return_value = {
                "signedURL": docker_url
            }
            with patch.dict(os.environ, {"SUPABASE_PUBLIC_URL": "http://localhost:54321"}):
                result = get_signed_url(storage_path)

        assert "host.docker.internal" not in result
        assert result.startswith("http://localhost:54321")


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


class TestUploadSalesReport:
    """Test sales report spreadsheet upload to Supabase Storage."""

    def test_successful_xlsx_upload_returns_storage_path(self):
        """Uploading an xlsx report returns the correct storage path."""
        file_content = b"fake xlsx content"
        user_id = "user-123"
        contract_id = "contract-456"
        filename = "Q1_report.xlsx"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            result = upload_sales_report(file_content, user_id, contract_id, filename)

        assert result == f"sales-reports/{user_id}/{contract_id}/{filename}"
        mock_supabase.storage.from_.assert_called_once_with("contracts")

    def test_successful_csv_upload_returns_storage_path(self):
        """Uploading a csv report returns the correct storage path."""
        file_content = b"date,net_sales\n2025-01-01,50000"
        user_id = "user-123"
        contract_id = "contract-456"
        filename = "sales.csv"

        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            result = upload_sales_report(file_content, user_id, contract_id, filename)

        assert result == f"sales-reports/{user_id}/{contract_id}/{filename}"

    def test_xlsx_upload_uses_correct_content_type(self):
        """xlsx files should use the xlsx MIME type."""
        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            upload_sales_report(b"data", "user-1", "contract-1", "report.xlsx")

        upload_call_args = mock_supabase.storage.from_.return_value.upload.call_args
        options = upload_call_args[0][2]
        assert options["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def test_csv_upload_uses_correct_content_type(self):
        """csv files should use text/csv MIME type."""
        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            upload_sales_report(b"data", "user-1", "contract-1", "report.csv")

        upload_call_args = mock_supabase.storage.from_.return_value.upload.call_args
        options = upload_call_args[0][2]
        assert options["content-type"] == "text/csv"

    def test_upload_uses_upsert(self):
        """Sales report uploads should use upsert to allow re-uploads."""
        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            upload_sales_report(b"data", "user-1", "contract-1", "report.xlsx")

        upload_call_args = mock_supabase.storage.from_.return_value.upload.call_args
        options = upload_call_args[0][2]
        assert options["upsert"] == "true"

    def test_filename_with_spaces_is_sanitized(self):
        """Spaces and special chars in filename should be replaced with underscores."""
        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.return_value = {}

            result = upload_sales_report(b"data", "user-1", "contract-1", "Q1 Sales Report (2025).xlsx")

        assert " " not in result
        assert "(" not in result
        assert ")" not in result
        assert ".xlsx" in result

    def test_upload_failure_raises_exception(self):
        """Failed upload should raise an exception with context."""
        with patch('app.services.storage.supabase_admin') as mock_supabase:
            mock_supabase.storage.from_.return_value.upload.side_effect = Exception("Network error")

            with pytest.raises(Exception) as exc_info:
                upload_sales_report(b"data", "user-1", "contract-1", "report.xlsx")

        assert "Failed to upload sales report to storage" in str(exc_info.value)
        assert "Network error" in str(exc_info.value)

    def test_missing_service_key_raises_value_error(self):
        """Should raise ValueError when supabase_admin is None."""
        with patch('app.services.storage.supabase_admin', None):
            with pytest.raises(ValueError, match="SUPABASE_SERVICE_KEY"):
                upload_sales_report(b"data", "user-1", "contract-1", "report.xlsx")
