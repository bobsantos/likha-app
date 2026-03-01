"""
Unit tests for authentication middleware.
Tests JWT verification, user extraction, and ownership verification.
"""

import pytest
import os
import jwt as pyjwt
from fastapi import HTTPException
from unittest.mock import Mock, patch, AsyncMock

# Mock environment variables before importing app modules
os.environ['SUPABASE_URL'] = 'https://test.supabase.co'
os.environ['SUPABASE_KEY'] = 'test-anon-key'

from app.auth import get_current_user, verify_contract_ownership, _verify_jwt_locally


class TestGetCurrentUser:
    """Test JWT token verification and user extraction."""

    @pytest.mark.asyncio
    async def test_valid_token_returns_user_id(self):
        """Valid JWT token should return authenticated user_id."""
        mock_token = "valid.jwt.token"

        with patch('app.auth.supabase') as mock_supabase:
            # Mock Supabase auth.get_user() response
            mock_supabase.auth.get_user.return_value = Mock(
                user=Mock(id="user-123")
            )

            user_id = await get_current_user(f"Bearer {mock_token}")

            assert user_id == "user-123"
            mock_supabase.auth.get_user.assert_called_once_with(mock_token)

    @pytest.mark.asyncio
    async def test_missing_token_raises_401(self):
        """Missing Authorization header should raise 401."""
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(None)

        assert exc_info.value.status_code == 401
        assert "Not authenticated" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_missing_bearer_prefix_raises_401(self):
        """Token without 'Bearer ' prefix should raise 401."""
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user("invalid.jwt.token")

        assert exc_info.value.status_code == 401
        assert "Invalid authentication" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_invalid_token_raises_401(self):
        """Invalid JWT token should raise 401."""
        mock_token = "invalid.jwt.token"

        with patch('app.auth.supabase') as mock_supabase:
            # Mock Supabase auth.get_user() raising exception
            mock_supabase.auth.get_user.side_effect = Exception("Invalid token")

            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {mock_token}")

            assert exc_info.value.status_code == 401
            assert "Invalid token" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_expired_token_raises_401(self):
        """Expired JWT token should raise 401."""
        mock_token = "expired.jwt.token"

        with patch('app.auth.supabase') as mock_supabase:
            # Mock Supabase auth.get_user() raising exception for expired token
            mock_supabase.auth.get_user.side_effect = Exception("Token expired")

            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {mock_token}")

            assert exc_info.value.status_code == 401
            assert "expired" in str(exc_info.value.detail).lower()

    @pytest.mark.asyncio
    async def test_no_user_in_response_raises_401(self):
        """Token verification with no user should raise 401."""
        mock_token = "valid.jwt.token"

        with patch('app.auth.supabase') as mock_supabase:
            # Mock Supabase auth.get_user() returning no user
            mock_supabase.auth.get_user.return_value = Mock(user=None)

            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(f"Bearer {mock_token}")

            assert exc_info.value.status_code == 401
            assert "Invalid token" in str(exc_info.value.detail)


class TestVerifyContractOwnership:
    """Test contract ownership verification."""

    @pytest.mark.asyncio
    async def test_user_can_access_own_contract(self):
        """User should be able to access their own contract."""
        contract_id = "contract-123"
        user_id = "user-123"

        with patch('app.auth.supabase_admin') as mock_supabase:
            # Mock database query returning contract owned by user
            mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[{"id": contract_id, "user_id": user_id}]
            )

            # Should not raise exception
            await verify_contract_ownership(contract_id, user_id)

            # Verify database was queried correctly
            mock_supabase.table.assert_called_once_with("contracts")

    @pytest.mark.asyncio
    async def test_contract_not_found_raises_404(self):
        """Contract that doesn't exist should raise 404."""
        contract_id = "nonexistent-contract"
        user_id = "user-123"

        with patch('app.auth.supabase_admin') as mock_supabase:
            # Mock database query returning empty result
            mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[]
            )

            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership(contract_id, user_id)

            assert exc_info.value.status_code == 404
            assert "Contract not found" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_user_cannot_access_other_users_contract(self):
        """User should not be able to access another user's contract."""
        contract_id = "contract-123"
        user_id = "user-123"
        other_user_id = "user-456"

        with patch('app.auth.supabase_admin') as mock_supabase:
            # Mock database query returning contract owned by different user
            mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = Mock(
                data=[{"id": contract_id, "user_id": other_user_id}]
            )

            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership(contract_id, user_id)

            assert exc_info.value.status_code == 403
            assert "not authorized" in str(exc_info.value.detail).lower()

    @pytest.mark.asyncio
    async def test_database_error_raises_500(self):
        """Database errors should raise 500."""
        contract_id = "contract-123"
        user_id = "user-123"

        with patch('app.auth.supabase_admin') as mock_supabase:
            # Mock database query raising exception
            mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception("Database error")

            with pytest.raises(HTTPException) as exc_info:
                await verify_contract_ownership(contract_id, user_id)

            assert exc_info.value.status_code == 500
            assert "Failed to verify ownership" in str(exc_info.value.detail)


class TestVerifyJwtLocally:
    """
    Unit tests for _verify_jwt_locally — the PyJWT-based local verification path.

    Uses a real HS256-signed JWT (created inline with PyJWT) so that the token
    structure is authentic. The secret is a fixed test value; it never leaves
    this test module.
    """

    TEST_SECRET = "test-jwt-secret-for-unit-tests"

    def _make_token(self, payload: dict) -> str:
        """Helper: sign a JWT with the test secret."""
        return pyjwt.encode(payload, self.TEST_SECRET, algorithm="HS256")

    def test_valid_token_returns_user_id(self):
        """A well-formed, unexpired HS256 token should return the sub claim."""
        import time
        token = self._make_token({"sub": "user-abc", "exp": int(time.time()) + 3600})

        with patch("app.auth.SUPABASE_JWT_SECRET", self.TEST_SECRET):
            user_id = _verify_jwt_locally(token)

        assert user_id == "user-abc"

    def test_expired_token_raises_401(self):
        """An expired token should raise 401 with 'Token expired'."""
        import time
        token = self._make_token({"sub": "user-abc", "exp": int(time.time()) - 10})

        with patch("app.auth.SUPABASE_JWT_SECRET", self.TEST_SECRET):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_locally(token)

        assert exc_info.value.status_code == 401
        assert "expired" in str(exc_info.value.detail).lower()

    def test_invalid_signature_raises_401(self):
        """A token signed with the wrong secret should raise 401."""
        import time
        token = self._make_token({"sub": "user-abc", "exp": int(time.time()) + 3600})

        with patch("app.auth.SUPABASE_JWT_SECRET", "wrong-secret"):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_locally(token)

        assert exc_info.value.status_code == 401
        assert "Invalid token" in str(exc_info.value.detail)

    def test_missing_sub_claim_raises_401(self):
        """A token without a sub claim should raise 401."""
        import time
        token = self._make_token({"role": "authenticated", "exp": int(time.time()) + 3600})

        with patch("app.auth.SUPABASE_JWT_SECRET", self.TEST_SECRET):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_locally(token)

        assert exc_info.value.status_code == 401
        assert "Invalid token" in str(exc_info.value.detail)

    def test_garbage_token_raises_401(self):
        """A completely malformed token string should raise 401."""
        with patch("app.auth.SUPABASE_JWT_SECRET", self.TEST_SECRET):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_locally("not.a.real.jwt.at.all")

        assert exc_info.value.status_code == 401
