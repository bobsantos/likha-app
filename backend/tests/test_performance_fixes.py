"""
TDD tests for the top 3 backend performance fixes.

Issue 1: Local JWT verification (avoid network call on every request)
Issue 2: verify_contract_ownership returns the contract row (avoid double DB fetch)
Issue 3: list_contracts skips signed URL refresh (avoid N network calls in loop)

Tests written BEFORE implementation; they must fail initially, then pass after fixes.
"""

import pytest
import os
from unittest.mock import Mock, patch, AsyncMock

# Set env vars before any app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_contract(
    contract_id="contract-123",
    user_id="user-123",
    status="active",
    filename="Nike_License_2024.pdf",
    licensee_name="Nike Inc.",
    storage_path=None,
):
    """Return a minimal contracts row dict."""
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": status,
        "filename": filename,
        "licensee_name": licensee_name,
        "pdf_url": "https://test.supabase.co/storage/v1/object/sign/test?token=abc",
        "extracted_terms": {},
        "royalty_rate": "8%",
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2024-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": "0",
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": storage_path or f"contracts/{user_id}/{filename}",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


def _make_valid_jwt(user_id: str = "user-123", secret: str = "test-jwt-secret") -> str:
    """Build a valid HS256 JWT signed with the given secret."""
    import jwt as pyjwt
    import time
    payload = {
        "sub": user_id,
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
        "iss": "supabase",
        "role": "authenticated",
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _make_expired_jwt(user_id: str = "user-123", secret: str = "test-jwt-secret") -> str:
    """Build an expired HS256 JWT."""
    import jwt as pyjwt
    import time
    payload = {
        "sub": user_id,
        "exp": int(time.time()) - 3600,  # already expired
        "iat": int(time.time()) - 7200,
        "iss": "supabase",
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


# ===========================================================================
# Issue 1: Local JWT verification — no network call to Supabase Auth API
# ===========================================================================

class TestLocalJWTVerification:
    """
    get_current_user must verify the JWT locally using SUPABASE_JWT_SECRET
    instead of calling supabase.auth.get_user() on every request.
    """

    @pytest.mark.asyncio
    async def test_valid_jwt_with_secret_returns_user_id(self):
        """A valid JWT signed with SUPABASE_JWT_SECRET should return sub as user_id."""
        from app.auth import get_current_user

        secret = "test-jwt-secret"
        user_id = "user-abc-123"
        token = _make_valid_jwt(user_id=user_id, secret=secret)

        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": secret}):
            # Reload auth module to pick up the env var
            with patch("app.auth.SUPABASE_JWT_SECRET", secret):
                result = await get_current_user(f"Bearer {token}")

        assert result == user_id

    @pytest.mark.asyncio
    async def test_valid_jwt_does_not_call_supabase_auth(self):
        """With SUPABASE_JWT_SECRET set, supabase.auth.get_user must NOT be called."""
        from app.auth import get_current_user

        secret = "test-jwt-secret"
        token = _make_valid_jwt(user_id="user-123", secret=secret)

        with patch("app.auth.SUPABASE_JWT_SECRET", secret):
            with patch("app.auth.supabase") as mock_supabase:
                await get_current_user(f"Bearer {token}")
                # supabase.auth.get_user must not have been called
                mock_supabase.auth.get_user.assert_not_called()

    @pytest.mark.asyncio
    async def test_expired_jwt_raises_401_expired(self):
        """An expired JWT should raise HTTPException 401 with 'expired' detail."""
        from app.auth import get_current_user

        secret = "test-jwt-secret"
        token = _make_expired_jwt(secret=secret)

        with patch("app.auth.SUPABASE_JWT_SECRET", secret):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {token}")

        assert exc_info.value.status_code == 401
        assert "expired" in str(exc_info.value.detail).lower()

    @pytest.mark.asyncio
    async def test_jwt_signed_with_wrong_secret_raises_401(self):
        """A JWT signed with a different secret should raise 401."""
        from app.auth import get_current_user

        token = _make_valid_jwt(secret="wrong-secret")

        with patch("app.auth.SUPABASE_JWT_SECRET", "correct-secret"):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {token}")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_authorization_header_raises_401(self):
        """Missing Authorization header should raise 401."""
        from app.auth import get_current_user

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(None)

        assert exc_info.value.status_code == 401
        assert "Not authenticated" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_missing_bearer_prefix_raises_401(self):
        """Token without 'Bearer ' prefix should raise 401."""
        from app.auth import get_current_user

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user("some.jwt.token")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_garbage_token_raises_401(self):
        """A completely invalid token string should raise 401."""
        from app.auth import get_current_user

        with patch("app.auth.SUPABASE_JWT_SECRET", "test-jwt-secret"):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user("Bearer not.a.real.token")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_no_sub_claim_raises_401(self):
        """A JWT without a 'sub' claim should raise 401."""
        from app.auth import get_current_user
        import jwt as pyjwt
        import time

        secret = "test-jwt-secret"
        # JWT with no 'sub' field
        payload = {"exp": int(time.time()) + 3600, "iss": "supabase"}
        token = pyjwt.encode(payload, secret, algorithm="HS256")

        with patch("app.auth.SUPABASE_JWT_SECRET", secret):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {token}")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_fallback_to_supabase_when_no_jwt_secret(self):
        """
        When SUPABASE_JWT_SECRET is not set (None/empty), fall back to
        calling supabase.auth.get_user() to preserve backward compatibility.
        """
        from app.auth import get_current_user

        with patch("app.auth.SUPABASE_JWT_SECRET", None):
            with patch("app.auth.supabase") as mock_supabase:
                mock_supabase.auth.get_user.return_value = Mock(
                    user=Mock(id="user-fallback")
                )
                result = await get_current_user("Bearer some.old.token")

        assert result == "user-fallback"
        mock_supabase.auth.get_user.assert_called_once_with("some.old.token")


# ===========================================================================
# Issue 2: verify_contract_ownership returns contract row (no double fetch)
# ===========================================================================

class TestVerifyContractOwnershipReturnsRow:
    """
    verify_contract_ownership must return the full contract dict so that
    callers can reuse it without a second SELECT.
    """

    @pytest.mark.asyncio
    async def test_returns_contract_dict_on_success(self):
        """verify_contract_ownership should return the contract row dict."""
        from app.auth import verify_contract_ownership

        contract_id = "contract-123"
        user_id = "user-123"
        row = _make_db_contract(contract_id=contract_id, user_id=user_id)

        with patch("app.auth.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[row]
            )
            result = await verify_contract_ownership(contract_id, user_id)

        # Must return the contract row, not None
        assert result is not None
        assert isinstance(result, dict)
        assert result["id"] == contract_id
        assert result["user_id"] == user_id

    @pytest.mark.asyncio
    async def test_returns_full_contract_data(self):
        """Returned dict contains all fields from the DB row."""
        from app.auth import verify_contract_ownership

        contract_id = "contract-abc"
        user_id = "user-xyz"
        row = _make_db_contract(
            contract_id=contract_id,
            user_id=user_id,
            licensee_name="ACME Corp",
        )

        with patch("app.auth.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[row]
            )
            result = await verify_contract_ownership(contract_id, user_id)

        assert result["licensee_name"] == "ACME Corp"
        assert result["status"] == "active"

    @pytest.mark.asyncio
    async def test_contract_not_found_still_raises_404(self):
        """404 behaviour must be preserved."""
        from app.auth import verify_contract_ownership

        with patch("app.auth.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[]
            )
            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership("missing", "user-123")

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_wrong_owner_still_raises_403(self):
        """403 behaviour must be preserved."""
        from app.auth import verify_contract_ownership

        row = _make_db_contract(contract_id="c-1", user_id="other-user")

        with patch("app.auth.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[row]
            )
            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership("c-1", "current-user")

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_db_error_still_raises_500(self):
        """500 behaviour must be preserved."""
        from app.auth import verify_contract_ownership

        with patch("app.auth.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception(
                "DB error"
            )
            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership("c-1", "user-123")

        assert exc_info.value.status_code == 500


class TestConfirmContractNoDoubleFetch:
    """
    PUT /{contract_id}/confirm must use the contract row returned by
    verify_contract_ownership instead of re-fetching from DB.
    """

    @pytest.mark.asyncio
    async def test_confirm_does_not_fetch_contract_after_ownership_check(self):
        """
        The DB must be queried at most once for SELECT (ownership check),
        not twice (ownership check + status check).
        """
        from app.routers.contracts import confirm_contract
        from app.models.contract import ContractConfirm
        from datetime import date
        from decimal import Decimal

        user_id = "user-123"
        contract_id = "contract-123"
        row = _make_db_contract(contract_id=contract_id, user_id=user_id, status="draft")

        confirm_data = ContractConfirm(
            licensee_name="Nike Inc.",
            royalty_rate="8%",
            contract_start_date=date(2024, 1, 1),
            contract_end_date=date(2025, 12, 31),
        )

        with patch("app.routers.contracts.verify_contract_ownership", new_callable=AsyncMock) as mock_verify:
            mock_verify.return_value = row  # ownership check returns the row

            with patch("app.routers.contracts.supabase_admin") as mock_db:
                # The UPDATE should succeed
                mock_db.table.return_value.update.return_value.eq.return_value.execute.return_value = Mock(
                    data=[{**row, "status": "active"}]
                )

                await confirm_contract(contract_id, confirm_data, user_id=user_id)

                # SELECT must NOT be called — only UPDATE
                mock_db.table.assert_called()
                calls = [str(call) for call in mock_db.method_calls]
                # No separate select after verify_contract_ownership
                select_calls = [c for c in calls if ".select(" in c]
                assert len(select_calls) == 0, (
                    f"Unexpected SELECT call after ownership check: {select_calls}"
                )


class TestGetContractNoDoubleFetch:
    """
    GET /{contract_id} must reuse the contract row from verify_contract_ownership.
    """

    @pytest.mark.asyncio
    async def test_get_contract_does_not_refetch_after_ownership_check(self):
        """
        After verify_contract_ownership returns the row, get_contract must
        not issue another SELECT.
        """
        from app.routers.contracts import get_contract

        user_id = "user-123"
        contract_id = "contract-123"
        row = _make_db_contract(contract_id=contract_id, user_id=user_id, status="active")

        with patch("app.routers.contracts.verify_contract_ownership", new_callable=AsyncMock) as mock_verify:
            mock_verify.return_value = row  # ownership check returns the row

            with patch("app.routers.contracts.supabase_admin") as mock_db:
                with patch("app.routers.contracts._refresh_pdf_url", side_effect=lambda c: c):
                    await get_contract(contract_id, user_id=user_id)

                # SELECT must NOT be called — row came from ownership check
                calls = [str(call) for call in mock_db.method_calls]
                select_calls = [c for c in calls if ".select(" in c]
                assert len(select_calls) == 0, (
                    f"Unexpected SELECT after ownership check: {select_calls}"
                )


class TestDeleteContractNoDoubleFetch:
    """
    DELETE /{contract_id} must reuse the contract row from verify_contract_ownership.
    """

    @pytest.mark.asyncio
    async def test_delete_contract_does_not_refetch_after_ownership_check(self):
        """
        After verify_contract_ownership returns the row, delete_contract must
        not issue another SELECT for the contract.
        """
        from app.routers.contracts import delete_contract

        user_id = "user-123"
        contract_id = "contract-123"
        row = _make_db_contract(contract_id=contract_id, user_id=user_id)

        with patch("app.routers.contracts.verify_contract_ownership", new_callable=AsyncMock) as mock_verify:
            mock_verify.return_value = row  # ownership check returns the row

            with patch("app.routers.contracts.supabase_admin") as mock_db:
                with patch("app.routers.contracts.delete_contract_pdf"):
                    mock_db.table.return_value.delete.return_value.eq.return_value.execute.return_value = Mock(
                        data=[row]
                    )
                    await delete_contract(contract_id, user_id=user_id)

                calls = [str(call) for call in mock_db.method_calls]
                select_calls = [c for c in calls if ".select(" in c]
                assert len(select_calls) == 0, (
                    f"Unexpected SELECT after ownership check: {select_calls}"
                )


# ===========================================================================
# Issue 3: list_contracts skips signed URL refresh
# ===========================================================================

class TestListContractsSkipsSignedUrlRefresh:
    """
    GET /contracts/ (list) must NOT call get_signed_url for each contract.
    The stored pdf_url should be returned as-is.
    Only the single-contract GET /{id} should refresh the signed URL.
    """

    @pytest.mark.asyncio
    async def test_list_contracts_does_not_call_get_signed_url(self):
        """get_signed_url must not be called when listing contracts."""
        from app.routers.contracts import list_contracts

        user_id = "user-123"
        rows = [
            _make_db_contract(contract_id="c-1", user_id=user_id),
            _make_db_contract(contract_id="c-2", user_id=user_id),
            _make_db_contract(contract_id="c-3", user_id=user_id),
        ]

        with patch("app.routers.contracts.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value \
                .eq.return_value.eq.return_value.execute.return_value = Mock(data=rows)

            with patch("app.routers.contracts.get_signed_url") as mock_signed_url:
                await list_contracts(include_drafts=False, user_id=user_id)
                mock_signed_url.assert_not_called()

    @pytest.mark.asyncio
    async def test_list_contracts_returns_stored_pdf_url(self):
        """The stored pdf_url is returned unchanged for each contract in the list."""
        from app.routers.contracts import list_contracts

        user_id = "user-123"
        stored_url = "https://test.supabase.co/storage/existing-url?token=abc"
        row = _make_db_contract(contract_id="c-1", user_id=user_id)
        row["pdf_url"] = stored_url
        row["storage_path"] = "contracts/user-123/test.pdf"

        with patch("app.routers.contracts.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value \
                .eq.return_value.eq.return_value.execute.return_value = Mock(data=[row])

            result = await list_contracts(include_drafts=False, user_id=user_id)

        assert len(result) == 1
        assert result[0].pdf_url == stored_url

    @pytest.mark.asyncio
    async def test_list_contracts_with_include_drafts_also_skips_refresh(self):
        """Signed URL refresh is skipped regardless of include_drafts flag."""
        from app.routers.contracts import list_contracts

        user_id = "user-123"
        rows = [
            _make_db_contract(contract_id="c-1", user_id=user_id, status="active"),
            _make_db_contract(contract_id="c-2", user_id=user_id, status="draft"),
        ]

        with patch("app.routers.contracts.supabase_admin") as mock_db:
            mock_db.table.return_value.select.return_value \
                .eq.return_value.execute.return_value = Mock(data=rows)

            with patch("app.routers.contracts.get_signed_url") as mock_signed_url:
                await list_contracts(include_drafts=True, user_id=user_id)
                mock_signed_url.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_contract_single_still_refreshes_url(self):
        """
        The single-contract GET endpoint should still refresh the signed URL
        (only the list endpoint skips it).
        """
        from app.routers.contracts import get_contract

        user_id = "user-123"
        contract_id = "contract-123"
        row = _make_db_contract(
            contract_id=contract_id,
            user_id=user_id,
            status="active",
        )

        with patch("app.routers.contracts.verify_contract_ownership", new_callable=AsyncMock) as mock_verify:
            mock_verify.return_value = row

            with patch("app.routers.contracts.get_signed_url") as mock_signed_url:
                mock_signed_url.return_value = "https://refreshed-url.example.com/pdf?token=new"
                result = await get_contract(contract_id, user_id=user_id)

        # get_signed_url was called for the single contract view
        mock_signed_url.assert_called_once()
        assert result.pdf_url == "https://refreshed-url.example.com/pdf?token=new"
