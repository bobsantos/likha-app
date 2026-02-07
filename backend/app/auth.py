"""
Authentication middleware for Supabase JWT verification.
Provides user authentication and resource ownership verification.
"""

from fastapi import HTTPException, Header
from typing import Optional
from app.db import supabase


async def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """
    Extract and verify JWT token from Authorization header.

    Args:
        authorization: Authorization header with format "Bearer <token>"

    Returns:
        user_id: Authenticated user's ID

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

    # Verify token with Supabase
    try:
        response = supabase.auth.get_user(token)

        if not response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid token"
            )

        return response.user.id

    except Exception as e:
        error_msg = str(e).lower()

        # Check for expired token
        if "expired" in error_msg:
            raise HTTPException(
                status_code=401,
                detail="Token expired"
            )

        # Generic invalid token error
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )


async def verify_contract_ownership(contract_id: str, user_id: str) -> None:
    """
    Verify that the authenticated user owns the specified contract.

    Args:
        contract_id: ID of the contract to check
        user_id: ID of the authenticated user

    Raises:
        HTTPException: 404 if contract not found, 403 if not owned by user, 500 on database error
    """
    try:
        # Query contract by ID
        result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

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

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Database or other errors
        raise HTTPException(
            status_code=500,
            detail="Failed to verify ownership"
        )
