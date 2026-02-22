"""
Likha Backend API
FastAPI application for contract extraction and royalty tracking.
"""

import logging
import os
import socket
from typing import List, Optional

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


def _is_docker_bridge_ip(ip: str) -> bool:
    """Return True if the IP is in the Docker bridge network range (172.x.x.x)."""
    return ip.startswith("172.")


def _is_usable_lan_ip(ip: str) -> bool:
    """Return True if the IP is a usable LAN address (not loopback, not Docker internal)."""
    if ip.startswith("127."):
        return False
    if _is_docker_bridge_ip(ip):
        return False
    # Docker Desktop for Mac resolves host.docker.internal to 192.168.65.x
    if ip.startswith("192.168.65."):
        return False
    return True


def get_local_ip() -> Optional[str]:
    """
    Detect the host machine's local network IP address.

    Detection order:
    0. ``HOST_IP`` environment variable — most reliable in Docker since
       containers cannot detect the host's real LAN IP.
    1. UDP connect trick — OS picks the outbound interface.
    2. gethostbyname fallback.

    Returns None if every method fails so callers can degrade gracefully.
    """
    # Method 0: Explicit HOST_IP env var (set in docker-compose or .env).
    host_ip = os.getenv("HOST_IP", "").strip()
    if host_ip:
        return host_ip

    # Method 1: UDP connect trick — OS picks the outbound interface.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if _is_usable_lan_ip(ip):
                return ip
    except Exception:
        pass

    # Method 2: resolve hostname (less reliable).
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip and _is_usable_lan_ip(ip):
            return ip
    except Exception:
        pass

    return None

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
    - http://<local_ip>:3000  (LAN access on port 3000)
    - http://<local_ip>:3001  (LAN access on port 3001)

    The local IP is detected automatically at call time. If detection fails
    the local-IP entries are silently omitted.

    Additional origins are read from the CORS_ORIGINS environment variable
    as a comma-separated list, e.g.:
        CORS_ORIGINS=https://likha.vercel.app,https://preview.likha.app

    Duplicates are removed while preserving order.
    """
    always_included = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    # Add local network IP variants so the app works from other devices on LAN
    local_ip = get_local_ip()
    if local_ip:
        always_included.append(f"http://{local_ip}:3000")
        always_included.append(f"http://{local_ip}:3001")

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


@app.on_event("startup")
async def log_startup_urls() -> None:
    """
    Log the URLs the API is accessible at so developers know where to connect.

    The port shown is taken from the ``HOST_PORT`` environment variable so
    that Docker-mapped ports are reported correctly (e.g. 8001 → 8000 inside
    the container, but users connect via 8001 on the host).  Defaults to 8000
    for local dev where no port mapping is involved.

    Example output:

        Likha API running at:
          Local:   http://localhost:8001
          Network: http://192.168.1.123:8001
    """
    host_port = os.getenv("HOST_PORT", "8000")
    local_ip = get_local_ip()
    network_line = (
        f"  Network: http://{local_ip}:{host_port}"
        if local_ip
        else "  Network: (unavailable)"
    )
    logger.info(
        "Likha API running at:\n"
        "  Local:   http://localhost:%s\n"
        "%s",
        host_port,
        network_line,
    )


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
