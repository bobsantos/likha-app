# Duplicate Contract Detection + Draft Persistence

## Problem

Two related issues in the contract upload flow:

1. **Duplicate uploads:** The system silently allows duplicate filenames by prepending a UUID prefix to storage paths. Users can upload the same PDF multiple times with no warning.
2. **Lost work:** Extraction results live entirely in React state. If the user navigates away, closes the tab, or gets interrupted during review, their work is gone. The PDF sits orphaned in storage with no DB record. For MVP users who are exploring/testing, this is the primary behavior pattern — not an edge case.

## Desired Behavior

- Persist a **draft contract** to the database immediately after successful extraction, so work survives tab close.
- Check for duplicate filenames **before** uploading or extracting, returning a 409 with context-aware messaging (link to active contract, or resume link for drafts).
- Distinguish between **draft** (extracted, not reviewed) and **active** (user-confirmed) contracts throughout the UI.

---

## Design Decisions

- **Match on original filename** (case-insensitive, per user). Not on `storage_path`.
- **No "Replace existing" option.** Too risky for a financial/legal tool where contracts may have sales periods attached.
- **Check happens before upload and extraction** to avoid wasted storage writes and AI tokens.
- **Draft row created at extraction time.** The `POST /extract` endpoint writes a `status='draft'` row to the DB after successful extraction. This means extraction results are persisted server-side, not just in React state.
- **Confirm promotes draft to active.** The review/save step becomes a `PUT /{id}/confirm` that transitions `status` from `draft` to `active`.
- **Storage uses `upsert: true`** with deterministic paths so re-uploads overwrite orphaned files.
- **Best-effort cleanup on extraction failure.** If extraction throws after the PDF is already uploaded, attempt to delete the storage file before re-raising the error.

---

## Architecture: Before and After

**Before (current):**
```
POST /extract  →  PDF to storage + extraction in-memory  →  POST /  (creates DB row)
                  ↑ nothing persisted to DB                   ↑ only persistence point
```

**After:**
```
POST /extract  →  PDF to storage + extraction + draft DB row  →  PUT /{id}/confirm  (draft → active)
                  ↑ draft persisted immediately                   ↑ promotes to active
```

---

## Changes

### 1. Database Migration

```sql
-- Contract status
ALTER TABLE contracts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'active'));

-- Original filename for duplicate detection
ALTER TABLE contracts ADD COLUMN filename TEXT;

-- Drop NOT NULL constraints for fields not available at draft time
-- (These are populated during the confirm/review step, not at extraction)
ALTER TABLE contracts ALTER COLUMN licensee_name DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN royalty_rate DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN royalty_base DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN contract_start_date DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN contract_end_date DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN minimum_guarantee DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN minimum_guarantee_period DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN reporting_frequency DROP NOT NULL;

-- Indexes
CREATE INDEX idx_contracts_user_filename ON contracts(user_id, lower(filename));
CREATE INDEX idx_contracts_user_status ON contracts(user_id, status);
```

Note: `pdf_url` and `extracted_terms` stay NOT NULL — both are populated at extraction time before the draft row is inserted.

### 2. Backend Models — `backend/app/models/contract.py`

```python
class ContractStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
```

**New model for draft creation** (what `POST /extract` inserts):

```python
class ContractDraftCreate(BaseModel):
    filename: str
    pdf_url: str
    storage_path: str
    extracted_terms: ExtractedTerms
    status: ContractStatus = ContractStatus.DRAFT
```

**New model for confirm** (what `PUT /{id}/confirm` receives):

```python
class ContractConfirm(BaseModel):
    licensee_name: str
    royalty_rate: RoyaltyRate
    royalty_base: str = "net sales"
    territories: list[str] = []
    product_categories: list[str] | None = None
    contract_start_date: date
    contract_end_date: date
    minimum_guarantee: Decimal = Decimal("0")
    minimum_guarantee_period: MinimumGuaranteePeriod = MinimumGuaranteePeriod.ANNUALLY
    advance_payment: Decimal | None = None
    reporting_frequency: ReportingFrequency = ReportingFrequency.QUARTERLY
```

**`Contract` response model:** Add `status: ContractStatus` and `filename: str | None`. Make user-review fields (`licensee_name`, `royalty_rate`, etc.) `Optional` to accommodate draft rows.

### 3. Backend Router — `backend/app/routers/contracts.py`

#### `POST /api/contracts/extract` — Duplicate check + draft creation

1. Validate file is PDF
2. Query `contracts` table for filename match (case-insensitive, per user)
3. **If match found:**
   - `status = 'active'` → 409 `DUPLICATE_FILENAME`
   - `status = 'draft'` → 409 `INCOMPLETE_DRAFT`
4. **If no match:** proceed with upload + extraction
5. **After successful extraction:** INSERT draft row with `status='draft'`, return `contract_id` in response
6. **If extraction fails after upload:** best-effort `delete_contract_pdf(storage_path)` before re-raising

Updated response shape:

```json
{
  "contract_id": "uuid-of-draft",
  "extracted_terms": { ... },
  "form_values": { ... },
  "token_usage": { ... },
  "filename": "Nike_License_2024.pdf",
  "storage_path": "contracts/user-id/Nike_License_2024.pdf",
  "pdf_url": "https://..."
}
```

#### `PUT /api/contracts/{id}/confirm` — Promote draft to active

New endpoint. Receives `ContractConfirm` body with user-reviewed fields. Verifies:
- Contract exists and belongs to the user
- Contract is in `draft` status (409 if already `active`)

Updates the row with all confirmed fields and sets `status = 'active'`.

#### `GET /api/contracts/` — Filter by status

Add optional `include_drafts: bool = False` query param. Default returns only `status='active'` to preserve existing frontend behavior. Drafts are surfaced explicitly when the frontend requests them.

#### `DELETE /api/contracts/{id}` — No change

Works for both draft and active contracts.

### 4. 409 Response Shapes

**Active duplicate:**
```json
{
  "detail": {
    "code": "DUPLICATE_FILENAME",
    "message": "A contract with this filename already exists.",
    "existing_contract": {
      "id": "uuid",
      "filename": "Nike_License_2024.pdf",
      "licensee_name": "Nike Inc.",
      "created_at": "2026-01-15T10:30:00Z",
      "status": "active"
    }
  }
}
```

**Incomplete draft:**
```json
{
  "detail": {
    "code": "INCOMPLETE_DRAFT",
    "message": "You have an incomplete upload for this file.",
    "existing_contract": {
      "id": "uuid",
      "filename": "Nike_License_2024.pdf",
      "created_at": "2026-02-19T08:15:00Z",
      "status": "draft"
    }
  }
}
```

### 5. Backend Storage — `backend/app/services/storage.py`

- Remove UUID prefix logic. Keep filename sanitization.
- Storage path becomes deterministic: `contracts/{user_id}/{sanitized_filename}`
- Change to `upsert: true` so re-uploads overwrite orphaned files.

### 6. Frontend Types — `frontend/types/index.ts`

```typescript
export type ContractStatus = 'draft' | 'active'

export interface Contract {
  id: string
  user_id: string
  status: ContractStatus
  filename: string | null
  licensee_name: string | null      // was: string (nullable for drafts)
  royalty_rate: RoyaltyRate | null   // was: RoyaltyRate
  royalty_base: string | null        // was: string
  // ... other review fields become nullable
  pdf_url: string
  created_at: string
  updated_at: string
}

export interface ExtractionResponse {
  contract_id: string   // NEW — draft ID from backend
  extracted_terms: ExtractedTerms
  form_values: FormValues
  token_usage: TokenUsage
  filename: string
  storage_path: string
  pdf_url: string
}

export interface DuplicateContractInfo {
  id: string
  filename: string
  licensee_name?: string   // present for active, absent for drafts
  created_at: string
  status: ContractStatus
}
```

### 7. Frontend API Client — `frontend/lib/api.ts`

Add `data?: unknown` field to `ApiError`:

```typescript
export class ApiError extends Error {
  status: number
  data?: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}
```

Pass parsed body as third argument when throwing in `uploadContract()`.

Add new function:

```typescript
export async function confirmDraft(contractId: string, data: ContractConfirm): Promise<Contract>
```

### 8. Frontend Upload Page — `frontend/app/(app)/contracts/upload/page.tsx`

#### Draft flow changes
- Store `draftContractId` in state from extraction response
- `handleSaveContract` calls `confirmDraft(draftContractId, data)` instead of `createContract(data)`
- Rename "Save Contract" button to **"Confirm and Save"**

#### State persistence
- Serialize `formData` + `draftContractId` to `sessionStorage` on entering review step
- On mount, check for existing draft data and offer to restore
- Clear on successful save or explicit cancel
- Add `beforeunload` warning during review step

#### 409 error handling
- Add `'duplicate'` and `'incomplete_draft'` to `ErrorType` union
- In `classifyError`: detect 409 with `DUPLICATE_FILENAME` vs `INCOMPLETE_DRAFT`

**For active duplicate (DUPLICATE_FILENAME):**
- Title: **"A contract with this filename already exists"**
- Filename in monospace pill, formatted date
- Primary: **"View existing contract"** → `/contracts/{id}`
- Secondary: **"Choose a different file"**

**For incomplete draft (INCOMPLETE_DRAFT):**
- Title: **"You have an unfinished upload for this file"**
- Primary: **"Resume review"** → `/contracts/upload?draft={id}` or `/contracts/{id}` with draft detection
- Secondary: **"Choose a different file"**

#### Low-confidence warning
- Show amber warning banner on review step when `confidence_score < 0.7`
- Display `extraction_notes` as a list

### 9. Contract List Page — `frontend/app/(app)/contracts/page.tsx`

- Fetch with `include_drafts=true`
- Show drafts in a separate "Needs Review" section above the main grid (only when drafts exist)
- Draft cards link to resume the review flow

### 10. Contract Detail Page — `frontend/app/(app)/contracts/[id]/page.tsx`

- Replace hardcoded "Active" badge with status-aware badge:
  - `draft` → amber "Draft" badge
  - `active` → green "Active" badge
- Show persistent review banner for draft contracts with "Complete review" link
- Disable "Enter Sales Period" button for drafts (with tooltip explaining why)

### 11. ContractCard Component

- Status-aware badge (amber "Draft" vs green "Active")
- Draft cards show "Resume review" CTA instead of "View details"

### 12. Backend Tests

- Update `test_successful_upload_returns_storage_path` — remove UUID prefix assertion
- Add tests for:
  - Draft row created on successful extraction
  - `PUT /{id}/confirm` promotes draft to active
  - 409 `DUPLICATE_FILENAME` for active contracts
  - 409 `INCOMPLETE_DRAFT` for draft contracts
  - Case-insensitive filename matching
  - `GET /` filters by status correctly
  - Best-effort storage cleanup on extraction failure

### 13. Frontend Tests

- Update all `Contract` mock fixtures to include `status: 'active'`
- Update `ApiError` mock to accept `data` parameter
- Add tests for:
  - 409 `DUPLICATE_FILENAME` shows active duplicate UI
  - 409 `INCOMPLETE_DRAFT` shows resume UI
  - Draft badge renders on ContractCard
  - "Enter Sales Period" disabled for draft contracts
  - sessionStorage draft restoration
  - `confirmDraft` called instead of `createContract` on save

---

## Edge Cases

| Case | Handling |
|---|---|
| Extraction fails after PDF uploaded | Best-effort `delete_contract_pdf(storage_path)` in `except` block before re-raising. No draft row exists (insert happens after extraction). |
| User abandons review (tab close) | Draft row persists in DB. Re-upload triggers 409 `INCOMPLETE_DRAFT` with resume link. sessionStorage allows same-session recovery. |
| Duplicate filename, active contract exists | 409 `DUPLICATE_FILENAME` with "View existing contract" link. |
| Duplicate filename, draft exists | 409 `INCOMPLETE_DRAFT` with "Resume review" link. |
| Case sensitivity (`File.pdf` vs `file.pdf`) | Case-insensitive match via `lower()` in SQL. |
| Existing rows with NULL filename | `NULL` never matches in SQL comparisons — no false 409s. |
| Race condition (concurrent same-filename uploads) | Low probability at MVP. `UNIQUE(user_id, lower(filename))` constraint is the definitive fix if needed later. |
| User renames file before uploading | Not detected as duplicate. Filename is the user's signal, not file content. |
| Draft with no sales periods, user re-uploads | 409 `INCOMPLETE_DRAFT` — user should resume, not restart. |
| Contract with sales periods but no extracted terms | Data anomaly. 409 with message to contact support. |
| Stale sessionStorage (draft deleted on backend) | Frontend checks draft existence on mount; clears sessionStorage if draft is gone. |

---

## Effort Estimate

| Area | Estimate |
|---|---|
| DB migration | 45-60 min |
| Backend models | 1-1.5 hrs |
| `POST /extract` (draft + duplicate check) | 1-1.5 hrs |
| `PUT /{id}/confirm` | 1-1.5 hrs |
| `GET /` status filter | 15-20 min |
| 409 branching (active vs draft) | 20-30 min |
| Storage changes (remove UUID, upsert) | 30 min |
| Backend tests | 1-2 hrs |
| Frontend types | < 30 min |
| API client (`confirmDraft`, `ApiError.data`) | 30 min - 1 hr |
| Upload page (draft flow + sessionStorage + 409 UI) | 2-4 hrs |
| Contract list (draft section) | 30 min - 2 hrs |
| Contract detail (draft banner + disabled sales) | 30 min - 2 hrs |
| ContractCard (status badge) | < 30 min |
| Frontend tests | 2-4 hrs |
| **Total** | **~12-18 hrs (1.5-2 days)** |

---

## Implementation Order

### Phase 1: Backend Foundation [DONE]
1. [x] Database migration (add `status`, `filename`, drop NOT NULL constraints, indexes)
2. [x] Backend models (`ContractStatus`, `ContractDraftCreate`, `ContractConfirm`, nullable `Contract`)
3. [x] Storage changes (remove UUID prefix, `upsert: true`)
4. [x] Router: update `POST /extract` (duplicate check + draft insert + cleanup on failure)
5. [x] Router: add `PUT /{id}/confirm`
6. [x] Router: update `GET /` with status filter
7. [x] Backend tests (36 new tests, all passing; updated existing tests for new behavior)

### Phase 2: Frontend Foundation [DONE]
8. [x] Frontend types (`status`, nullable fields, `ExtractionResponse.contract_id`, `DuplicateContractInfo`)
9. [x] API client (`ApiError.data`, `confirmDraft()`)
10. [x] Upload page (draft flow, `confirmDraft` call, rename button to "Confirm and Save")

### Phase 3: Frontend Polish [DONE]
11. [x] Upload page 409 handling (duplicate + incomplete draft error UI)
12. [x] Upload page state persistence (sessionStorage + draft restore banner)
13. [x] ContractCard status-aware badge
14. [x] Contract list page (draft section)
15. [x] Contract detail page (draft banner, disabled sales entry)
16. [x] Frontend tests (26 new tests added; all 125 pass)
