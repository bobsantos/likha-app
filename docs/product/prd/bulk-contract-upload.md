# PRD: Bulk Contract Upload for Onboarding

**Status:** Draft
**Date:** 2026-02-25
**Author:** Product
**Designer:** Design
**Scope:** Onboarding experience for users migrating from spreadsheets with 10+ existing contracts

---

## Problem Statement

Likha's current upload flow is designed for one contract at a time. A user uploads a PDF, waits for AI extraction (~5–15 seconds), reviews the extracted fields on a full-page form, and confirms. For a licensor onboarding with a single new contract, this is fine. For a licensor migrating their existing portfolio — 10, 20, or 50 contracts — this flow is a serious adoption barrier.

The sequential one-at-a-time experience has several concrete problems at scale:

**Time cost is multiplicative.** If each contract takes 3 minutes end-to-end (upload, wait for extraction, review, confirm), 20 contracts takes 60 minutes of focused attention with no parallel progress. Users will abandon onboarding mid-way.

**No progress visibility.** There is no concept of a "queue" or batch. If the user closes the tab or gets interrupted, they have no way to know which contracts they have already completed.

**Interruption handling is per-contract.** The current draft resume flow (`sessionStorage` + `?draft=` param) works for a single in-progress contract. With bulk upload, there may be many simultaneously-interrupted drafts.

**Licensee email entry is friction-heavy one at a time.** The `licensee_email` field is optional but important — it enables auto-matching of inbound royalty report emails. In a bulk flow, requiring users to type this per-contract inside each review form is especially painful.

**Agreement number assignment is invisible.** Currently agreement numbers (`LKH-2025-1`) are assigned silently on confirm. In a bulk flow, users need to understand that all confirmed contracts will be assigned sequential numbers and that the order of confirmation determines sequencing.

### Who this affects

The target user is a brand owner or licensing manager who is switching to Likha from a manual spreadsheet workflow. They have an established portfolio — contracts signed months or years ago — that they need to migrate into the system before Likha becomes useful to them. A single 30-minute setup session is reasonable; a 5-hour data entry marathon is not. Without a viable onboarding path for existing portfolios, Likha is only useful to users starting from zero contracts.

---

## User Stories

**US-1 (Core).** As a licensor with 15 existing contracts, I want to upload all my PDFs at once so I can start the extraction process in parallel rather than waiting for each one to finish before uploading the next.

**US-2 (Review).** As a licensor with a batch of extracted contracts, I want to see all of them in a summary view so I can quickly identify which ones have missing required fields and need my attention, without wading through each form one by one.

**US-3 (Triage).** As a licensor reviewing a batch, I want to be able to approve contracts where the AI extraction looks correct with a single click, and only open the full edit form for contracts with low confidence or missing fields.

**US-4 (Licensee email).** As a licensor, I want to optionally provide a licensee email address for each contract during bulk review without requiring me to open each contract's full edit form individually.

**US-5 (Error recovery).** As a licensor, if one or two PDFs in my batch fail to extract correctly (e.g., scanned documents, password-protected files), I want to understand what went wrong and continue confirming the rest of my batch without losing progress.

**US-6 (Progress persistence).** As a licensor, if I close the browser tab and return the next day, I want to see my in-progress batch with its current state (which contracts are confirmed, which are still pending review) so I can pick up where I left off.

**US-7 (Agreement numbers).** As a licensor, I want to understand that confirming my bulk batch will assign sequential agreement numbers (LKH-2026-1, LKH-2026-2, etc.) and I want the option to control the order in which contracts are confirmed so that the numbering aligns with my internal references.

---

## Proposed Solution

### What "bulk upload" means

The recommended approach is **multi-file selection with parallel background extraction**, followed by a **triage-first review UI** rather than sequential full-form reviews. This is distinct from a CSV import approach (see Open Questions).

The flow has four phases:

1. **File selection** — User selects multiple PDFs at once (drag-and-drop or file picker, no hard upper limit but soft guidance for batches of 5–50).
2. **Background extraction** — All uploaded files are submitted to `/extract` in parallel (with a configurable concurrency limit to avoid hammering the AI API). A live queue view shows per-file status: queued, extracting, extracted, failed.
3. **Triage and review** — After extraction completes (or progressively as files finish), the user sees a summary table of all contracts in the batch. Rows with high AI confidence and all required fields present can be confirmed in bulk. Rows with low confidence, missing fields, or extraction failures require individual attention.
4. **Bulk confirm** — The user confirms the reviewable subset (or all at once), which triggers sequential `PUT /{id}/confirm` calls and assigns agreement numbers.

### Phase 1: File Selection

The upload dropzone accepts multiple files simultaneously. The user can select an arbitrary number of PDFs. Files are validated client-side for type (PDF) and size (10MB limit, matching current single-upload validation).

A pre-upload summary shows the file list with name and size. The user can remove individual files before starting. This prevents accidentally uploading a document set that includes non-contracts.

There is no batch size limit enforced in the UI, but the server imposes a per-user concurrent extraction limit (see Technical Considerations).

### Phase 2: Background Extraction Queue

The frontend submits files to the existing `POST /extract` endpoint. Since the current endpoint is synchronous (upload, extract, return), parallel requests achieve parallelism without a new queue endpoint. However, request concurrency should be capped at 3–5 simultaneous extractions to avoid API rate limit issues and to manage UI responsiveness.

Each file in the queue has a visible status:

- **Queued** — Waiting for an available extraction slot.
- **Uploading** — File is being sent to the server.
- **Extracting** — AI extraction is in progress.
- **Needs review** — Extraction succeeded; required fields present but user should verify.
- **Action required** — Extraction succeeded but one or more required fields are missing or confidence is low.
- **Failed** — Extraction failed (details shown inline: unreadable PDF, password-protected, network error, duplicate filename).
- **Confirmed** — User has reviewed and confirmed this contract.

A persistent progress indicator at the top of the page summarizes the batch: "12 of 15 contracts ready for review. 2 confirmed. 1 failed."

Draft rows are created in the database for each successfully extracted contract, exactly as in the current single-upload flow. This means the batch survives a browser close.

### Phase 3: Triage and Review

The review UI is a table, not a form. Each row represents one contract in the batch with the following columns:

| Column | Content |
|---|---|
| File name | The original PDF filename |
| Licensee name | AI-extracted, editable inline |
| Licensee email | Optional, editable inline (blank by default) |
| Contract dates | Start and end date, inline edit |
| Royalty rate | Summarized (e.g., "8%", "6-10% Tiered"), click to expand |
| AI confidence | High / Medium / Low badge |
| Status | Needs review / Action required / Failed / Confirmed |
| Action | "Review" button (opens full form in a slide-over panel) or "Confirm" button for high-confidence rows |

**Inline editing** for licensee name, licensee email, and contract dates allows users to fix simple issues without opening the full form. Changes are persisted to the draft row immediately via a debounced PATCH (or when the field loses focus).

**The slide-over panel** shows the full `ContractForm` for contracts that need detailed attention. This reuses the existing `ContractForm` component (`frontend/components/contract-form.tsx`) without modification. The panel can be navigated forward/backward through the batch ("Next contract needing review").

**Bulk confirm** is a button that confirms all rows that are currently in "Needs review" status (not "Action required", not "Failed"). It runs `PUT /{id}/confirm` sequentially to preserve predictable agreement number sequencing. A progress indicator tracks confirmation progress.

**Ordering for agreement numbers.** Before initiating bulk confirm, the user can drag-and-drop rows to reorder them. The order determines agreement number assignment (top row = lowest number). This is optional — if the user does not reorder, the default order is the order in which files were selected/uploaded. A tooltip explains this behavior.

### Phase 4: Post-confirm State

After bulk confirm completes:

- A summary screen lists all confirmed contracts with their assigned agreement numbers.
- A "Copy all agreement numbers" action produces a formatted list the user can paste into an email to their licensees.
- Failed extractions remain in the table with a clear path to retry or to upload a replacement file.
- Draft contracts that were not confirmed (the user chose to skip them) persist in Likha's standard draft state and appear in the contracts list with a "Draft" badge.

---

## Technical Considerations

### Parallel extraction and rate limiting

The current `POST /extract` endpoint is synchronous and handles one file per request. For bulk upload, the frontend initiates multiple parallel requests. The backend does not need a new queue endpoint for an MVP — the existing endpoint works. However:

- **AI API rate limits.** Claude API has per-minute token limits. A burst of 20 simultaneous extraction requests may hit limits. The frontend concurrency cap (3–5 parallel) is the primary mitigation. The backend should also add retry-with-backoff on 429 responses from the Claude API.
- **Supabase Storage throughput.** Each extraction uploads a PDF to storage before calling Claude. Parallel uploads should be within Supabase's limits for typical contract file sizes (1–5MB each), but worth load testing at 10+ simultaneous uploads.
- **Extraction latency variance.** Some PDFs extract in 5 seconds; complex multi-page contracts may take 20–30 seconds. The queue UI must handle this variability — rows complete out of order.

### Sequential agreement number assignment in bulk confirm

The current confirm endpoint generates agreement numbers using this logic in `backend/app/routers/contracts.py` (lines 258–280):

```python
existing_ref = (
    supabase_admin.table("contracts")
    .select("agreement_number")
    .eq("user_id", user_id)
    .like("agreement_number", year_prefix)
    .order("created_at", desc=True)
    .limit(1)
    .execute()
)
next_seq = 1
if existing_ref.data:
    last_num = existing_ref.data[0].get("agreement_number", "")
    try:
        last_seq = int(last_num.rsplit("-", 1)[-1])
        next_seq = last_seq + 1
    except (ValueError, IndexError):
        next_seq = 1
agreement_number = f"LKH-{current_year}-{next_seq}"
```

This approach queries for the most recent agreement number by `created_at`. If bulk confirm fires multiple `PUT /{id}/confirm` calls in rapid parallel, there is a race condition: two requests may both query and find the same "last" agreement number and generate duplicates (e.g., both assign `LKH-2026-3`).

**Mitigation options (in order of preference):**

1. **Sequential client-side confirm calls.** The frontend sends confirm requests one at a time (awaiting each before the next). This is the simplest fix and imposes no backend changes. The tradeoff is that confirming 20 contracts takes 20 sequential round trips. At ~500ms per confirm, that is ~10 seconds — acceptable for an onboarding flow.

2. **Database-level sequence.** Add a PostgreSQL sequence (`CREATE SEQUENCE agreement_number_seq START 1`) per user, or a composite approach with a `user_agreement_sequences` table. This is the robust solution but requires a migration and changes to the confirm endpoint.

3. **Optimistic locking / row-level lock.** Use `SELECT ... FOR UPDATE` on a counter row before assigning. Supabase supports this via raw SQL but not through the supabase-py query builder directly; would require an RPC function.

For MVP, option 1 (sequential client-side) is recommended. It is safe and correct with no backend changes. Add a comment in the code documenting the race condition so option 2 can be implemented if performance becomes an issue.

### Inline field persistence during triage

When a user edits a field inline in the triage table (e.g., fixes the licensee name), that change needs to be persisted to the draft row so it survives a page refresh. Options:

- **PATCH the draft row immediately on blur.** Requires a new `PATCH /{id}/draft-fields` endpoint (or repurposing the existing GET/PUT flow). Simple but adds API surface.
- **Hold changes in local state, persist only on confirm.** Simpler implementation — the user's changes are in React state and committed when they hit "Confirm" (which calls the existing `PUT /{id}/confirm` with the updated values). Downside: if the page is refreshed before confirming, inline edits are lost. The full form data is re-fetched from the extracted_terms stored in the draft row.
- **sessionStorage keyed by draft ID.** Persist inline edits to sessionStorage per contract ID, similar to the current single-upload draft persistence. Restores on refresh without a new API endpoint.

Recommendation for MVP: sessionStorage per contract ID for inline edits, with a visible "unsaved changes" indicator per row. This matches the existing draft persistence pattern already in the codebase.

### Duplicate filename detection in bulk batches

The existing `/extract` endpoint returns `409 DUPLICATE_FILENAME` or `409 INCOMPLETE_DRAFT` when a file conflicts with an existing contract. In a bulk upload, this needs to be surfaced per-row rather than as a page-level error.

When a file in the batch gets a 409 response, its row status becomes "Failed" with a specific error label: "File already uploaded" (DUPLICATE_FILENAME) or "Resume previous upload" (INCOMPLETE_DRAFT). For the INCOMPLETE_DRAFT case, the existing draft contract ID is returned in the 409 payload; the bulk UI can offer a "Resume" action that loads that draft into the triage table rather than discarding it.

### Extraction failure handling

A failed extraction (network error, unreadable PDF, password-protected document) sets the row to "Failed" status. The user can:

- **Retry** with the same file (re-runs extraction).
- **Replace file** by selecting a different PDF.
- **Skip** and leave the contract as a standard draft for later.
- **Remove** to exclude the file from the batch entirely.

Failures in individual rows must not block confirmation of the rest of the batch.

### `mg_field` — minimum_guarantee_period default

The `ContractConfirm` model in `backend/app/models/contract.py` (line 131) defaults `minimum_guarantee_period` to `annually`. The current single-upload form does not expose this field. In bulk triage where users are doing quick confirmations, this default is silently applied. This is acceptable for MVP but should be called out in the UI: "Minimum guarantee period defaults to annually. Open the full form to change."

### No new backend endpoints required for MVP

The MVP bulk upload flow can be implemented using only the existing API endpoints:
- `POST /extract` — called once per file (parallel, client-side concurrency cap)
- `GET /{id}` — for loading draft state when resuming
- `PUT /{id}/confirm` — called sequentially for each contract being confirmed

No backend changes are strictly required to ship a functional bulk upload experience. The trade-off is sequential confirms and sessionStorage-only inline edit persistence. These limitations are acceptable for the onboarding use case.

---

## Edge Cases

**Empty or near-empty PDFs.** A one-page PDF that is actually a cover letter or attachment (not a contract) will extract with low confidence and likely missing required fields. The triage UI's "Action required" status should surface these. The AI extraction notes field (`extraction_notes` in `ExtractedTerms`) can be displayed in the triage row to help the user understand why confidence is low.

**All contracts fail extraction.** If the user uploads 15 PDFs and all 15 fail (e.g., they selected the wrong folder and uploaded scanned images), the batch should show a clear empty state with a "Try different files" action, not a broken-looking queue of 15 red rows.

**Zero successfully extracted contracts.** The "Confirm all" button should be disabled (and visually distinct) if no contracts are in a confirmable state.

**Duplicate files within the same batch.** If the user drags the same file twice into the dropzone before upload starts, the client should deduplicate by filename before submission to avoid two identical PDFs being sent. Deduplication should compare by filename and size. Show a warning: "Duplicate file removed: [filename]."

**Partial batch confirmation.** The user confirms 10 of 15 contracts in the batch and then closes the browser. On return, the 10 confirmed contracts are active in the contracts list. The 5 unconfirmed contracts are in draft state. The user has no automatic way to re-enter the bulk triage view for the remaining 5. Options: (a) persist batch session state (list of draft IDs) in the user's account, or (b) accept that the remaining drafts are managed through the standard "resume draft" flow on the individual upload page. For MVP, option (b) is acceptable with a clear message at the top of the contracts list: "You have N unfinished drafts."

**Very large batches (50+ contracts).** The triage table with 50+ rows can be rendered, but the full portfolio import should be tested for browser performance (memory, re-render cost). Virtualized table rendering (e.g., react-window or Tanstack Virtual) may be needed. This is unlikely to matter for the initial target user (1–5 active licensees, onboarding a historical backlog of 10–30 contracts) but should be noted for future planning.

**Agreement number year boundary.** If a user starts a bulk confirm on December 31 and finishes on January 1, some contracts will be `LKH-2025-N` and some will be `LKH-2026-1`. This is correct behavior — the year in the agreement number reflects when confirm was called. It could surprise users. Mitigate by showing a preview of the agreement number format ("Contracts confirmed today will be assigned LKH-2026-N") before the user initiates bulk confirm.

**Scanned PDFs and image-based contracts.** `pdfplumber` (the current PDF parser) cannot extract text from scanned/image PDFs. These will always fail extraction. The error message in the triage row should specifically say "This PDF appears to be a scanned document. Text could not be extracted." rather than a generic error. A future enhancement would be OCR integration. For now, the user's only option is to type the contract terms manually — which means the current single-upload flow with a blank form is the right path for these files, not bulk upload.

**Tiered and category-specific royalty rates.** The inline editing in the triage table cannot reasonably handle the full `RoyaltyRateInput` component (which has a complex mode-switching UI for flat/tiered/category rates). The inline triage view should show a read-only summary of the royalty rate and require the user to open the full slide-over form to edit complex rates. "Open to edit" should be prominently surfaced for any contract where the royalty rate is tiered or category-based.

**Licensee email format validation.** The inline email field in the triage table must validate email format on blur. An invalid email should show an inline error without blocking confirmation of other rows.

**Network interruption during bulk extraction.** If the user loses network connectivity mid-batch, in-flight extraction requests will fail. Retry logic for extraction failures should distinguish between "PDF could not be parsed" (permanent) and "network error" (transient, auto-retry with backoff).

---

## Open Questions

**Q1: Should bulk upload be a separate page or an enhancement of the existing upload page?**

The current upload page (`frontend/app/(app)/contracts/upload/page.tsx`) is a single-contract flow with distinct step state (`upload`, `extracting`, `review`, `saving`). Bulk upload has fundamentally different state (a queue of files, each at different stages). Attempting to shoehorn bulk into the existing page risks making both flows worse. Recommendation: build bulk upload as a new page at `/contracts/upload/bulk` with a link from the existing upload page and from the onboarding prompt. The single-file upload page remains unchanged.

**Q2: Should we explore a CSV import path as an alternative to PDF-based bulk upload?**

A CSV import would allow users to paste structured data (licensee name, royalty rate, dates, etc.) into a spreadsheet template and upload it, bypassing AI extraction entirely. This is faster and more reliable than PDF extraction for users who have their contract terms in an existing spreadsheet. However, it requires: (a) a CSV parsing endpoint, (b) a template the user can download and fill in, (c) validation of CSV column mapping.

This is a meaningful alternative, particularly for the target user who is "currently using spreadsheets" (per the product brief). A CSV import would let them copy-paste from their existing tracker directly.

Recommendation: Validate with 3–5 target users whether they have contracts in structured form (spreadsheet) or only as PDFs. If the majority have PDFs, build PDF bulk upload first. If many have structured data, the CSV path may be higher ROI and lower technical risk. Do not build both without validation.

**Q3: Should inline edits during triage be saved to the draft row in real time (requiring a PATCH endpoint) or only saved on confirm?**

The concern with "only on confirm" is that a page refresh between inline edit and confirm loses the user's changes. The concern with real-time PATCH is API complexity. There is a middle path: queue inline edits in memory and flush them to the server when the user explicitly saves the batch (a "Save progress" button in the batch header, separate from "Confirm"). This is discoverable and does not require a new endpoint — it can POST the changes as part of the confirm call.

**Q4: What is the right concurrency limit for parallel AI extractions?**

3–5 parallel extractions is a starting point but should be tested against the Anthropic API's actual rate limits for the account tier. If the Likha account is on the default tier, sustained burst traffic from a 20-file batch could hit rate limits. The frontend concurrency cap is the right place to control this, and it should be configurable via an environment variable rather than hardcoded.

**Q5: Should agreement number ordering be user-controllable, or always assigned by upload order?**

Allowing users to drag-and-drop rows to control agreement number sequencing adds complexity (drag-and-drop library, reorder state, clear UI affordance). The practical value is low: most licensors do not have strong opinions about which licensee gets agreement number 1 vs. 3. Recommendation: default to upload order and document that behavior clearly. Defer drag-and-drop ordering unless users specifically request it.

**Q6: Is there a meaningful validation we can run before the user confirms the full batch?**

At a minimum: flag any contract where `contract_end_date` is before `contract_start_date`, where `royalty_rate` is zero or missing, or where `licensee_name` is blank. These are already required-field validations in the current single-upload flow. For batch confirm, run these checks on all selected-for-confirm rows before any confirm calls are sent, and surface a summary of blocked rows. This prevents a partial confirm where some succeed and some fail.

**Q7: How does this interact with the email intake matching feature?**

The `licensee_email` field is used to auto-match inbound royalty report emails to contracts. In bulk upload, the triage UI should make clear that filling in `licensee_email` now (before confirming) is how the user enables automatic email matching going forward. A tooltip or info callout on the email column in the triage table should explain this: "Add the email address your licensee uses to send reports. Likha will automatically route their reports to this contract."

**Q8: Should we build a batch-level progress persistence model (saving the list of in-progress draft IDs to the user's account) or accept that interrupted bulk sessions are recovered through the existing individual draft resume flow?**

Building batch session persistence (e.g., a `bulk_sessions` table with a list of draft IDs and their per-row review state) is the robust solution but adds meaningful backend complexity. The pragmatic MVP alternative is to surface a prominent "You have N unfinished drafts" callout on the contracts list page and let users re-enter the triage flow for individual contracts through the existing upload page's draft resume feature. Validate whether users are bothered by losing batch context before investing in batch session storage.

---

## Out of Scope for MVP

- CSV import / structured data import (validated separately per Q2)
- Drag-and-drop reordering for agreement number control (deferred per Q5)
- Batch session persistence in the database (deferred per Q8)
- OCR for scanned PDF contracts
- Bulk editing of confirmed (active) contracts
- Agreement number customization or manual override
- Notifications (email or in-app) when background extraction completes after a tab close

---

## Designer Notes

> The following sections were added by Design to enrich the product spec with UX patterns, visual direction, interaction details, and accessibility considerations. They are intended to be read alongside the product sections above, not as a replacement.

---

### Entry Point and Flow Continuity

The existing single-upload page at `/contracts/upload` uses a card-based layout with a full-page dropzone and step progression (`upload → extracting → review → saving`). The bulk upload page at `/contracts/upload/bulk` should feel like an intentional extension of that same system — not a separate product.

**Entry point placement.** The existing upload page should add a secondary link below the dropzone: "Uploading multiple contracts? Use bulk upload." This keeps the single-file path clean for its primary audience (adding a new contract) while making the bulk path discoverable for the onboarding scenario. Avoid surfacing the bulk path in the primary navigation — it is a situational tool, not a routine one.

**URL structure.** `/contracts/upload/bulk` is the right path. It stays under the `/contracts/upload` namespace and implies a variant of the same action. Avoid `/contracts/bulk` (too ambiguous) or `/onboarding/upload` (assumes a specific user state).

**Back navigation.** The bulk upload page should show the same `← Back to Contracts` link the single-upload page uses. When a user has a batch in progress, the link should prompt confirmation ("You have an active batch. Leaving will keep your drafts but you will lose queue progress. Continue?") rather than navigating silently.

---

### Phase 1: File Selection — Interaction Design

**Dropzone behavior for multiple files.** The existing dropzone accepts a single file. The bulk dropzone should accept multiple files in a single drag gesture and show a count indicator while files are held over the zone: "Drop 6 files" (updating in real time as the drag payload is counted). The border color and icon should follow the existing drag-active state — `border-primary-500 bg-primary-50` with the `Upload` icon.

**File list staging area.** After files are selected but before extraction starts, show a staging list beneath the dropzone. Each row shows the filename, size, and a remove button (the existing `X` / trash icon from Lucide). This gives users a chance to trim accidentally-added files without committing to extraction. The list should use the same card pattern as the rest of the app: `bg-white rounded-lg border border-gray-200` with `divide-y divide-gray-100` rows.

**Duplicate detection visual.** If the client detects the same filename selected twice, mark the duplicate row immediately with an amber warning badge ("Duplicate") rather than waiting for the server 409. This is a purely client-side pre-check on filename and size.

**Start extraction CTA.** A single "Start Extraction" primary button sits below the file list. It shows the file count: "Extract 8 Contracts." Disabled when the list is empty. On click, the staging area collapses and the queue view expands with an animation.

**Mobile consideration.** On small screens, the file picker should accept multiple files (`<input type="file" multiple accept=".pdf">`). The staging list becomes a vertical stack of cards — the same layout as the desktop table but without the horizontal columns, since narrow screens cannot fit a multi-column table. Each card shows: filename (truncated with ellipsis if needed), size, status badge, and the remove button. The "Start Extraction" button should be sticky at the bottom of the viewport on mobile to stay reachable as the list grows.

---

### Phase 2: Extraction Queue — Progress Design

**Persistent batch header.** A fixed summary bar at the top of the queue view (below the app navigation) tracks the batch as a whole. It should not scroll away. The layout:

```
[Progress ring 12/15]   12 of 15 contracts processed   [2 confirmed] [1 failed]   [Confirm ready (9)]
```

The `[Confirm ready (N)]` button is the primary CTA throughout this phase — it confirms all rows in "Needs review" status. It should use `btn-primary` and update its count as rows complete extraction. Disable it (with `opacity-50 cursor-not-allowed`) when N is zero.

**Per-file status badges.** Use the existing badge system (`rounded-full text-xs font-medium`) with semantic colors. Suggested mapping:

| Status | Badge | Tailwind classes |
|---|---|---|
| Queued | Queued | `bg-gray-100 text-gray-600` |
| Uploading | Uploading | `bg-blue-50 text-blue-600` with `animate-pulse` |
| Extracting | Extracting | `bg-blue-100 text-blue-700` with spinner icon |
| Needs review | Ready | `bg-green-100 text-green-700` |
| Action required | Needs attention | `bg-amber-100 text-amber-700` |
| Failed | Failed | `bg-red-100 text-red-700` |
| Confirmed | Confirmed | `bg-green-100 text-green-800` with checkmark icon |

**Extraction animation.** Each row transitions through status badges sequentially. Use CSS `transition-colors duration-300` on the badge so the status shift is smooth rather than jarring. The spinner for "Extracting" should be the same `animate-spin` used on the existing extraction loading screen — visual consistency builds trust that the same underlying process is running.

**Out-of-order completion.** Rows complete extraction in whatever order the API responds. The queue table should hold its initial sort order (the order files were selected) and update badges in place — rows should not jump around as they complete. This prevents the disorienting effect where a user reads a row and it moves.

**All-failed empty state.** If every file in the batch fails extraction, replace the queue table with a centered empty state: a large `AlertCircle` icon in red, "None of your files could be processed," a secondary message ("Your files may be scanned documents or password-protected. See individual errors below for details."), and a "Try different files" button that resets to the file selection phase. Do not leave the user staring at a screen full of red "Failed" badges with no clear path forward.

**Mobile queue layout.** The multi-column table format does not work on mobile. On small screens, each queue item becomes an expandable card: collapsed state shows filename + status badge; tapped state expands to show AI confidence, editable fields, and actions. Use a `details`/`summary` pattern or a controlled accordion.

---

### Phase 3: Triage Table — Visual Design and Interaction

**Table versus cards decision.** The PRD recommends a table. This is correct for the primary desktop use case. A table allows fast visual scanning across many rows — users can compare royalty rates and dates across contracts in a glance. Cards would be appropriate only on mobile (see above). Do not use cards on desktop even for small batches — the switch in layout depending on batch size would be confusing.

**Column widths and priorities.** On a standard 1280px viewport, the triage table columns should be allocated approximately:

| Column | Width | Notes |
|---|---|---|
| File name | 22% | Truncate with ellipsis at the right; show full name in a tooltip (`title` attribute) |
| Licensee name | 18% | Inline editable text input |
| Licensee email | 18% | Inline editable email input |
| Contract dates | 16% | Two date inputs side-by-side, or a compact range display |
| Royalty rate | 10% | Read-only summary; "Open to edit" link for complex rates |
| AI confidence | 7% | Badge only |
| Status | 9% | Badge |
| Action | — | "Review" or "Confirm" button; right-aligned |

**Inline editing pattern.** Inline-editable cells should look like read-only text at rest and reveal an input on click/focus. Use a subtle style shift: `border border-transparent hover:border-gray-300 rounded px-2 py-1` at rest, `border border-primary-400 ring-1 ring-primary-300 rounded px-2 py-1` when focused. This keeps the table visually clean while making editability apparent on interaction. Do not show full `<input>` boxes in every row by default — the visual density would be overwhelming for a 15-row table.

**Unsaved changes indicator.** When a row has inline edits that have not yet been persisted (using the sessionStorage strategy from the PRD), show a subtle dot indicator next to the row's file name: a `w-1.5 h-1.5 bg-amber-400 rounded-full` inline with the filename. A batch-level unsaved-changes warning in the header ("You have unsaved changes in 3 contracts. They will be saved on confirm.") prevents data loss anxiety.

**AI confidence badges.** Three levels map to visual weight:

| Confidence | Badge | Implication |
|---|---|---|
| High | `bg-green-100 text-green-700` "High" | "Confirm" button shown; user can approve without opening form |
| Medium | `bg-amber-100 text-amber-700` "Medium" | "Review" button shown; recommend opening the form |
| Low | `bg-red-100 text-red-700` "Low" | "Review" button shown; form open is strongly implied |

**Extraction notes as tooltip.** The `extraction_notes` array from `ExtractedTerms` should surface as a tooltip on the AI confidence badge — a small `Info` icon next to the badge that reveals notes on hover: "Could not determine royalty base. Defaulted to Net Sales." This gives expert users fast context without cluttering the table for everyone else.

**"Action required" visual weight.** Rows with status "Action required" (missing required fields or low confidence) should have a subtle left border accent: `border-l-2 border-l-amber-400`. This is the same visual pattern the contract detail page uses for discrepancy rows in the sales periods table — maintaining cross-page consistency. "Failed" rows use `border-l-2 border-l-red-400` for the same reason.

**Row hover state.** `hover:bg-gray-50` on each row, matching the sales periods table on the contract detail page. This confirms to the user that rows are interactive.

**Royalty rate — complex rate handling.** For tiered or category-based royalty rates, the triage table cell shows the same compact summary format already used on the contract detail page (e.g., "6–10% Tiered", "8–12% Per Category"). The cell also shows a linked "Edit" label that opens the slide-over form focused on the royalty rate field. Do not attempt to inline-edit complex rates — the `RoyaltyRateInput` component is too complex to embed in a table cell.

**Column header sort order.** The table does not need complex sorting for MVP. However, the status column header should support one useful sort: clicking it groups "Action required" rows to the top, then "Needs review," then "Confirmed," then "Failed." This surfaces the rows that need attention without requiring the user to scroll. A small sort indicator (`ChevronUp/ChevronDown` from Lucide) on the status column header signals this capability.

**Minimum guarantee period notice.** The PRD notes that `minimum_guarantee_period` defaults silently to `annually`. Add a dismissible informational callout below the triage table header (not within each row — once is enough): "Minimum guarantee period defaults to annually for all contracts. Open the full form to change it for individual contracts." Use a `bg-blue-50 border border-blue-200 rounded-lg` banner with an `Info` icon and a close button. Persist the dismissal in `sessionStorage` so it does not reappear after the user has read it.

**"Confirm all ready" button behavior.** Before firing the confirm sequence, show a modal confirmation dialog (not an inline confirmation — this is a consequential action). The modal should:

- List the count of contracts about to be confirmed: "You are about to confirm 11 contracts."
- Show a preview of the agreement number range: "They will be assigned agreement numbers LKH-2026-1 through LKH-2026-11."
- Note any contracts that will be skipped: "2 contracts with required fields missing will not be confirmed."
- Offer "Cancel" and "Confirm 11 contracts" as the two actions.

The confirmation dialog prevents accidental bulk confirms during the triage review phase.

---

### Phase 3: Slide-Over Panel — Design Details

**Panel anatomy.** The slide-over should enter from the right edge (`translate-x-full` → `translate-x-0` transition, 200ms ease-out). Width: `w-full` on mobile, `max-w-xl` on `sm:` and above. It overlays the triage table with a semi-transparent backdrop (`bg-black/40`) that can be clicked to close. A close button (`X` icon, top-right of the panel) provides an obvious exit path.

**Panel header.** Shows the filename and current status badge. A progress indicator shows the user's position within the batch of contracts needing attention: "Contract 3 of 5 needing review." Previous / Next navigation buttons (`ChevronLeft / ChevronRight`) allow moving through the review queue without closing and reopening the panel.

**Reusing `ContractForm`.** The `ContractForm` component (`frontend/components/contract-form.tsx`) should be used directly inside the slide-over without modification. Its `onCancel` handler should close the panel. Its `onSubmit` handler should update the triage table row status to "Needs review" (if all required fields are now present) and optionally advance to the next contract needing review. The component already has proper `data-testid` attributes and `aria` roles, which carry over without changes.

**Focus management.** When the slide-over opens, keyboard focus must move to the panel (the close button or the first form input). When it closes, focus must return to the "Review" button that opened it. This is critical for keyboard navigation and screen reader users. Use `useRef` and `focus()` imperatively, or a headless UI dialog component that handles this automatically.

**Mobile.** On small screens, the slide-over should take the full screen (`inset-0`) with a fixed header showing the close button and navigation. The `ContractForm` scrolls within the panel. The bottom action bar ("Confirm and Save" / "Cancel") should be sticky at the bottom of the viewport.

---

### Phase 4: Post-Confirm — Summary Screen Design

**Success state design.** After bulk confirm completes, replace the triage table with a success summary. This is a high-effort moment for the user — they have just finished onboarding their portfolio. The success state should feel meaningful, not perfunctory.

Layout: a centered green `CheckCircle2` icon (existing pattern from the contract confirm flow), a headline ("Your contracts are active"), a subhead with the count ("11 contracts confirmed. 2 still need attention."), and a stat row showing the assigned agreement number range.

**The confirmed contracts list.** Below the success header, show a clean list of confirmed contracts with two columns: licensee name and agreement number. Each row links to the contract detail page. The list should be scannable — no card chrome, just a clean `divide-y divide-gray-100` list inside a `bg-white rounded-lg border border-gray-200` container.

**"Copy all agreement numbers" action.** This action should produce a plain-text list formatted for pasting into an email:

```
Sunrise Apparel — LKH-2026-1
Metro Goods Ltd — LKH-2026-2
Coast Trading Co — LKH-2026-3
```

The button uses the same copy-to-clipboard pattern already implemented on the contract detail page (`Copy` icon → `CheckCircle2` icon with "Copied!" text after a 2-second delay). Position the button above the confirmed contracts list, right-aligned.

**Unconfirmed contracts path.** If any contracts were not confirmed (action required or failed), they should be listed below the success section in a separate "Still needs attention" block using the `bg-amber-50 border border-amber-200 rounded-lg` pattern. Each item links directly to the individual contract's upload resume page (`/contracts/upload?draft=[id]`) — not back into the bulk triage view, which has served its purpose. This is the clean handoff back to the standard single-upload flow.

**Navigation after confirm.** The page should offer two actions: "Go to Contracts" (primary, links to `/contracts`) and "Upload More Contracts" (secondary, links to `/contracts/upload`). Do not auto-redirect — the user may need to copy agreement numbers before leaving.

---

### Error States — How Failures Should Feel

**Principle: errors are informative, not alarming.** Likha is a financial tool; users trust it with important data. Error messages should explain what happened and what to do next, in plain language. They should not use words like "catastrophic," "fatal," or "critical." An extraction failure is expected and manageable — the error message should reflect that.

**Extraction failure — specific messaging over generic.** The current single-upload page already implements differentiated error messages based on error type (see `classifyError` in `upload/page.tsx`). The bulk upload page should apply the same principle per-row. The "Failed" status row should show a brief error reason beneath the filename:

- `"PDF appears to be scanned — text could not be extracted."` (pdfplumber failure)
- `"File already uploaded."` with a link to the existing contract (409 DUPLICATE_FILENAME)
- `"You have an unfinished upload for this file."` with a "Resume" link (409 INCOMPLETE_DRAFT)
- `"Network error — tap to retry."` (transient failure)
- `"File is password-protected."` (specific parsing failure)
- `"Upload failed — try again."` (generic fallback, only when cause is unknown)

**Error density management.** If 10 of 15 files fail, showing 10 red "Failed" rows simultaneously would feel overwhelming. Apply progressive disclosure: after 4 or more failures, collapse the failed rows into a summary: "4 files failed. Show details." A chevron expands the section. This keeps the successful rows in focus and reduces the feeling that the whole operation has gone wrong.

**Network interruption during extraction.** If the browser loses connectivity mid-batch, in-flight extraction requests will fail with network errors. Show a single banner at the top of the queue (not per-row): "Network connection lost. In-flight extractions have been paused. Reconnect to retry." When connectivity resumes, offer a "Retry failed extractions" button that re-queues the failed rows. Do not auto-retry silently — give the user visibility and control.

**Save failure during bulk confirm.** If a `PUT /{id}/confirm` call fails during the sequential confirm sequence, stop the sequence and show an inline error in the batch progress bar: "Stopped at contract 7 of 11 — confirm failed for Metro Goods Ltd. Fix the issue and resume." Provide a "Resume confirming" button that continues from the failed contract. Do not restart from contract 1. This is especially important because the contracts already confirmed have been assigned agreement numbers — resuming correctly preserves the sequence.

**Validation failures before confirm.** The pre-confirm validation scan (per Q6) should surface a summary modal before any confirms are sent. Design: a `bg-amber-50` modal with a title "Some contracts need attention before confirming," a list of the blocked rows with their specific issue ("Metro Goods Ltd — missing royalty rate"), and two actions: "Go back and fix" (closes modal, highlights the problem rows in the table with a pulsing `ring-2 ring-amber-400`) and "Confirm the others anyway" (proceeds with the confirmable rows, skipping the blocked ones).

---

### Accessibility Considerations

**Keyboard navigation through the triage table.** The triage table should be navigable entirely by keyboard. Users who prefer keyboard navigation or use screen readers should be able to:

- Tab through each row's interactive elements (inline inputs, action buttons) in a logical order.
- Use Enter/Space to open the slide-over panel for a specific row.
- Navigate between the Previous/Next contracts inside the slide-over panel without returning to the table.
- Use Escape to close the slide-over and return focus to the triggering "Review" button.

**Screen reader announcements for live queue updates.** As files complete extraction and row statuses change, screen reader users need to be informed. Use an `aria-live="polite"` region (a visually-hidden `div` that receives status text updates) to announce significant events without interrupting ongoing reading: "Sunrise Apparel contract — extraction complete, needs review." "Metro Goods Ltd — extraction failed." Announce the batch summary update each time any row changes state.

**Bulk confirm progress announcements.** During the sequential confirm sequence, update the `aria-live` region after each contract confirms: "Confirmed Sunrise Apparel — LKH-2026-1. 10 remaining." This keeps keyboard users informed without requiring them to find and read the progress indicator visually.

**Color is never the only signal.** The triage table uses left border colors (amber for action required, red for failed) to signal row status. Always pair color with text (the status badge). The `DiscrepancyCell` pattern on the contract detail page is the right model — it combines icon, badge text, and color rather than using color alone.

**Focus ring visibility.** All interactive elements must show a visible focus ring. The existing app uses `focus:ring-2 focus:ring-primary-500` throughout. Inline-editable cells in the triage table must expose the same focus ring when focused. Do not suppress the default outline on table cells.

**Batch action confirmation dialog — accessible.** The modal confirmation dialog before bulk confirm must be implemented as a proper modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the dialog title, and focus trapped inside the dialog while open. The `Escape` key should close it without confirming.

**Drag-and-drop alternative.** Although drag-and-drop ordering is out of scope for MVP, if it is added in a future iteration, always provide a keyboard-accessible alternative (e.g., move-up / move-down buttons) for users who cannot use drag-and-drop.

**Loading skeletons.** Use `animate-pulse` skeletons (the same pattern as the contract detail page loading state) for the batch header and any table rows that have not yet loaded their extracted data. Do not use spinner-only loading states for large content areas — skeletons are less disorienting and give users a sense of the shape of content to come.

---

### Mobile Responsiveness

**Phase 1 (file selection) on mobile.** The dropzone should scale gracefully. On small screens, hide the "drag and drop" instruction and show only "Tap to browse files." The `<input multiple>` attribute enables the native file picker on iOS and Android, which allows multi-select from the photo library or Files app. Test on both platforms — iOS Safari and Android Chrome handle `multiple` file inputs differently.

**Phase 2 (queue) on mobile.** Replace the table with a card list. Each card: `bg-white rounded-lg border border-gray-200 p-4 mb-3`. Within the card: filename (bold, truncated), status badge (top-right), and a row of quick actions at the bottom. The persistent batch header should be sticky at the top of the page, but keep it compact on mobile: show only the progress fraction and the confirm button, omitting the text summary.

**Phase 3 (triage) on mobile.** The triage table cannot render meaningfully on a 375px screen with 8 columns. Use the same card-per-contract layout as Phase 2. Each card shows: filename, licensee name (editable inline on tap), status badge, and an "Open to review" button. Complex fields (royalty rate, dates, email) are handled inside the slide-over only. This is an intentional information prioritization — mobile is not the right context for bulk data entry, so the mobile layout focuses on triage and delegates detail work to the full-screen slide-over.

**Phase 4 (post-confirm) on mobile.** The summary screen works well as a single-column layout on mobile. The confirmed contracts list is naturally vertical. The "Copy all" button should be full-width on mobile for tap target size (minimum 44px height).

**Viewport height and sticky elements.** On mobile browsers with a dynamic address bar (iOS Safari), `100vh` is unreliable. Use `100dvh` (dynamic viewport height) for the slide-over panel height calculation to prevent the panel from being clipped by the browser chrome.

---

### Consistency with the Existing Single-Upload Flow

**The most important design constraint is that the bulk flow should not feel like a different product.**

Specific consistency points to enforce during implementation:

- **Card pattern.** Use `bg-white rounded-lg border border-gray-200 shadow-sm` for all containing surfaces, matching the existing `card` class.
- **Button styles.** `btn-primary` and `btn-secondary` only. No custom button styles.
- **Back link.** `inline-flex items-center gap-2 text-gray-600 hover:text-gray-900` with an `ArrowLeft` icon, identical to the existing upload page.
- **Error banners.** `bg-red-50 border border-red-200 rounded-lg` with `AlertCircle` icon, identical to `ContractForm`'s inline error display.
- **Success callout.** `bg-green-50 border border-green-200 rounded-lg` with `CheckCircle2` icon, identical to the post-confirm callout on the contract detail page.
- **Draft resume banner.** `bg-blue-50 border border-blue-200 rounded-lg` with `FileText` icon — the same pattern as the existing draft restore banner on the upload page.
- **Typography scale.** Page title `text-3xl font-bold text-gray-900`. Section headers `text-xl font-semibold text-gray-900`. Body text `text-sm text-gray-600`.
- **Icons.** Lucide React only. No mixed icon sets.
- **Date formatting.** `MMM d, yyyy` (e.g., "Jan 5, 2026") throughout, using `date-fns/format` — the same function used in the existing upload and contract detail pages.
- **Loading states.** `Loader2 animate-spin` for full-page loading. `animate-pulse` skeletons for partial-page loading. Do not introduce new loading patterns.
- **Tabular numbers.** All financial values use `tabular-nums` class for column alignment.

**The slide-over panel is the main consistency bridge.** By rendering the existing `ContractForm` component inside the slide-over without modification, the detailed review experience is identical to the single-upload flow. Users who started with single upload and move to bulk upload will recognize the form immediately. This is the most important reuse decision in the feature.

---

### Visual Design Direction — Summary

The bulk upload flow is a data-processing tool used during a high-stakes onboarding moment. The visual tone should be:

- **Calm and organized.** Prioritize scannability over visual interest. Use gray backgrounds for the triage table body (`bg-gray-50` on alternate rows or `hover:bg-gray-50` on hover — not both). Avoid gradients, illustrations, or decorative elements that add noise.
- **Status-driven color use.** Color appears in status badges, left-border accents, and callout banners — not in general layout chrome. This keeps color meaningful as a signal rather than decoration.
- **Density is appropriate.** A 15-row triage table is denser than anything currently in the app. This is intentional and appropriate for the context — users are doing batch data work, not casual browsing. Do not over-pad the table rows. Use `py-3 px-4` for cells (same as the sales periods table on the contract detail page), not the larger `py-6` used for content cards.
- **Progress feedback is generous.** For a batch operation that may take 2–5 minutes total, the user needs frequent reassurance that the system is working. Animate status transitions, update the batch header counter eagerly, and avoid any long silent periods where nothing visibly changes.
- **The agreement number preview is a moment of delight.** Showing "LKH-2026-1 through LKH-2026-11" in the pre-confirm modal is the payoff of the onboarding work. Give this preview typographic emphasis: `font-mono text-lg font-semibold text-gray-900` for the agreement number range. This is the moment the user's portfolio becomes real inside Likha.
