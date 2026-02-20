# Likha Architecture Reference

## Overview

Likha is an AI-powered royalty tracking platform for brand owners (licensors) who license their IP. Users upload licensing contract PDFs, the system extracts key terms using Claude AI, and then tracks royalty calculations against sales data.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI 0.110+, Python 3.11+ |
| Frontend | Next.js 14 (App Router), TypeScript 5, Tailwind CSS 3.4 |
| Database | PostgreSQL via Supabase |
| Storage | Supabase Storage (bucket: `contracts`) |
| AI | Anthropic Claude API (claude-sonnet-4-5) |
| PDF Parsing | pdfplumber |
| Validation | Pydantic v2 |
| Icons | Lucide React |

## Project Structure

```
likha-app/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry + CORS
│   │   ├── db.py                # Supabase client singleton
│   │   ├── routers/
│   │   │   ├── contracts.py     # Contract CRUD + /extract + /confirm
│   │   │   └── sales.py        # Sales periods CRUD
│   │   ├── services/
│   │   │   ├── extractor.py     # PDF → Claude → ExtractedTerms
│   │   │   ├── normalizer.py    # ExtractedTerms → FormValues
│   │   │   ├── royalty_calc.py  # Royalty calculation engine
│   │   │   └── storage.py      # Supabase Storage operations
│   │   └── models/
│   │       ├── contract.py      # Contract, ExtractedTerms, FormValues, etc.
│   │       └── sales.py        # SalesPeriod
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── (auth)/              # Auth routes (login, signup)
│   │   └── (app)/               # Protected routes
│   │       ├── dashboard/
│   │       ├── contracts/
│   │       │   ├── page.tsx     # Contract list
│   │       │   ├── [id]/        # Contract detail
│   │       │   └── upload/      # Upload + review flow
│   │       └── layout.tsx       # App shell with nav
│   ├── components/
│   │   ├── ContractCard.tsx
│   │   ├── DashboardSummary.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Nav.tsx
│   │   └── SalesPeriodModal.tsx
│   ├── lib/
│   │   ├── supabase.ts          # Supabase client (browser)
│   │   └── api.ts               # Backend API client
│   ├── types/
│   │   └── index.ts             # Shared TypeScript types
│   └── __tests__/
├── supabase/
│   └── migrations/              # Authoritative schema source
├── docs/
├── work/                        # Specs and planning docs
└── schema.sql                   # Reference copy (not authoritative)
```

## Database

### Migrations

- **Authoritative source**: `supabase/migrations/` (timestamped SQL files)
- `schema.sql` at root is a reference copy — may be out of date
- **Any schema change MUST include a new migration file**
- Naming convention: `YYYYMMDD######_description.sql`
- Apply via Supabase Dashboard > SQL Editor, or `supabase db reset` (wipes data)

### Key Tables

- `contracts` — Licensing contracts with status (`draft` / `active`), extracted terms, reviewed fields
- `sales_periods` — Sales data per contract period with calculated royalties
- `royalty_summaries` — Cached YTD summaries (optional)

### Important: Tests Mock the Database

All backend tests mock the Supabase client entirely. **Tests passing does NOT guarantee the real schema is compatible.** Always verify migrations are applied after schema changes.

## API Endpoints

### Contracts (`/api/contracts`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/extract` | Upload PDF, check duplicates (409), extract terms, create draft row |
| `PUT` | `/{id}/confirm` | Promote draft to active with user-reviewed fields |
| `GET` | `/` | List contracts (`include_drafts=true` to include drafts) |
| `GET` | `/{id}` | Get single contract |
| `DELETE` | `/{id}` | Delete contract (draft or active) |

### Sales (`/api/sales`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Create sales period (auto-calculates royalty) |
| `GET` | `/contract/{id}` | List periods for contract |
| `GET` | `/summary/{id}` | YTD summary |
| `DELETE` | `/{id}` | Delete sales period |

## Core Flows

### Contract Upload Flow

```
User uploads PDF
  → POST /extract
    → Duplicate filename check (case-insensitive, per user)
      → 409 DUPLICATE_FILENAME (active contract exists)
      → 409 INCOMPLETE_DRAFT (draft exists)
    → Upload to Supabase Storage (deterministic path, upsert: true)
    → Extract terms via Claude AI
    → Normalize extracted terms to form values
    → Insert draft row (status='draft')
    → Return contract_id + extracted_terms + form_values
  → User reviews/edits extracted terms
  → PUT /{id}/confirm
    → Promote draft to active with reviewed fields
  → Redirect to contract detail
```

### Royalty Calculation

```
calculate_royalty(royalty_rate, net_sales, category_breakdown?)
  ├── Flat: "8%" → net_sales × 0.08
  ├── Tiered: [{threshold, rate}] → marginal calculation
  └── Category: {category: rate} → sum(sales × rate per category)
```

All financial calculations use `Decimal` — never `float`.

## Models

### Backend (Pydantic)

- **ExtractedTerms** — Raw AI extraction output (all fields optional)
- **FormValues** — Normalized form-ready values from extraction
- **ContractDraftCreate** — Draft DB row at extraction time (filename, pdf_url, storage_path, extracted_terms, status=draft)
- **ContractConfirm** — User-reviewed input for `PUT /{id}/confirm`
- **ContractCreate** — Legacy create model
- **Contract** — Full DB record (review fields nullable for drafts)
- **ContractStatus** — Enum: `draft`, `active`

### Frontend (TypeScript)

- **Contract** — Mirrors backend, with `status`, `filename`, nullable review fields
- **ExtractionResponse** — Response from `/extract` including `contract_id`
- **DuplicateContractInfo** — 409 response payload for duplicate handling
- **FormValues** — Form state during review step

## Storage

- Bucket: `contracts` (private)
- Path pattern: `contracts/{user_id}/{sanitized_filename}`
- Deterministic paths with `upsert: true` (re-uploads overwrite)
- RLS policies enforce user-scoped access

## Environment Variables

### Backend
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-your-key
```

### Frontend
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Testing

### Backend
```bash
source backend/.venv/bin/activate
python -m pytest backend/tests/ -x -q    # Quick run
python -m pytest backend/tests/ -v       # Verbose
```

### Frontend
```bash
cd frontend
npx jest --no-cache           # All tests
npx jest path/to/test.tsx     # Specific test
```

### Pre-push Hook
Runs both backend and frontend test suites automatically before pushing.

## Development

### Start Backend
```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload
# API docs: http://localhost:8000/docs
```

### Start Frontend
```bash
cd frontend && npm run dev
# App: http://localhost:3000
```

### Docker (Full Stack)
```bash
docker-compose up
```

## Deployment

### Database Migrations

Supabase does **not** auto-run migration files from the repo. Migrations must be explicitly applied.

**Local development:**
```bash
# Option A: Paste SQL in Supabase Dashboard > SQL Editor
# Option B: Reset and re-run all migrations (wipes data)
supabase db reset
```

**Production:**
```bash
# Link to your production project (one-time setup)
supabase link --project-ref <your-prod-project-id>

# Apply pending migrations (tracks which have already run)
supabase db push
```

**CI/CD (future):**
Supabase offers a GitHub integration that auto-applies migrations on push. Configure in Supabase Dashboard > Settings > Integrations.

**Important:** Always apply migrations *before* deploying new app code that depends on schema changes. The app will crash if code references columns that don't exist yet (tests won't catch this since they mock the database).

### App Deployment

| Component | Suggested Platform |
|-----------|-------------------|
| Backend (FastAPI) | Railway or Render |
| Frontend (Next.js) | Vercel |
| Database + Storage | Supabase (hosted) |

Environment variables for each platform must match those listed in the Environment Variables section above.
