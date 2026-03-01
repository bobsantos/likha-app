FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements.txt .

# Upgrade pip and install production dependencies only
RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the default FastAPI port
EXPOSE 8000

# Production command: use Railway's PORT env var (falls back to 8000).
# Workers = 1 per Railway recommendation for stateful in-memory stores
# (the upload store in sales_upload.py is per-worker; multiple workers
# would each have their own store).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
