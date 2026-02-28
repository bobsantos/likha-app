"""
Authentication middleware for Supabase JWT verification.
Provides user authentication and resource ownership verification.

Performance notes:
- get_current_user verifies JWTs locally with python-jose when SUPABASE_JWT_SECRET
  is set, avoiding a network round-trip to the Supabase Auth API (~50-150ms saved
  per request).
- verify_contract_ownership returns the full contract row so callers can reuse it
  without issuing a second SELECT.
"""

import os
from fastapi import HTTPException, Header
from typing import Optional
from app.db import supabase, supabase_admin

# ---------------------------------------------------------------------------
# Module-level JWT secret — loaded once at startup.
# Set SUPABASE_JWT_SECRET in your environment (Project Settings > API > JWT Secret).
# When not set the implementation falls back to the Supabase Auth API.
# ---------------------------------------------------------------------------
SUPABASE_JWT_SECRET: Optional[str] = os.environ.get("SUPABASE_JWT_SECRET") or None


async def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """
    Extract and verify JWT token from Authorization header.

    When SUPABASE_JWT_SECRET is set, verifies the JWT locally using python-jose
    (HS256) — no network call required. Falls back to supabase.auth.get_user()
    when the secret is not configured.

    Args:
        authorization: Authorization header with format "Bearer <token>"

    Returns:
        user_id: Authenticated user's ID (the JWT ``sub`` claim)

    Raises:
        HTTPException: 401 if token is missing, invalid, or expired
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated"
        )

    # Extract token from "Bearer <token>" format
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication credentials"
        )

    token = parts[1]

    # ------------------------------------------------------------------
    # Fast path: local JWT verification — no network call
    # ------------------------------------------------------------------
    if SUPABASE_JWT_SECRET:
        return _verify_jwt_locally(token)

    # ------------------------------------------------------------------
    # Fallback: remote Supabase Auth API verification
    # (used when SUPABASE_JWT_SECRET is not configured)
    # ------------------------------------------------------------------
    return await _verify_jwt_remotely(token)


def _verify_jwt_locally(token: str) -> str:
    """
    Verify a Supabase JWT locally using python-jose and return the user ID.

    Supabase issues HS256 JWTs signed with the project's JWT secret.
    This avoids the ~50-150ms network round-trip to the Supabase Auth API.

    Raises:
        HTTPException 401 on any verification failure.
    """
    try:
        from jose import jwt, JWTError, ExpiredSignatureError
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="python-jose is not installed; cannot verify JWT locally",
        )

    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase JWTs use 'authenticated' role, not a fixed audience
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id: Optional[str] = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    return user_id


async def _verify_jwt_remotely(token: str) -> str:
    """
    Verify a JWT via the Supabase Auth API (fallback when no JWT secret is set).

    Raises:
        HTTPException 401 on any verification failure.
    """
    try:
        response = supabase.auth.get_user(token)

        if not response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid token"
            )

        return response.user.id

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e).lower()

        if "expired" in error_msg:
            raise HTTPException(
                status_code=401,
                detail="Token expired"
            )

        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )


async def verify_contract_ownership(contract_id: str, user_id: str) -> dict:
    """
    Verify that the authenticated user owns the specified contract and return
    the contract row.

    Returning the row lets callers reuse it without issuing a second SELECT,
    eliminating the double DB fetch that was happening in every endpoint.

    Args:
        contract_id: ID of the contract to check
        user_id: ID of the authenticated user

    Returns:
        The contract row dict (all columns).

    Raises:
        HTTPException: 404 if contract not found, 403 if not owned by user, 500 on database error
    """
    try:
        # Query contract by ID — SELECT * so callers can reuse the full row
        result = supabase_admin.table("contracts").select("*").eq("id", contract_id).execute()

        # Contract not found
        if not result.data or len(result.data) == 0:
            raise HTTPException(
                status_code=404,
                detail="Contract not found"
            )

        contract = result.data[0]

        # User doesn't own this contract
        if contract.get("user_id") != user_id:
            raise HTTPException(
                status_code=403,
                detail="You are not authorized to access this contract"
            )

        return contract

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Database or other errors
        raise HTTPException(
            status_code=500,
            detail="Failed to verify ownership"
        )
