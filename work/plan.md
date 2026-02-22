# Likha MVP - Week 2 Implementation Plan

**Created:** 2026-02-07
**Last Revised:** 2026-02-22 (sales reporting strategy update based on competitive research)
**Status:** In Progress
**Scope:** Frontend development + Backend auth integration

---

## Overview

Week 1 (complete) delivered the backend foundation:
- FastAPI project with extraction, contracts CRUD, sales CRUD
- Royalty calculation engine (flat, tiered, category rates)
- Supabase database integration

Week 2 focuses on:
- **Frontend:** Auth, dashboard, contract upload, extraction review, sales entry
- **Backend:** Auth integration, PDF storage, YTD summary implementation

### Key Insight from Competitive Research (2026-02-22)

Competitive research (`docs/competitive-research-royalty-landscape.md`) revealed a critical framing shift:

**Original assumption:** The licensor's primary job is entering sales and calculating royalties.

**Revised understanding:** The licensor's primary job is **verifying licensee-submitted royalty reports**. Licensees send Excel files via email. The licensor receives the spreadsheet, checks the math, and tracks shortfalls. Every enterprise competitor (Flowhaven, RoyaltyZone, Brainbase, Octane5) has spreadsheet upload as a core feature — not v2. Manual form entry is the fallback, not the primary workflow.

**Consequence:** The sales reporting features are being phased:
- **Phase 1 (current MVP):** Manual form entry (already built) + licensee reported amount + discrepancy detection
- **Phase 1.1 (first post-MVP sprint):** Spreadsheet upload with column mapping
- **Phase 2:** AI-assisted column mapping + template generation

---

## Day 6: Authentication (Frontend + Backend)

### Frontend Tasks

**Morning: Environment & Dependencies**
- [x] Set up environment variables (`.env.local`)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_API_URL`
- [x] Verify all dependencies installed (`npm install`)
- [x] Test connection to backend API (health check)
- [x] Test Supabase client connection

**Afternoon: Authentication Flow**
- [x] Create auth layout: `/frontend/app/(auth)/layout.tsx`
- [x] Build sign-up page: `/frontend/app/(auth)/signup/page.tsx`
- [x] Build login page: `/frontend/app/(auth)/login/page.tsx`
- [x] Create auth helper: `/frontend/lib/auth.ts`

**Components:**
- [x] `AuthForm` - Reusable email/password form component
- [x] `AuthError` - Display auth error messages

### Backend Tasks

**Authentication Middleware**
- [x] Create `backend/app/auth.py` with JWT verification
  - Extract JWT token from Authorization header
  - Verify token with Supabase
  - Return authenticated user_id
  - Handle auth errors (401/403)

- [x] Replace all TODO auth placeholders:
  - `/app/routers/contracts.py`: 8 instances
  - `/app/routers/sales.py`: 8 instances
  - Replace hardcoded `user_id = "temp-user-id"` with actual auth

- [x] Add ownership verification
  - Create `verify_contract_ownership()` helper
  - Ensure users can only access their own contracts/sales

**Success Criteria:**
- [x] All endpoints require valid auth token
- [x] Endpoints return 401 for missing/invalid tokens
- [x] Endpoints return 403 for unauthorized resource access

---

## Day 7: Dashboard + PDF Storage

### Frontend Tasks

**Morning: App Layout & Navigation**
- [x] Create main layout: `/frontend/app/(app)/layout.tsx`
  - Top navigation bar with logo, user menu
  - Protected route (check auth, redirect to login if not authenticated)
- [x] Build navigation component: `/frontend/components/nav.tsx`
- [x] Add logout functionality

**Afternoon: Dashboard Page**
- [x] Create dashboard: `/frontend/app/(app)/dashboard/page.tsx`
  - Fetch all contracts via `getContracts()`
  - Display loading skeleton while fetching
  - Handle empty state (no contracts yet)

**Components:**
- [x] `ContractCard` - Display contract summary
- [x] `DashboardSummary` - High-level metrics (total contracts, YTD royalties)
- [x] `EmptyState` - No contracts yet with CTA to upload

### Backend Tasks

**Supabase Storage Upload**
- [x] Create storage service: `backend/app/services/storage.py`
  - `upload_contract_pdf(file_content, user_id, filename)`
  - `get_signed_url(storage_path, expiry_seconds)`
  - `delete_contract_pdf(pdf_url)`
  - Use bucket: `contracts/{user_id}/{filename}`

- [x] Update contracts router:
  - Replace placeholder `pdf_url = "https://placeholder.pdf"`
  - Upload PDF during `/extract` endpoint
  - Return storage URL in response

- [x] Implement cascade delete:
  - Delete PDF from storage when contract is deleted

**Success Criteria:**
- [x] PDFs uploaded to `contracts/{user_id}/{uuid}.pdf`
- [x] Signed URLs returned in contract responses
- [x] PDFs deleted when contract is deleted
- [x] All tests passing (94/94)
- [x] TDD approach followed

---

## Day 8: Contract Upload + Extraction Review

### Frontend Tasks

**Morning: Upload Flow**
- [x] Create upload page: `/frontend/app/(app)/contracts/upload/page.tsx`
  - File upload component (drag-and-drop + file picker)
  - Accept only PDF files
  - Upload progress indicator
- [x] Build upload component: `/frontend/components/contract-upload.tsx`
  - Drag-and-drop zone styling
  - File validation (PDF only, max size 10MB)

**Afternoon: Extraction Review Form**
- [x] Create review page: `/frontend/app/(app)/contracts/review/page.tsx`
- [x] Build extraction review component: `/frontend/components/contract-form.tsx`
  - Form fields for all contract terms:
    - Licensee name (text input)
    - Contract dates (date pickers)
    - Royalty rate (smart input based on structure type)
    - Royalty base (dropdown: net sales, gross sales)
    - Territories (multi-select or text input)
    - Product categories (optional)
    - Minimum guarantee (number input)
    - MG period (dropdown: monthly, quarterly, annually)
    - Advance payment (optional)
    - Reporting frequency (dropdown)

**Components:**
- [x] `ContractUpload` - File upload with drag-and-drop (22 tests)
- [x] `ContractForm` - Multi-field contract review form (25 tests)
- [x] `RoyaltyRateInput` - Smart input for flat/tiered/category rates (22 tests)

### Backend Tasks

**Enhanced CORS & Response Models**
- [x] Update CORS configuration (`app/main.py`)
  - Env-var driven via `CORS_ORIGINS` (comma-separated)
  - Always includes localhost:3000/3001 for dev
  - Configure for Vercel preview deployments
- [x] Enhance response models:
  - Added `is_expired` computed field (bool, contract_end_date < today)
  - Added `days_until_report_due` computed field (int, based on reporting_frequency)
  - Decimal fields serialize correctly (confirmed)
- [x] Add health check enhancements:
  - `/health/db` - test Supabase connection (SELECT query)
  - `/health/storage` - test storage access (list buckets, verify contracts bucket)

**Success Criteria:**
- [x] 237 frontend tests passing (180 existing + 57 new)
- [x] 266 backend tests passing (236 existing + 30 new)
- [x] TDD approach followed

---

## Day 9: Contract Details + Sales Entry

### Frontend Tasks

**Morning: Contract Detail View**
- [x] Create contract detail page: `/frontend/app/(app)/contracts/[id]/page.tsx`
  - Fetch contract by ID
  - Fetch sales periods
  - Display contract summary
  - Display sales history table

**Components:**
- [x] `ContractHeader` - Licensee name, contract period, status badge
- [x] `ContractTerms` - All terms in readable read-only format
- [x] `SalesHistoryTable` - Table with Period, Net Sales, Royalty, MG Applied columns
- [x] `SalesPeriodModal` - Modal for entering sales periods from the detail page

**Afternoon: Sales Entry Form**
- [x] Create sales entry page: `/frontend/app/(app)/sales/new/page.tsx`
- [x] Build sales entry form (inline, 22 tests passing)
  - Contract selector (dropdown of active contracts)
  - Period dates (start + end)
  - Net sales amount
  - Category breakdown (conditional — shown for category-rate contracts)
  - Display calculated royalty after submission
  - Pre-selection via ?contract_id= query param
  - "Enter Another Period" reset flow
- [x] Add "Sales" link to navigation (`/components/nav.tsx`)

**Components:**
- [x] Sales entry form (inline in page)
- [x] Category breakdown inputs (conditional per contract type)
- [x] Royalty result card (success state with net sales + calculated royalty)

### Backend Tasks

**YTD Summary Implementation**
- [x] Implement `GET /api/sales/summary/{contract_id}` (currently 501)
  - Calculate YTD totals from sales_periods
  - Apply minimum guarantee logic
  - Track advance payment credit
  - Return RoyaltySummary model

- [x] Add minimum guarantee application in `royalty_calc.py`:
  - Quarterly minimum: `max(calculated, quarterly_min)`
  - Annual minimum: track shortfall, apply at year-end
  - Set `minimum_applied` flag correctly

- [x] Advance payment tracking:
  - Deduct advance from Year 1 royalties
  - Track remaining credit
  - Reset for Year 2+

**Success Criteria:**
- [x] `/api/sales/summary/{contract_id}` returns complete YTD data
- [x] Minimum guarantee correctly applied
- [x] Advance payment properly credited
- [x] 361 backend tests passing (327 existing + 34 new)
- [x] TDD approach followed

### Day 9 UI Change: Manual Sales Entry Hidden (2026-02-22)

The manual sales entry UI has been hidden from the product. Specific changes:

- **Nav.tsx**: "Sales" link removed. Users can no longer navigate to `/sales/new` from the nav.
- **Contract detail page**: "Enter Sales Period" buttons removed from the header and empty state. The sales history table remains as a read-only display of existing data.
- **Empty state**: Replaced with a "Sales tracking coming soon" placeholder that describes the upcoming spreadsheet upload workflow.
- **Files retained (not deleted)**:
  - `/frontend/app/(app)/sales/new/page.tsx` — unlinked but code intact for backfill/forecast
  - `/frontend/components/SalesPeriodModal.tsx` — component intact, not rendered anywhere
- **Test changes**: Sales entry page tests and SalesPeriodModal tests wrapped in `describe.skip()`.

**Rationale**: The manual form does not handle complex rate types well. Spreadsheet upload (Phase 1.1) is the real workflow — licensees send Excel files, and the licensor verifies them. Backend endpoints and calculation logic are fully retained for future use.

### What Day 9 Does NOT Include (New Understanding)

The manual entry form is complete and correct, but it is the fallback workflow, not the primary one. The following items were not in scope for Day 9 and need to be addressed:

- **Licensee reported royalty field** - The form captures what the system calculates, but not what the licensee claimed to owe. These two numbers need to be compared.
- **Discrepancy display** - No UI for showing when the system's calculation differs from the licensee's reported amount.
- **Spreadsheet upload** - The primary way licensees actually send data (email with Excel attachment) has no upload path yet.

These gaps are addressed in the tasks below.

---

## Phase 1 Completion: Discrepancy Detection (Immediate Priority)

Full specification in `docs/prd-royalty-tracking.md` — Phase 1 section.

**Summary:** Add `licensee_reported_royalty` field to sales periods. Compute `discrepancy_amount` and `has_discrepancy` on the response. Show discrepancy in the result card and sales history table. Requires a new migration.

**Checklist:**

- [ ] Migration: `supabase/migrations/[timestamp]_add_licensee_reported_royalty.sql`
- [ ] Backend: add field to `SalesPeriodCreate` and `SalesPeriodResponse`, compute discrepancy fields
- [ ] Backend: write TDD tests for all discrepancy states
- [ ] Frontend: add "Licensee Reported Royalty" field to sales entry form
- [ ] Frontend: update royalty result card to show discrepancy (amber = under-reported, blue = over-reported)
- [ ] Frontend: add Discrepancy column to `SalesHistoryTable`
- [ ] Frontend: update `SalesPeriodModal` to include the field
- [ ] Frontend: update TypeScript types in `/frontend/types/index.ts`
- [ ] Frontend: write tests for all discrepancy display states

**Success Criteria:** Licensor can record what the licensee reported, system immediately flags any discrepancy, sales history table shows discrepancy status at a glance. All new tests passing.

---

## Day 10: Polish + Deploy

### Frontend Tasks

**Morning: Error Handling & Loading States**
- [ ] Add global error handling (error boundary component)
- [ ] Implement loading states:
  - Skeleton loaders for dashboard
  - Spinners for form submissions
  - Progress bars for file uploads
- [ ] Add toast notifications
- [ ] Form validation improvements

**Afternoon: Mobile Responsiveness & Deploy**
- [ ] Mobile responsive design:
  - Test all pages on mobile viewport (375px, 768px, 1024px)
  - Hamburger menu on mobile
  - Touch-friendly button sizes (min 44px)
- [ ] Accessibility improvements (ARIA labels, keyboard navigation)
- [ ] Final testing of complete user flow
- [ ] Deploy to Vercel

### Backend Tasks

**Integration Tests & Railway Deployment**
- [ ] Integration tests:
  - Test full auth flow
  - Test contract upload → extraction → create
  - Test sales period create → YTD summary
  - Test discrepancy calculation end-to-end
  - Mock Anthropic API to avoid costs

- [ ] Deployment configuration:
  - Create `Dockerfile` for Railway
  - Add `railway.json` for service config
  - Document environment variables

- [ ] API documentation polish:
  - Review auto-generated `/docs`
  - Add response examples to docstrings

---

## Phase 1.1: Spreadsheet Upload with Column Mapping

**Target:** First post-MVP sprint (after beta user feedback confirms pain)

Full specification in `docs/prd-royalty-tracking.md` — Phase 1.1 section.

**Summary:** 4-step upload wizard (file upload → column mapping → data preview → confirm). Spreadsheet parser service handles xlsx, xls, and csv. Column mappings saved per licensee and auto-applied on subsequent uploads. Multi-row reports aggregated by category before royalty calculation. Dependencies: `openpyxl`, `xlrd`.

**Checklist:**

- [ ] Migration: `supabase/migrations/[timestamp]_add_licensee_column_mappings.sql`
- [ ] Backend: create `backend/app/services/spreadsheet_parser.py` with `parse_upload` and `apply_mapping`
- [ ] Backend: create upload endpoints (`POST /api/sales/upload/{contract_id}`, `POST .../confirm`, `GET .../mapping/{contract_id}`)
- [ ] Backend: write TDD tests for parser (standard xlsx, non-standard csv, title rows, category aggregation, saved mapping, unsupported types)
- [ ] Frontend: add "Upload Report" button to contract detail page
- [ ] Frontend: create `/frontend/app/(app)/sales/upload/page.tsx` (4-step wizard)
- [ ] Frontend: create `column-mapper.tsx` component
- [ ] Frontend: create `upload-preview.tsx` component
- [ ] Frontend: write tests for upload flow end-to-end

**Success Criteria:** Licensor uploads a licensee Excel file, creates a sales period in under 3 minutes. Second upload auto-applies saved mapping. Multi-row reports aggregate correctly. All tests passing.

---

## Phase 2: AI-Assisted Column Mapping + Template Generation + Email Intake

**Target:** v2 (Month 3-6, after Phase 1.1 is validated)

Full specification in `docs/prd-royalty-tracking.md` — Phase 2 section.

**Summary:** Three capabilities built in sequence:

1. **Template generation** — `GET /api/contracts/{id}/report-template` downloads a pre-formatted Excel file per contract. Licensor emails it to the licensee. Returned file uploads with zero column mapping. Frontend: "Download Report Template" button on contract detail page.

2. **AI-assisted column mapping** — Replaces Phase 1.1 keyword synonym matching. After parsing, send detected column names and sample values to Claude and ask it to suggest field mappings. Pre-fills the column mapper UI. User confirms or adjusts.

3. **Email intake** — Each licensor account gets a unique inbound address (`reports-[short-id]@likha.app`). Inbound email service (Postmark, SendGrid, or Mailgun) POSTs attachments to a webhook. Attachments are parsed, auto-matched to a contract by sender email (`licensee_email` on contracts table), and queued as draft tasks. Frontend: settings page (inbound address), inbox view, review page, dashboard badge. New tables: `inbound_reports`, `licensee_email` column on `contracts`.

**Key design decisions:** Forwarding address only — no OAuth inbox access. Auto-matching by sender email is required in the MVP of this feature, not deferred. Email intake depends on Phase 1.1 parser being production-validated first.

**Checklist:**

- [ ] Migration: `supabase/migrations/[timestamp]_add_licensee_email_to_contracts.sql`
- [ ] Migration: `supabase/migrations/[timestamp]_add_inbound_reports.sql`
- [ ] Backend: `GET /api/contracts/{id}/report-template` endpoint (openpyxl, generates per contract rate structure)
- [ ] Backend: Claude integration in spreadsheet upload flow for AI column mapping suggestions
- [ ] Backend: inbound email webhook `POST /api/email-intake/inbound`
- [ ] Backend: `POST /api/email-intake/{report_id}/confirm` and `/reject` endpoints
- [ ] Frontend: "Download Report Template" button on contract detail page
- [ ] Frontend: settings page with inbound address display and copy button
- [ ] Frontend: `/inbox` list view
- [ ] Frontend: `/inbox/[report_id]` review page (reuses Phase 1.1 column-mapper and upload-preview components)
- [ ] Frontend: dashboard badge for pending reports count

---

## New Files to Create

### Backend

| File | Purpose |
|------|---------|
| `backend/app/auth.py` | Auth middleware with JWT verification |
| `backend/app/services/storage.py` | Supabase Storage integration |
| `backend/app/services/spreadsheet_parser.py` | Phase 1.1: Parse Excel/CSV uploads |
| `backend/app/routers/sales_upload.py` | Phase 1.1: Upload endpoints |
| `backend/tests/test_integration.py` | Integration tests |
| `backend/tests/test_spreadsheet_parser.py` | Phase 1.1: Parser tests |
| `backend/Dockerfile` | Railway deployment |
| `backend/railway.json` | Railway config |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/app/(auth)/layout.tsx` | Auth layout (no nav) |
| `frontend/app/(auth)/login/page.tsx` | Login page |
| `frontend/app/(auth)/signup/page.tsx` | Signup page |
| `frontend/app/(app)/layout.tsx` | Main app layout with nav |
| `frontend/app/(app)/dashboard/page.tsx` | Dashboard page |
| `frontend/app/(app)/contracts/[id]/page.tsx` | Contract detail page |
| `frontend/app/(app)/contracts/upload/page.tsx` | Upload page |
| `frontend/app/(app)/contracts/review/page.tsx` | Extraction review page |
| `frontend/app/(app)/sales/new/page.tsx` | Sales entry page (manual form) |
| `frontend/app/(app)/sales/upload/page.tsx` | Phase 1.1: Spreadsheet upload flow |
| `frontend/components/nav.tsx` | Navigation bar |
| `frontend/components/contract-card.tsx` | Contract card for dashboard |
| `frontend/components/contract-form.tsx` | Contract review form |
| `frontend/components/contract-upload.tsx` | File upload component |
| `frontend/components/sales-entry-form.tsx` | Sales entry form |
| `frontend/components/sales-upload/column-mapper.tsx` | Phase 1.1: Column mapping UI |
| `frontend/components/sales-upload/upload-preview.tsx` | Phase 1.1: Data preview before confirm |
| `frontend/lib/auth.ts` | Auth utilities |
| `frontend/types/index.ts` | TypeScript types |

---

## Page Routes Structure

```
frontend/app/
├── (auth)/                    # Auth routes (no main nav)
│   ├── layout.tsx
│   ├── login/page.tsx
│   └── signup/page.tsx
│
├── (app)/                     # Protected app routes (with nav)
│   ├── layout.tsx
│   ├── dashboard/page.tsx
│   ├── contracts/
│   │   ├── [id]/page.tsx
│   │   ├── upload/page.tsx
│   │   └── review/page.tsx
│   └── sales/
│       ├── new/page.tsx       # Manual entry (built)
│       └── upload/page.tsx    # Phase 1.1: Spreadsheet upload
│
├── layout.tsx                 # Root layout
├── page.tsx                   # Homepage (redirect to dashboard or login)
└── globals.css
```

---

## API Changes for Week 2

### All endpoints now require auth
```typescript
// Frontend must include header:
Authorization: Bearer <supabase-jwt-token>
```

### Contract creation returns real PDF URL
```json
{
  "pdf_url": "https://[project].supabase.co/storage/v1/object/sign/contracts/..."
}
```

### YTD summary endpoint now functional
```bash
GET /api/sales/summary/{contract_id}?contract_year=1
```

### Sales period now includes discrepancy fields (Phase 1 completion)
```json
{
  "id": "...",
  "net_sales": 100000.00,
  "calculated_royalty": 8000.00,
  "licensee_reported_royalty": 7500.00,
  "discrepancy_amount": 500.00,
  "has_discrepancy": true
}
```

### Spreadsheet upload endpoints (Phase 1.1)
```bash
POST /api/sales/upload/{contract_id}        # Upload file, get preview
POST /api/sales/upload/{contract_id}/confirm # Confirm mapping, create sales period
GET  /api/sales/upload/mapping/{contract_id} # Get saved mapping for this licensee
GET  /api/contracts/{id}/report-template    # Phase 2: Download pre-formatted Excel
```

---

## Environment Variables

### Backend (Railway)
```bash
SUPABASE_URL=https://[project].supabase.co
SUPABASE_KEY=[anon-key]
SUPABASE_SERVICE_KEY=[service-role-key]
ANTHROPIC_API_KEY=sk-ant-...
ENVIRONMENT=production
DEBUG=false
CORS_ORIGINS=https://likha-app.vercel.app
```

### Frontend (Vercel)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
NEXT_PUBLIC_API_URL=https://[backend].railway.app
```

---

## Success Metrics

### MVP (End of Day 10) — Minimum to Ship

- [ ] User can sign up and login
- [ ] User can upload contract PDF
- [ ] Extraction review form displays and is editable
- [ ] Contract is saved to database
- [ ] Dashboard shows list of contracts
- [ ] User can add sales period via manual form
- [ ] Royalty is calculated correctly (flat, tiered, category)
- [ ] YTD summary is displayed
- [ ] Minimum guarantee logic works
- [ ] App is deployed (Frontend: Vercel, Backend: Railway)
- [ ] All pages are mobile responsive
- [ ] Error states are handled gracefully

### Phase 1 Complete (Discrepancy Detection) — Required Before Beta

- [ ] Licensor can record what the licensee reported alongside their own calculation
- [ ] System flags discrepancies automatically
- [ ] Sales history table shows discrepancy status at a glance
- [ ] Beta users can use this to verify one real licensee report

### Phase 1.1 Complete (Spreadsheet Upload) — Target for Month 2

- [ ] Licensor can upload an Excel file from a licensee
- [ ] Column mapping wizard works for non-standard headers
- [ ] Mappings are saved per licensee (auto-apply on subsequent uploads)
- [ ] Multi-row reports aggregate correctly by category
- [ ] Time to enter one sales period: under 3 minutes (vs. 10+ minutes manual)

**Ready for:**
- Beta user testing (Phase 1 complete)
- Paid user conversion (Phase 1.1 complete)
- Scale and growth (Phase 2 complete)

---

## Known Limitations (Deferred)

Feature gaps and their target phases are documented in `docs/prd-royalty-tracking.md`. Brief summary:

- **Phase 1 (immediate):** No discrepancy detection yet — `licensee_reported_royalty` field and discrepancy display are not yet built
- **Phase 1.1 (first post-MVP sprint):** No spreadsheet upload — licensor must manually transcribe from licensee's Excel file
- **Phase 2 (v2, Month 3-6):** No Excel template generation, no AI-assisted column mapping, no email intake

### Deferred to v2 (Out of scope for current roadmap)
- No email verification or forgot password flow
- No contract editing or deletion
- No sales period editing or deletion
- No PDF viewing in browser
- No multi-user accounts
- No payment tracking (actual payment received vs. calculated)
- No email reminders for report due dates
- No licensee portal (self-service report submission)
- No multi-currency support
- No advanced analytics or charts
- No audit log
- No late fee calculation
- No CSV export of summaries
- No OAuth inbox integration (intentionally excluded — forwarding address approach preferred)

---

## Dependencies to Add

### Backend
```txt
python-jose[cryptography]  # For JWT verification (already added)
openpyxl                   # Phase 1.1: Read .xlsx files
xlrd                       # Phase 1.1: Read legacy .xls files
```

### Frontend
```bash
npm install @supabase/auth-helpers-nextjs
npm install date-fns  # Date formatting
# Phase 1.1 — no additional frontend dependencies needed for file upload
```

---

## Manual Testing Checklist (Day 10)

- [ ] Sign up new user
- [ ] Login with existing user
- [ ] Upload PDF contract
- [ ] Review extracted terms (edit fields, submit)
- [ ] View contract list on dashboard
- [ ] View contract detail page
- [ ] Add sales period (flat rate) via manual form
- [ ] Add sales period (tiered rate) via manual form
- [ ] Add sales period (category-specific rate) via manual form
- [ ] Enter licensee reported royalty and verify discrepancy is shown
- [ ] Verify royalty calculation is correct
- [ ] Verify YTD summary updates
- [ ] Test error states (invalid file, API errors)
- [ ] Test mobile responsive (resize browser)
- [ ] Logout and verify redirect to login
- [ ] Test deployed app (Vercel + Railway)
