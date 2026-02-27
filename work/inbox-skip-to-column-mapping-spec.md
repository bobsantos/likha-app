# Inbox Confirm: Skip to Column Mapping

**Created:** 2026-02-27
**Status:** Planned
**Branch:** ai-assisted-column-mapping
**Scope:** Backend + Frontend (no schema change required)

---

## Problem

When a user clicks "Confirm & Open Upload Wizard" from the inbox review page, they land on Step 1 of the sales upload wizard — a period selection form and file drag-and-drop zone. Both of those inputs are redundant for inbox-sourced reports:

1. **The file already exists.** The email attachment was uploaded to Supabase Storage at `inbound/{user_id}/{report_id}/{filename}` during webhook processing. The path is stored in `inbound_reports.attachment_path`.
2. **The period was already reviewed.** The user just verified `suggested_period_start` and `suggested_period_end` on the inbox review page before clicking Confirm.

Forcing the user to re-upload a file they never had and re-enter dates they already reviewed creates friction and an opportunity for error. The wizard should begin at Step 2 (column mapping) when the file and period are already known.

---

## What Data Is Already Available

After the user clicks "Confirm & Open Upload Wizard" and the backend processes the confirm request, all of the following are known:

| Data | Source |
|------|--------|
| `attachment_path` | `inbound_reports.attachment_path` — Supabase Storage path under the `contracts` bucket |
| `attachment_filename` | `inbound_reports.attachment_filename` — original filename for display |
| `suggested_period_start` | `inbound_reports.suggested_period_start` — ISO date, may be null |
| `suggested_period_end` | `inbound_reports.suggested_period_end` — ISO date, may be null |
| `contract_id` | Resolved during confirm (user selection or auto-match) |
| `report_id` | The inbound_reports row being processed |

The `attachment_path` points to a file already in Supabase Storage. The existing upload endpoint (`POST /api/sales/upload/{contract_id}`) accepts a multipart `file` — it does not know about stored paths. A new endpoint (or a new parameter path) is needed to trigger parsing from a stored attachment rather than from a freshly uploaded file.

---

## What Step 1 Currently Does That Must Be Replicated Automatically

The `StepUpload` component in the wizard does three things that must happen before column mapping can begin:

1. **Period validation** — runs `GET /api/sales/upload/{contract_id}/period-check` with the entered start/end dates. Returns overlap warnings, contract date range violations, and frequency mismatch warnings. The user must acknowledge any warnings before proceeding.
2. **File upload and parsing** — calls `POST /api/sales/upload/{contract_id}` with the file bytes, `period_start`, and `period_end`. The backend parses the spreadsheet, runs column mapping suggestions, stores the result in the in-memory `_upload_store`, and returns an `UploadPreviewResponse` containing `upload_id`, `detected_columns`, `suggested_mapping`, `sample_rows`, `total_rows`, and `category_resolution`.
3. **Period date capture** — the entered dates are stored in `uploadPreview.period_start` / `uploadPreview.period_end` and carried through to the confirm step.

For the inbox path, steps (2) and (3) must happen automatically using the stored attachment. Step (1) must still be surfaced as warnings — but silently in the background, not as a blocking gate before the file is even uploaded.

---

## Backend Changes

### New Endpoint: Parse from Stored Attachment

Add a new endpoint to the sales upload router:

```
POST /api/sales/upload/{contract_id}/parse-stored
```

**Request body (JSON):**
```json
{
  "attachment_path": "inbound/{user_id}/{report_id}/{filename}",
  "period_start": "2025-01-01",
  "period_end": "2025-03-31",
  "report_id": "{uuid}"
}
```

**What it does:**
1. Verifies the user owns `contract_id` (existing `verify_contract_ownership` dependency).
2. Verifies the `report_id` belongs to the user and that `report.attachment_path` matches `attachment_path` (prevents path-guessing attacks).
3. Downloads the file bytes from Supabase Storage using the admin client (`supabase_admin.storage.from_("contracts").download(attachment_path)`).
4. Runs the same parsing pipeline as `POST /upload/{contract_id}`: `parse_upload` -> `suggest_mapping` -> `suggest_category_mapping` -> `_store_upload`.
5. Returns the same `UploadPreviewResponse` shape as the existing upload endpoint, including `upload_id`, `detected_columns`, `suggested_mapping`, `mapping_source`, `mapping_sources`, `sample_rows`, `total_rows`, `period_start`, `period_end`, and `category_resolution`.

**Why not reuse the existing `POST /upload/{contract_id}` endpoint?**
That endpoint requires a multipart `UploadFile` parameter. Adapting it to accept either a file upload or a storage path would complicate its signature and its tests. A separate endpoint with a JSON body is cleaner and easier to test independently. The parsing logic is shared — the new endpoint calls the same `parse_upload` function from `spreadsheet_parser`.

**Response:** Same shape as `UploadPreviewResponse`. No new models needed.

**Error cases:**
- `404` — attachment_path not found in storage, or report not found / not owned.
- `422` — attachment_path is null on the report.
- `400` (ParseError) — file cannot be parsed (not a valid spreadsheet, corrupt file, etc.).
- `413` — file exceeds 10 MB limit (same check as existing upload endpoint).

### Frontend API Client

Add to `frontend/lib/api.ts`:

```typescript
export async function parseStoredAttachment(
  contractId: string,
  attachmentPath: string,
  periodStart: string,
  periodEnd: string,
  reportId: string
): Promise<UploadPreviewResponse>
```

---

## Frontend Changes

### New Query Param: `attachment_path`

The confirm endpoint in `email_intake.py` already builds the `redirect_url` for the wizard. Extend it to include `attachment_path` (URL-encoded) when the report has one:

```
/sales/upload?contract_id=...&report_id=...&source=inbox&period_start=...&period_end=...&attachment_path=inbound%2F...
```

The wizard page reads this param. When `source=inbox` and `attachment_path` is present, it skips Step 1 and auto-parses on mount.

### Wizard Page Changes (`frontend/app/(app)/sales/upload/page.tsx`)

1. Read `attachment_path` from search params alongside the existing inbox params.
2. When `isInboxSource && attachmentPath && periodStart && periodEnd`, set the initial step to `'map-columns'` instead of `'upload'` and fire `parseStoredAttachment(...)` immediately on mount (inside a `useEffect`).
3. While the parse request is in flight, show a full-page loading state ("Loading your report...") so the user does not see a blank column mapper.
4. On parse success, set `uploadPreview` exactly as `handleUploadSuccess` does today, then render the column mapping step.
5. On parse failure, render an error state with a fallback path (see Edge Cases section).

The `StepUpload` component itself is unchanged — it is simply not rendered for inbox-sourced reports with a stored attachment.

### Period Validation for the Inbox Path

The period-check call that Step 1 currently triggers on date change should still run, but it should happen in the background as part of the mount effect — not as a blocking gate. The approach:

- After `parseStoredAttachment` resolves, call `checkPeriodOverlap(contractId, periodStart, periodEnd)` in parallel (non-blocking, same 400 ms debounce removed since it is a one-shot call).
- If any warnings are present (overlap, out-of-range, frequency mismatch), surface them as a non-blocking amber banner above the column mapper. The user can dismiss and proceed.
- If `has_overlap` is true, the existing duplicate-period logic at the confirm step still acts as the safety net (409 with `duplicate_period` error code), so blocking the user upfront is not required.

This preserves the spirit of the warnings without adding a new blocking gate.

### Step Indicator

The visual step indicator shows steps 1, 2, and 3. For inbox-sourced uploads, Step 1 is bypassed. Two options:

**Option A (recommended for MVP):** Keep the three-step indicator as-is. Step 1 bubble shows as completed (checkmark) immediately when the wizard opens at Step 2. This matches the mental model — the period and file were "done" during inbox review.

**Option B:** Add a "Processing" loading state before the step indicator renders (hide the indicator while the parse request is in flight). Simpler but removes progress context.

Recommend Option A.

---

## Query Params Passed from Inbox to Wizard

Current params (already implemented):

| Param | Source |
|-------|--------|
| `contract_id` | `inbound_reports.contract_id` (resolved by confirm) |
| `report_id` | `inbound_reports.id` |
| `source` | Hardcoded `"inbox"` |
| `period_start` | `inbound_reports.suggested_period_start` |
| `period_end` | `inbound_reports.suggested_period_end` |

New param to add:

| Param | Source |
|-------|--------|
| `attachment_path` | `inbound_reports.attachment_path` (URL-encoded) |

The confirm endpoint in `email_intake.py` already builds `params` before calling `urlencode`. Add:
```python
if report_row.get("attachment_path"):
    params["attachment_path"] = report_row["attachment_path"]
```

---

## Edge Cases

### Period dates were not detected (`suggested_period_start` / `suggested_period_end` are null)

The inbox review page already shows the period fields only when both dates are present (`DetectedPeriodRow` returns null when either is missing). If `period_start` or `period_end` is absent from the query params:

- The wizard cannot call `parseStoredAttachment` because the period is required by the backend.
- Fall back to rendering Step 1 normally (the existing `isInboxSource` hint text already handles this case gracefully — it pre-fills dates from params when present).
- The file drag-and-drop zone remains for the user to upload manually.

This is the correct fallback: no dates detected means the user needs to supply them before the file can be parsed.

### The attachment cannot be parsed (ParseError)

The stored file could be corrupt, password-protected, or in an unsupported format. When `parseStoredAttachment` returns a 400:

- Show a full-page error state with a clear message: "We could not read this attachment. You can upload the file manually below."
- Render a simplified Step 1 below the error (period dates pre-filled if available, file zone available). This lets the user recover without navigating away.
- Do not redirect back to inbox — the report is already confirmed; the user just needs to provide the file.

### The attachment is missing from storage (404)

The `attachment_path` is set during webhook processing. If the file was deleted from storage or the path is stale:

- Treat as a parse failure. Same fallback as above.
- Log a warning so this can be investigated (should not happen in normal operation).

### The user opened the wizard URL directly (not via inbox confirm)

The `attachment_path` param could be absent even when `source=inbox`. The wizard already handles missing `period_start` / `period_end` gracefully. Apply the same defensive check: if `attachment_path` is missing, render Step 1 normally.

### The parse request takes a long time

The in-memory `_upload_store` TTL is 15 minutes and the parse should complete in under 3 seconds for typical files. Show a spinner with "Reading your report..." text during the in-flight request. No timeout is needed for MVP — network errors will surface as parse failures.

### The attachment is larger than 10 MB

The existing upload endpoint enforces a 10 MB limit via `_MAX_FILE_SIZE_BYTES`. The new `parse-stored` endpoint must enforce the same limit after downloading the file from storage. Return a 413 with the same user-facing message as the existing upload endpoint.

---

## Acceptance Criteria

**Happy path — dates detected, file parseable:**
1. User reviews an inbox report with a detected period and clicks "Confirm & Open Upload Wizard".
2. The confirm endpoint returns a `redirect_url` that includes `attachment_path`, `period_start`, `period_end`, `contract_id`, `report_id`, and `source=inbox`.
3. The wizard opens directly at Step 2 (column mapping). Step 1 is never rendered.
4. The step indicator shows Step 1 as completed and Step 2 as active.
5. The column mapper renders with columns and sample rows from the stored attachment.
6. The page subtitle reads "Processing emailed report from {contractName}." (existing copy, no change needed).
7. Any period validation warnings (overlap, out-of-range, frequency) appear as a dismissable amber banner above the column mapper.
8. The rest of the wizard flow (column mapping, optional category mapping, preview, confirm) is identical to the manual upload flow.
9. After the wizard completes, `PATCH /email-intake/{report_id}` links the new `sales_period_id` back to the inbound report (existing behavior, no change).

**Fallback — dates not detected:**
10. When `period_start` or `period_end` is absent from the query params, the wizard renders Step 1 with the file drag-and-drop zone and the "Detected from email attachment" hint text on the date fields.

**Fallback — file cannot be parsed:**
11. When `parseStoredAttachment` returns a 400, the wizard shows an error message and renders a recovery Step 1 with period dates pre-filled.

**Security:**
12. The `parse-stored` endpoint verifies the calling user owns both `contract_id` and the `report_id` whose `attachment_path` is being read. A user cannot parse another user's attachment by guessing a storage path.

**No regression:**
13. The existing manual upload flow (no `source=inbox` param) is unaffected.
14. Inbox reports without an `attachment_path` (e.g., plain-text emails) continue to use the existing Step 1 file upload path.

---

## Out of Scope

- Allowing the user to swap the attachment on the inbox path (replace the stored file with a different one). If needed, they can use the manual upload flow.
- Persisting the parsed upload across browser sessions (the in-memory `_upload_store` TTL of 15 minutes is sufficient).
- Showing a period date edit UI in the inbox wizard path. If the detected dates are wrong, the user should reject the report and submit a corrected one, or use the manual upload flow after confirming.
