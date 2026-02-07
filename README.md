# Likha - AI-Powered Royalty Tracking

MVP for contract extraction and royalty tracking for licensing agreements.

## Project Structure

```
likha-app/
├── backend/          # FastAPI backend
│   ├── app/
│   │   ├── main.py              # FastAPI app entry
│   │   ├── db.py                # Supabase client
│   │   ├── routers/             # API endpoints
│   │   │   ├── contracts.py     # Contract CRUD + extraction
│   │   │   └── sales.py         # Sales periods + calculations
│   │   ├── services/            # Business logic
│   │   │   ├── extractor.py     # PDF → Claude → JSON
│   │   │   └── royalty_calc.py  # Royalty calculation engine
│   │   └── models/              # Pydantic schemas
│   │       ├── contract.py
│   │       └── sales.py
│   ├── tests/
│   └── requirements.txt
│
└── frontend/         # Next.js frontend
    ├── app/                     # Next.js 14 app router
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── dashboard/           # TODO
    │   ├── contracts/           # TODO
    │   └── sales/               # TODO
    ├── components/              # React components (TODO)
    ├── lib/
    │   ├── supabase.ts          # Supabase client
    │   └── api.ts               # Backend API client
    └── package.json
```

## Tech Stack

- **Backend:** FastAPI + Python 3.11+
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Database:** PostgreSQL (via Supabase)
- **Storage:** Supabase Storage (for PDFs)
- **Auth:** Supabase Auth (not yet implemented)
- **AI:** Claude Sonnet 4.5 (via Anthropic API)

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Supabase account ([supabase.com](https://supabase.com))
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your Supabase and Anthropic credentials

# Run development server
uvicorn app.main:app --reload
```

Backend will be available at `http://localhost:8000`
API docs at `http://localhost:8000/docs`

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials

# Run development server
npm run dev
```

Frontend will be available at `http://localhost:3000`

### Database Setup

Run the SQL schema in Supabase SQL Editor:

```sql
-- See schema.sql
```

## Development Workflow

### 1. Contract Upload & Extraction

```
User uploads PDF
  → POST /api/contracts/extract
  → Extract text from PDF (pdfplumber)
  → Send to Claude API
  → Return extracted terms + confidence score
  → User reviews/corrects on frontend
  → POST /api/contracts (save to DB)
```

### 2. Sales Entry & Calculation

```
User enters sales for a period
  → POST /api/sales
  → Fetch contract royalty structure
  → Calculate royalty (flat/tiered/category)
  → Apply minimum guarantee if applicable
  → Save to DB
  → Return calculated royalty
```

## API Endpoints

### Contracts

- `POST /api/contracts/extract` - Upload PDF and extract terms
- `POST /api/contracts` - Create contract (after review)
- `GET /api/contracts` - List all contracts
- `GET /api/contracts/{id}` - Get single contract
- `DELETE /api/contracts/{id}` - Delete contract

### Sales

- `POST /api/sales` - Create sales period (auto-calculates royalty)
- `GET /api/sales/contract/{contract_id}` - List sales periods
- `GET /api/sales/summary/{contract_id}` - Get YTD summary
- `DELETE /api/sales/{id}` - Delete sales period

## Testing

### Backend Tests

```bash
cd backend
pytest
```

### Validate Extraction

Use the spike's test contracts:

```bash
# Copy test contracts from spike
cp -r ../likha-contract-extraction-spike/sample_contracts ./test_data/

# Test extraction
python -c "
from app.services.extractor import extract_contract
import asyncio

result, tokens = asyncio.run(extract_contract('test_data/contract_simple.pdf'))
print(result)
"
```

## Deployment (TODO)

- **Backend:** Railway / Render
- **Frontend:** Vercel
- **Database:** Supabase (production tier)

## TODO: MVP Features

- [ ] Auth (Supabase Auth + RLS)
- [ ] Frontend pages (dashboard, upload, review, sales entry)
- [ ] PDF storage (Supabase Storage)
- [ ] YTD royalty summary calculation
- [ ] Minimum guarantee logic (quarterly/annual)
- [ ] Advance payment tracking
- [ ] Due date alerts
- [ ] Mobile responsive design

## TODO: Future Features (v2)

- [ ] CSV import for bulk sales
- [ ] Email notifications
- [ ] Licensee portal (self-service reporting)
- [ ] Payment tracking
- [ ] Analytics dashboard
- [ ] OCR for scanned contracts
- [ ] Multi-currency support
- [ ] Audit log

## Cost Estimates

Based on spike results:
- **Extraction:** ~$0.01-0.05 per contract
- **At 100 contracts/month:** ~$2-5/month
- **Negligible at MVP scale**

---

Built from the validated technical spike at `../likha-contract-extraction-spike/`
