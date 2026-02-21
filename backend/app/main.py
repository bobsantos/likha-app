"""
Likha Backend API
FastAPI application for contract extraction and royalty tracking.
"""

import logging
import os
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.routers import contracts, sales
from app.db import supabase_admin

# Configure logging to output to console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Likha API",
    description="AI-powered licensing contract extraction and royalty tracking",
    version="0.1.0",
)


def get_cors_origins() -> List[str]:
    """
    Build the list of allowed CORS origins.

    Always includes:
    - http://localhost:3000  (Next.js dev server)
    - http://localhost:3001  (Docker-mapped port)

    Additional origins are read from the CORS_ORIGINS environment variable
    as a comma-separated list, e.g.:
        CORS_ORIGINS=https://likha.vercel.app,https://preview.likha.app

    Duplicates are removed while preserving order.
    """
    always_included = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    extra_origins: List[str] = []
    cors_env = os.getenv("CORS_ORIGINS", "").strip()
    if cors_env:
        extra_origins = [o.strip() for o in cors_env.split(",") if o.strip()]

    # Deduplicate while preserving order
    seen: set = set()
    origins: List[str] = []
    for origin in always_included + extra_origins:
        if origin not in seen:
            seen.add(origin)
            origins.append(origin)

    return origins


# CORS configuration — origins are resolved at startup from environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(contracts.router, prefix="/api/contracts", tags=["contracts"])
app.include_router(sales.router, prefix="/api/sales", tags=["sales"])


@app.get("/")
async def root():
    return {"message": "Likha API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/db")
async def health_db():
    """
    Test the Supabase database connection.

    Executes a lightweight query (SELECT 1 row from contracts) to verify that
    the Supabase admin client can reach the database.  Returns 503 on failure.
    """
    if supabase_admin is None:
        raise HTTPException(
            status_code=503,
            detail="Database client unavailable: SUPABASE_SERVICE_KEY is not configured",
        )

    try:
        supabase_admin.table("contracts").select("id").limit(1).execute()
        return {"status": "ok", "database": "reachable"}
    except Exception as exc:
        logger.error(f"Database health check failed: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {str(exc)}",
        )


@app.get("/health/storage")
async def health_storage():
    """
    Test Supabase Storage access.

    Lists storage buckets and verifies the 'contracts' bucket exists.
    Returns 503 if storage is unreachable or the bucket is missing.
    """
    if supabase_admin is None:
        raise HTTPException(
            status_code=503,
            detail="Storage client unavailable: SUPABASE_SERVICE_KEY is not configured",
        )

    try:
        buckets = supabase_admin.storage.list_buckets()
        bucket_names = [b.name for b in buckets]

        if "contracts" not in bucket_names:
            raise HTTPException(
                status_code=503,
                detail="Storage bucket 'contracts' not found",
            )

        return {"status": "ok", "storage": "reachable", "bucket": "contracts"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Storage health check failed: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"Storage check failed: {str(exc)}",
        )
