"""
Likha Backend API
FastAPI application for contract extraction and royalty tracking.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import contracts, sales

app = FastAPI(
    title="Likha API",
    description="AI-powered licensing contract extraction and royalty tracking",
    version="0.1.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
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
