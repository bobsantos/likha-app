# Spec: Add licensee_email and agreement_number to Contract UI

**Date:** 2026-02-25
**Status:** Ready for implementation

---

## Problem

`licensee_email` exists in the database (migration `20260224200000_add_licensee_email_to_contracts.sql`) and in the backend model (`ContractConfirm`, `Contract`), but has no UI. `agreement_number` does not exist at all — it was explicitly deferred in the email intake ADR. Both fields are required to make Signal 1 (sender email exact match) and Signal 2 (agreement reference number) functional in the email intake matching feature. Right now neither signal can fire because users have no way to populate them.

---

## Fields to Add

### `licensee_email`
The email address from which the licensee sends royalty reports. Used by Signal 1: exact match against the `From` address on inbound emails.

- Type: text, email format
- Required: no
- Validation: valid email format when provided; empty string and null are both acceptable
- DB status: column exists (`TEXT`, nullable). No migration needed.
- AI extraction: can be pre-populated if the contract document contains a licensee contact email

### `agreement_number`
The reference number printed on the contract document (e.g., `LIC-2024-001`, `AGR-0042`). Used by Signal 2: regex scan of attachment rows matched against this value.

- Type: text, free-form
- Required: no
- Validation: max 100 characters; no format enforcement (reference numbers vary by licensor)
- DB status: column does not exist. A migration is required (see below).
- AI extraction: can be pre-populated if a reference number is found during contract PDF extraction

---

## Where These Fields Appear

### 1. Contract confirmation form (`frontend/components/contract-form.tsx`)

Add both fields to `ContractFormData` and render them in the form grid. Placement: after the Licensee Name field, before Licensor Name, so all identity fields are grouped together.

- `licensee_email`: `<input type="email">`, label "Licensee Email", hint text "The address this licensee sends reports from. Used for automatic email matching."
- `agreement_number`: `<input type="text" maxLength={100}>`, label "Agreement Number", hint text "The reference number on the contract document, e.g. LIC-2024-001."

Both fields are optional. No asterisk. No blocking validation on submit — a malformed email produces a visible warning but does not prevent saving.

The backend `ContractConfirm` model already accepts `licensee_email`. It needs `agreement_number` added as `Optional[str] = None`.

### 2. Contract detail page (`frontend/app/(app)/contracts/[id]/page.tsx`)

Add both fields to the Contract Terms section, rendered only when the value is non-null. Placement: after the Licensor row, before Royalty Base.

- `licensee_email`: label "Licensee Email", value as plain text (not a mailto link — avoids accidental clicks)
- `agreement_number`: label "Agreement Number"

No inline edit on this page in this change. The existing edit path is the upload flow; that is sufficient for now.

### 3. Contracts list page

No change in this spec. The list page is already dense. Licensee email as a secondary line would add noise for users who have not set it (the majority at rollout). Revisit if users request it.

---

## Migration Needed

`agreement_number` requires a new migration. `licensee_email` already has its column.

**File:** `supabase/migrations/20260225300000_add_agreement_number_to_contracts.sql`

```sql
-- Add agreement_number to contracts for Signal 2 email intake matching.
-- Used by the intake processor to match inbound reports to contracts by
-- scanning attachment rows for the reference number pattern.

ALTER TABLE contracts ADD COLUMN agreement_number TEXT;

-- Index for exact-match lookups in the matching query.
-- The matching query is: WHERE agreement_number = $1 AND user_id = $2
-- A partial index on non-null values keeps it small.
CREATE INDEX idx_contracts_agreement_number
  ON contracts (user_id, agreement_number)
  WHERE agreement_number IS NOT NULL;
```

No index change is needed for `licensee_email` — `idx_contracts_user_id` already exists and the matching query filters by `user_id` first; the table is small enough per user that a sequential scan on the remaining rows is fine at MVP scale. Add a dedicated index if profiling shows a need.

---

## Impact on Email Intake Matching

With both fields visible and editable:

- **Signal 1** becomes operational. Users set `licensee_email` once during contract setup (or correct it post-confirmation). Inbound reports from that address auto-match at `high` confidence.
- **Signal 2** becomes operational. Users enter the agreement reference number from the contract document. The intake processor scans attachment rows for that value and sets `high` confidence on a match.
- **AI extraction** can attempt to pre-populate both fields from the PDF during the extraction step. This reduces the manual setup burden — users only need to correct, not type from scratch.

Signal 3 (licensee name substring) already works today, as `licensee_name` has always been visible and required.

---

## Edge Cases

**Multiple contracts with the same `licensee_email`**
Legitimate when a licensee has more than one active agreement and sends all reports from the same address. Signal 1 will return multiple matches at the same confidence level. The matching logic must not auto-select in this case — it should populate `candidate_contract_ids` with all matches and leave `contract_id` null, exactly as it does for medium-confidence matches. The ADR's "multiple contract matches at same confidence" policy covers this: surface all matches as candidates, require user selection.

**Changing `licensee_email` after reports have already been matched**
Previously matched `inbound_reports` rows retain their `contract_id` — historical matches are not invalidated. Future inbound reports use the new email. No retroactive re-matching. Users should understand that changing this field affects future intake only; a short helper text on the field can reinforce this.

**Changing `agreement_number` after reports have been matched**
Same policy as above. Historical matches are unaffected. The field controls future Signal 2 lookups only.

**Empty values**
When `licensee_email` is null, Signal 1 does not fire. When `agreement_number` is null, Signal 2 does not fire. Both are graceful non-events — the intake processor falls through to Signal 3 (licensee name). No error, no warning on the inbound report.

**Email format validation**
A malformed `licensee_email` (e.g., `bob at example`) stored on the contract will simply never produce a Signal 1 match (sender addresses are always well-formed). The consequence is low-severity. Frontend validation should warn but not block, so users can save a partial entry and return to fix it.

---

## Files to Modify

| File | Change |
|---|---|
| `supabase/migrations/20260225300000_add_agreement_number_to_contracts.sql` | New file — add `agreement_number` column and index |
| `backend/app/models/contract.py` | Add `agreement_number: Optional[str] = None` to `ContractConfirm`, `Contract`, and `FormValues` |
| `frontend/components/contract-form.tsx` | Add `licensee_email` and `agreement_number` to `ContractFormData` and render both inputs |
| `frontend/app/(app)/contracts/[id]/page.tsx` | Display `licensee_email` and `agreement_number` in the Contract Terms section |
| `frontend/types/index.ts` | Add `licensee_email` and `agreement_number` to the `Contract` type |

The backend `PUT /{id}/confirm` router handler also needs to pass `agreement_number` through to the database update — check `backend/app/routers/contracts.py` to confirm it is included in the upsert payload.
