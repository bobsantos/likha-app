# Likha MVP - Week 2 Implementation Plan

**Created:** 2026-02-07
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
- [ ] Create contract detail page: `/frontend/app/(app)/contracts/[id]/page.tsx`
  - Fetch contract by ID
  - Fetch sales periods
  - Display contract summary
  - Display sales history table

**Components:**
- `ContractHeader` - Licensee name, contract period, status
- `ContractTerms` - Display all terms in readable format
- `SalesHistoryTable` - List of sales periods

**Afternoon: Sales Entry Form**
- [ ] Create sales entry page: `/frontend/app/(app)/sales/new/page.tsx`
- [ ] Build sales entry component: `/frontend/components/sales-entry-form.tsx`
  - Contract selector
  - Period dates (start + end)
  - Net sales amount
  - Category breakdown (conditional)
  - Display calculated royalty after submission

**Components:**
- `SalesEntryForm` - Form to add sales period
- `CategoryBreakdownInput` - Multi-input for category sales
- `RoyaltyResult` - Display calculated royalty + YTD

### Backend Tasks

**YTD Summary Implementation**
- [ ] Implement `GET /api/sales/summary/{contract_id}` (currently 501)
  - Calculate YTD totals from sales_periods
  - Apply minimum guarantee logic
  - Track advance payment credit
  - Return RoyaltySummary model

- [ ] Add minimum guarantee application in `royalty_calc.py`:
  - Quarterly minimum: `max(calculated, quarterly_min)`
  - Annual minimum: track shortfall, apply at year-end
  - Set `minimum_applied` flag correctly

- [ ] Advance payment tracking:
  - Deduct advance from Year 1 royalties
  - Track remaining credit
  - Reset for Year 2+

**Success Criteria:**
- `/api/sales/summary/{contract_id}` returns complete YTD data
- Minimum guarantee correctly applied
- Advance payment properly credited

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
  - Mock Anthropic API to avoid costs

- [ ] Deployment configuration:
  - Create `Dockerfile` for Railway
  - Add `railway.json` for service config
  - Document environment variables

- [ ] API documentation polish:
  - Review auto-generated `/docs`
  - Add response examples to docstrings

---

## New Files to Create

### Backend

| File | Purpose |
|------|---------|
| `backend/app/auth.py` | Auth middleware with JWT verification |
| `backend/app/services/storage.py` | Supabase Storage integration |
| `backend/tests/test_integration.py` | Integration tests |
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
| `frontend/app/(app)/sales/new/page.tsx` | Sales entry page |
| `frontend/components/nav.tsx` | Navigation bar |
| `frontend/components/contract-card.tsx` | Contract card for dashboard |
| `frontend/components/contract-form.tsx` | Contract review form |
| `frontend/components/contract-upload.tsx` | File upload component |
| `frontend/components/sales-entry-form.tsx` | Sales entry form |
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
│       └── new/page.tsx
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

## Success Metrics (End of Week 2)

After completing Day 10:

- [ ] User can sign up and login
- [ ] User can upload contract PDF
- [ ] Extraction review form displays and is editable
- [ ] Contract is saved to database
- [ ] Dashboard shows list of contracts
- [ ] User can add sales period
- [ ] Royalty is calculated correctly (flat, tiered, category)
- [ ] YTD summary is displayed
- [ ] Minimum guarantee logic works
- [ ] App is deployed (Frontend: Vercel, Backend: Railway)
- [ ] All pages are mobile responsive
- [ ] Error states are handled gracefully

**Ready for:**
- Beta user testing (Week 3)
- User feedback collection
- Iteration based on real usage

---

## Known Limitations (Deferred to v2)

- No email verification
- No forgot password flow
- No contract editing (create only)
- No contract deletion
- No sales period editing/deletion
- No PDF viewing in browser
- No multi-user accounts
- No payment tracking
- No email reminders
- No CSV import
- No advanced analytics

---

## Dependencies to Add

### Backend
```txt
python-jose[cryptography]  # For JWT verification
```

### Frontend
```bash
npm install @supabase/auth-helpers-nextjs
npm install date-fns  # Date formatting
```

---

## Manual Testing Checklist (Day 10)

- [ ] Sign up new user
- [ ] Login with existing user
- [ ] Upload PDF contract
- [ ] Review extracted terms (edit fields, submit)
- [ ] View contract list on dashboard
- [ ] View contract detail page
- [ ] Add sales period (flat rate)
- [ ] Add sales period (tiered rate)
- [ ] Add sales period (category-specific rate)
- [ ] Verify royalty calculation is correct
- [ ] Verify YTD summary updates
- [ ] Test error states (invalid file, API errors)
- [ ] Test mobile responsive (resize browser)
- [ ] Logout and verify redirect to login
- [ ] Test deployed app (Vercel + Railway)
