# Phase 1.2: Discrepancy Resolution

**Created:** 2026-02-24
**Status:** Planned
**Depends on:** Phase 1 (Discrepancy Detection) — complete
**Scope:** Backend + Frontend + Migration

---

## Problem

Phase 1 detects discrepancies between the system's calculated royalty and the licensee's reported royalty. The contract detail page shows color-coded badges (red for under-reported, amber for over-reported) and a sidebar summary card.

But once a licensor sees a discrepancy, there is nothing they can do about it inside Likha. There is no way to:

- Mark a discrepancy as resolved, disputed, or waived
- Record notes about what action was taken
- See open discrepancies at a glance across contracts on the dashboard
- Filter the sales periods table to focus on problem periods

The amber badges accumulate and the licensor cannot distinguish "I'm tracking this" from "I haven't looked at this yet." They are back to email and spreadsheets for follow-up.

---

## Competitive Context

- **Flowhaven** has approve/reject/request-revision actions on submitted reports. A discrepancy blocks the period from being "approved."
- **RoyaltyZone** has a review queue — submitted reports sit in a pending state until the licensor approves or flags them.
- **SMB-tier tools** (Brainbase, Excel workflows) have no structured discrepancy resolution — this is a genuine gap at the price point Likha targets.

The pattern across enterprise tools: discrepancy detection gates the period. You cannot close the period as settled until you have resolved the discrepancy.

---

## Scope

### What This Includes

1. Resolution status lifecycle on each discrepant sales period
2. Resolution notes for internal tracking
3. Cross-contract discrepancy visibility on the dashboard
4. Filtering on the sales periods table
5. Bug fix: manual `POST /sales/` silently drops `licensee_reported_royalty`

### What This Does NOT Include (Defer to Phase 2+)

- Automated email to the licensee from within Likha
- Formal dispute workflow with licensee responses (requires licensee portal)
- Payment tracking (actual payment received vs. owed)
- Audit log / event history table
- Late fee calculation

---

## Schema Changes

New migration: `supabase/migrations/[timestamp]_add_discrepancy_resolution.sql`

```sql
ALTER TABLE sales_periods
  ADD COLUMN IF NOT EXISTS discrepancy_status TEXT
    CHECK (discrepancy_status IN ('open', 'resolved', 'waived'))
    NULL;

ALTER TABLE sales_periods
  ADD COLUMN IF NOT EXISTS discrepancy_notes TEXT NULL;

ALTER TABLE sales_periods
  ADD COLUMN IF NOT EXISTS discrepancy_resolved_at TIMESTAMP WITH TIME ZONE NULL;
```

Default behavior: when `has_discrepancy = true` and `discrepancy_status` is NULL, treat as `open`. The backend model will handle this computation.

---

## Backend Changes

### New Endpoint

`PATCH /api/sales/{period_id}/discrepancy`

Request body:
```json
{
  "status": "resolved",       // "open" | "resolved" | "waived"
  "notes": "Licensee corrected in next quarter payment"  // optional
}
```

Response: updated `SalesPeriodResponse`

Auth: requires ownership verification (user owns the contract that owns this period).

### Model Updates (`backend/app/models/sales.py`)

Add to `SalesPeriod` / `SalesPeriodResponse`:
- `discrepancy_status: Optional[str]` — stored field
- `discrepancy_notes: Optional[str]` — stored field
- `discrepancy_resolved_at: Optional[datetime]` — stored field

Update the `has_discrepancy` computed field logic:
- When `discrepancy_status` is `resolved` or `waived`, the period is no longer "open"
- Add a computed `discrepancy_is_open: bool` field: `has_discrepancy and discrepancy_status in (None, 'open')`

### Dashboard Summary Endpoint Update

Update `GET /api/sales/dashboard-summary` to include:
- `total_open_discrepancy_amount: Decimal` — sum of `discrepancy_amount` across all open discrepant periods
- `open_discrepancy_count: int` — number of periods with open discrepancies
- `discrepancy_contract_count: int` — number of contracts with at least one open discrepancy

### Bug Fix

In `POST /api/sales/` (manual period creation), `licensee_reported_royalty` is accepted in `SalesPeriodCreate` but silently dropped during the DB insert. Fix: include it in the insert payload.

---

## Frontend Changes

### Priority 1: Filter Strip on Sales Periods Table (no backend needed)

File: `frontend/app/(app)/contracts/[id]/page.tsx`

Add a filter strip above the sales periods table with pill buttons:
- **All** — show all periods (default)
- **Discrepancies** — show only periods where `has_discrepancy = true`
- **Matched** — show only periods where `has_discrepancy = false` or no reported royalty

Include a count badge: "N need attention" when there are open discrepancies.

### Priority 2: Improved Upload Preview Discrepancy Card (no backend needed)

File: `frontend/components/sales-upload/upload-preview.tsx`

Replace the current passive amber message with a structured card that:
- Shows the discrepancy amount prominently
- Explains what happens next: "This period will be flagged as an open discrepancy after you confirm."
- Sets expectations: "You can update the discrepancy status from the contract detail page after saving."

### Priority 3: Resolution Action per Discrepant Row (needs backend)

File: `frontend/app/(app)/contracts/[id]/page.tsx`

Add a "Resolve" button on each row where `discrepancy_is_open = true`. Clicking it opens a popover or small inline form:
- Status selector: Resolved / Waived
- Optional free-text note field
- Save button

Once resolved/waived, the badge changes from red/amber to a muted "Resolved" or "Waived" state. The original discrepancy amount remains visible.

### Priority 4: Discrepancy Tile on Dashboard Summary (needs backend)

File: `frontend/components/DashboardSummary.tsx`

Add a third summary tile (only rendered when `total_open_discrepancy_amount > 0`):
- Title: "Open Discrepancies"
- Value: formatted currency amount
- Subtitle: "Across N contracts"
- Visual: red/warning treatment (red-50 bg, red-700 text)

Dashboard grid shifts to `md:grid-cols-3` when the tile is present.

### Priority 5: Discrepancy Badge on ContractCard (needs backend)

File: `frontend/components/ContractCard.tsx`

When a contract has open discrepancies:
- Show a compact red badge near the contract name: "Discrepancy"
- Add a line showing the total open discrepancy amount for that contract

This requires the contract list endpoint to include `open_discrepancy_amount` — either as a joined query or a separate summary field.

### Type Updates

File: `frontend/types/index.ts`

Add to `SalesPeriod`:
```typescript
discrepancy_status?: 'open' | 'resolved' | 'waived' | null
discrepancy_notes?: string | null
discrepancy_resolved_at?: string | null
discrepancy_is_open?: boolean
```

### New API Function

File: `frontend/lib/api.ts`

```typescript
resolveDiscrepancy(periodId: string, status: string, notes?: string): Promise<SalesPeriod>
```

---

## Files to Change

### Backend
- `supabase/migrations/[timestamp]_add_discrepancy_resolution.sql` — new
- `backend/app/models/sales.py` — add resolution fields, update computed fields
- `backend/app/routers/sales.py` — add PATCH endpoint, fix POST bug
- `backend/app/routers/sales_upload.py` — set `discrepancy_status = 'open'` on confirm when discrepancy exists
- `backend/tests/test_sales.py` — tests for PATCH endpoint and POST fix
- `backend/tests/test_sales_upload.py` — tests for auto-status on upload confirm

### Frontend
- `frontend/types/index.ts` — add resolution fields
- `frontend/lib/api.ts` — add `resolveDiscrepancy` function
- `frontend/app/(app)/contracts/[id]/page.tsx` — filter strip, resolve button, badge updates
- `frontend/components/sales-upload/upload-preview.tsx` — improved discrepancy card
- `frontend/components/DashboardSummary.tsx` — discrepancy tile
- `frontend/components/ContractCard.tsx` — discrepancy badge

---

## Success Criteria

- [ ] Licensor can mark a discrepant period as resolved or waived with an optional note
- [ ] Resolved/waived periods are visually distinct from open discrepancies
- [ ] Dashboard shows total open discrepancy amount across all contracts
- [ ] Contract cards show a discrepancy indicator when open discrepancies exist
- [ ] Sales periods table can be filtered to show only discrepancies
- [ ] Upload preview sets clear expectations about discrepancy tracking
- [ ] Manual sales entry correctly persists `licensee_reported_royalty`
- [ ] All new tests passing (backend + frontend)
