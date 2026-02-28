# PRD: Bulk Sales Report Upload

**Status:** Draft
**Date:** 2026-02-25
**Author:** Product (designer), PM review added 2026-02-25
**Scope:** Bulk sales report processing for onboarding (historical backlog) and ongoing quarterly cadence when a user has 10+ active contracts

---

> **PM note:** This PRD is well-scoped and correctly identifies the two distinct bulk scenarios (onboarding backlog vs. ongoing quarterly). The feature set is ambitious — five features plus an inbox enhancement. The sections below add prioritization guidance, acceptance criteria, data integrity requirements, and success metrics. PM additions are marked with **[PM]** throughout.

---

## PM: Validate Before Building

**[PM]** Before committing to any implementation, validate the following assumptions with 3–5 target users. Without this validation, we risk building the wrong feature.

**Assumption 1 — The inbox batch is the real bottleneck.** The PRD correctly identifies that users with 15+ contracts face quarterly pain. But users who have enabled email intake (inbox) may have a fundamentally different experience than users who upload manually. We need to know: of the users at 10+ contracts, what fraction are already using the inbox flow? If most are, Feature 1 (inbox batch triage) is the entire MVP. If most are uploading manually, Feature 2 (batch processing queue) becomes the priority.

**Assumption 2 — "Bulk" means quarterly, not daily.** The problem statement says pain occurs "every quarter." This means the batch queue does not need to be optimized for latency — a session that takes 15 minutes to process 20 reports is fine if it replaces 40+ minutes of individual navigation. Do not over-engineer real-time status updates for a use case that runs 4 times per year.

**Assumption 3 — Onboarding backlog is a one-time migration event.** The 160-upload scenario is real, but it only happens once per user. Ongoing quarterly processing happens indefinitely. If engineering time is constrained, prioritize the recurring pain (quarterly batch) over the one-time pain (onboarding backlog). The onboarding backlog scenario also often resolves itself: many users entering historical data enter only the most recent 4–8 quarters, not a full 2-year history.

**Assumption 4 — Period auto-detection from filenames provides 80% of the value.** The PRD proposes both filename-based and content-based period detection. Validate whether users' actual files follow predictable naming conventions (e.g., `SunriseApparel_Q1_2025.xlsx`) or are unpredictably named (e.g., `report_final_v3.xlsx`). If filenames are unreliable, the content-based detection is higher priority than the PRD suggests.

---

## Problem Statement

Likha's current sales upload flow assumes one file for one contract, processed one at a time through a four-step wizard. For a licensor managing a small number of contracts, this is workable. For a licensor with 15 or 30 active contracts who needs to process quarterly reports from all of them, the sequential one-at-a-time design becomes a serious operational friction point.

The problem manifests in two distinct scenarios with meaningfully different characteristics:

### Scenario A: Onboarding Backlog

A licensor switching to Likha from a spreadsheet workflow has historical sales data to enter — often one or two years of quarterly reports per contract across their entire portfolio. If they have 20 contracts and each contract has 8 quarters of history, they face the prospect of going through the four-step upload wizard 160 times. Even at 2 minutes per upload, that is over 5 hours of repetitive work. Most users will either abandon at this point or enter only partial data, which makes Likha immediately less useful (missing historical data means incorrect totals, incomplete royalty trend views, and no baseline for discrepancy analysis).

### Scenario B: Ongoing Quarterly Processing

Every quarter, a licensor's licensees send in their sales reports. For a portfolio of 20 contracts, this means 20 files arrive (via email or manual upload) in a concentrated window — often within a few days of the reporting deadline. The licensor needs to process all 20 reports, verify the calculated royalties, and flag any discrepancies. Currently, they must navigate to each contract individually, upload the file, map columns (unless a saved mapping exists), map categories if needed, and confirm. Even with saved mappings reducing the column-mapping step to near-zero friction, the per-contract navigation overhead across 20 contracts is substantial.

### The specific friction points at scale

**Column mapping is not reused across contracts.** The saved mapping system stores one column mapping per contract (keyed by `licensee_name`). When a licensor has 20 contracts but only 3 distinct licensees (each using a different spreadsheet format), the mapping is learned once per licensee and applied on re-upload. This part works well. The problem is when a licensee sends a report with slightly modified column headers — the saved mapping no longer matches exactly, triggering the full mapping step, which breaks any batch processing mental model the user had.

**Category mapping is re-triggered too often for backlog uploads.** When uploading historical periods for a contract that has category-rate royalties, the category mapper appears on every upload unless aliases have been saved. For backlog processing (8 quarters per contract), a user who successfully maps categories on Q1 2024 should not be prompted again for Q2 2024 from the same licensee.

**Period assignment is manual and error-prone at scale.** The upload wizard requires the user to manually type the period start and end dates before uploading the file. When processing 20 quarterly files in sequence, miskeying dates (entering Q1 instead of Q2, or the wrong year) is a real risk. Most report spreadsheets contain the period dates somewhere in the file — either in the filename, a header row, or a dedicated cell. The system already detects periods from inbox email attachments (`suggested_period_start`, `suggested_period_end` on `InboundReport`) but does not do so for manually uploaded files.

**The inbox triage model does not scale.** The email intake flow (`/inbox`) is one-report-at-a-time. When a licensee sends their quarterly report and it arrives in the inbox as a pending item, the user opens it, confirms the contract match, and is redirected to the upload wizard. This works fine for one report. When 15 reports arrive in the inbox within two days of a reporting deadline, the user must open each inbox item individually, confirm the match, and then process the file through the full upload wizard — 15 separate wizard sessions. There is no way to process multiple pending inbox items in one session.

**No visibility into what is missing.** There is no "coverage view" — a way to see, across all contracts, which periods have been reported and which are expected but missing. A licensor managing 20 contracts with quarterly reporting frequency cannot currently answer the question "which of my licensees have not sent Q4 2025 yet?" without visiting each contract page individually.

---

## PM: Prioritized Feature Stack

**[PM]** The five features proposed span a wide implementation range. This is the recommended build order based on ROI and risk:

**Priority 1 — Feature 1: Inbox Batch Triage (MVP)**
This is the highest ROI item. It requires the least new infrastructure (enhancing an existing page) and solves a concrete, recurring pain point for users already in the email intake flow. The inbox list is currently a read-only table; adding checkboxes and a batch action bar is well-contained. This should ship before anything else in this PRD.

Acceptance criteria for MVP inbox batch:
- User can select multiple pending inbox items via checkboxes
- Batch "Confirm selected" marks all high-confidence items as confirmed in one action
- Items with missing or medium-confidence contract matches are flagged inline; batch action shows a count: "2 items need attention before confirming"
- "Confirm & Process all" confirms all selected items and routes to the batch queue pre-populated with their attachments
- Batch reject is available but requires a secondary confirmation ("Reject 5 reports?")
- Performance: 20-item batch confirm completes in under 5 seconds from the user's perspective

**Priority 2 — Feature 5: Mapping Divergence Alerts**
This is a targeted quality-of-life improvement that benefits both single-upload and batch users. It requires one backend field addition (`mapping_diff` in `UploadPreviewResponse`) and frontend changes to the column mapper. The PRD currently lists this as out-of-scope for MVP at the backend level — that deferral is correct. The UI change (collapsing unchanged columns, surfacing what changed) can ship first with client-side diff logic comparing the saved mapping to the current file's detected columns. The backend-structured diff can follow.

**Priority 3 — Feature 3: Multi-period Upload for One Contract**
The contract detail page gets a second upload entry point ("Upload multiple periods"). This is the most contained scope change — no new routing, no cross-contract assignment logic. The onboarding backlog scenario is the primary use case. Deferring Feature 2 (the full multi-contract batch queue) until after this ships validates the core queue mechanics with a simpler case.

**Priority 4 — Feature 4: Coverage View**
The coverage view is a read-only informational surface. It is genuinely valuable but does not unblock any workflow — it tells users what to do, it does not help them do it faster. Ship after the upload mechanics are solid. The MVP form is a dashboard widget (Q4 note at the top of the dashboard showing how many reports are outstanding) rather than a full `/sales` page.

**Priority 5 — Feature 2: Full Multi-Contract Batch Queue**
This is the most complex feature: new routing, cross-contract file assignment, period auto-detection from file contents, and re-evaluation of queue status after mapping saves. It is the right end state but carries the most implementation risk. Build after the single-contract multi-period upload (Feature 3) and inbox batch triage (Feature 1) are proven.

**Deferred — Period auto-detection from file contents**
The PRD correctly defers content-based period detection. Client-side filename parsing can ship as part of Feature 3 with no backend changes. Content-based detection requires a backend change to `UploadPreviewResponse` and belongs in a future sprint.

---

## User Stories

**US-1 (Batch inbox processing).** As a licensor who received 12 quarterly reports by email this week, I want to see all pending inbox items in a triage view so I can quickly confirm contract matches and dispatch each file to processing without opening 12 separate pages.

**US-2 (Saved mapping reuse).** As a licensor uploading the same licensee's report for the third quarter in a row, I want Likha to remember the column mapping and category mapping from the first upload so I never see those steps again unless the spreadsheet structure changes.

**US-3 (Multi-file upload for one contract).** As a licensor onboarding historical data for a single contract, I want to upload multiple quarterly report files at once so I can process the full backlog in one session rather than returning to the upload wizard eight times.

**US-4 (Multi-contract batch upload).** As a licensor doing end-of-quarter processing, I want to upload one report file per contract in a single batch, assign each file to its contract, and process them all without navigating to each contract page individually.

**US-5 (Period auto-detection).** As a licensor, I want the system to detect the reporting period from the filename or file contents so I do not have to manually type the start and end dates for each of my 20 quarterly files.

**US-6 (Coverage dashboard).** As a licensor, I want to see at a glance which contracts have a report on file for the current quarter and which are still missing, so I know who to follow up with before I start processing.

**US-7 (Mapping divergence handling).** As a licensor whose licensee slightly changed their column headers this quarter, I want to be alerted to the specific columns that changed so I can quickly re-map just those columns rather than redoing the entire mapping.

**US-8 (Backlog category mapping).** As a licensor uploading 8 historical quarters for a category-rate contract, I want to map categories once and have all subsequent uploads for that contract use the same mapping automatically.

**US-9 (Partial batch failure).** As a licensor processing a batch of 15 reports, if 2 of them fail (wrong format, unreadable file), I want those 2 to be clearly flagged so I can fix or skip them without blocking the other 13 from completing.

**US-10 (Inbox batch triage).** As a licensor with 10 pending inbox items that are all high-confidence auto-matches, I want to confirm all of them in one action and then process the associated files rather than clicking through each one.

**US-11 (PM-added — Confirmation summary before bulk confirm).** As a licensor processing a batch of 15 reports, I want to see a summary of what I am about to create ("15 sales periods for these contracts: [list]") before any data is written, so I can catch assignment mistakes before they happen.

**US-12 (PM-added — Royalty discrepancy triage in batch).** As a licensor who has just processed a batch of 15 quarterly reports, I want to see a results summary that highlights which reports have royalty discrepancies between what Likha calculated and what the licensee reported, so I know which ones need follow-up without visiting each contract individually.

---

## Current Flow Analysis

### Single-contract single-report flow (existing)

The current flow for one upload is:

1. User navigates to a specific contract page (`/contracts/[id]`) and clicks "Upload Report."
2. User is sent to `/sales/upload?contract_id=[id]` — the contract is pre-selected from the URL.
3. **Step 1 (Upload):** User enters period start and end dates manually. The system validates dates against the contract's date range, checks for reporting frequency mismatches, and checks for overlap with existing periods. User drops or selects a file. User clicks "Upload & Parse."
4. **Step 2 (Column mapping):** The backend parses the file and returns detected columns, a suggested mapping (sourced from keyword matching, a saved mapping, or AI), and sample rows. User confirms or adjusts the mapping. The `save_mapping` flag allows the user to persist this mapping for future uploads.
5. **Step 2.5 (Category mapping):** Only shown when the contract has category-based royalty rates and the report contains a product category column with values that do not exactly match the contract's defined categories. User maps report categories to contract categories. Mappings can be saved as aliases for future uploads.
6. **Step 3 (Preview):** The sales period has already been created in the database during the mapping confirmation step. The preview shows the parsed data summary, the calculated royalty, and any warnings (discrepancies, metadata mismatches). User clicks "Done" and is redirected to the contract detail page.

### What the backend does at each step

- `POST /api/upload/{contract_id}` — Parses the file, generates suggested column mapping (using saved mapping if available, otherwise keyword/AI), returns `UploadPreviewResponse` with `upload_id`, detected columns, sample rows, and optionally `category_resolution`.
- `POST /api/upload/{contract_id}/confirm` — Applies column mapping and category mapping, computes royalties, creates the `sales_periods` row, and returns the created `SalesPeriod` plus any `upload_warnings`.
- The `upload_id` is a temporary key that links the parsed file (held in memory or temp storage) to the confirm call.

### What is already working well

- **Saved column mappings** (`saved_mapping` per contract, keyed by `licensee_name`): When a file from a known licensee is uploaded again, the mapping is pre-applied and the column mapping step is effectively skipped if the user confirms without changes. This is the most important friction-reducer for ongoing use.
- **Category alias persistence** (`category_mapping_sources` shows `'saved'` for previously aliased categories): Once a report category is mapped to a contract category, subsequent uploads from the same licensee skip the category mapper for those exact matches.
- **Email intake pre-population:** When an inbox report is confirmed and the user clicks "Confirm & Open Upload Wizard," the wizard is opened at `/sales/upload?contract_id=[id]&report_id=[rid]&period_start=[date]&period_end=[date]&source=inbox`. Period dates detected from the email attachment are pre-filled. This is the seed of period auto-detection.
- **Overlap detection:** The debounced period-check API call warns the user before uploading if a sales period for that date range already exists, preventing accidental duplicates.

### What breaks at scale

| Pain Point | Root Cause | Impact at 10+ contracts |
|---|---|---|
| Contract navigation per upload | Upload wizard is entered from contract detail page | Must visit N contract pages for N reports |
| Manual period entry | No file-level period detection for manual uploads | Error-prone at scale; keyboard-heavy |
| Inbox is one-at-a-time | No multi-select or batch triage in `/inbox` | 15 inbox items = 15 separate review sessions |
| No coverage view | No cross-contract period status view | Cannot see who is missing a report |
| Mapping divergence is silent | Saved mapping silently fails if headers changed | User sees full mapping step with no guidance on what changed |
| Category mapping repeats per period | Aliases are per-category-name, not per-period | Historical backlog re-prompts unless all aliases were previously saved |

---

## Proposed Solution

### What "bulk" means for sales reports

Bulk sales upload has two distinct meanings depending on the user's goal:

1. **Multi-period upload for one contract** — Processing a historical backlog for a single contract (e.g., 8 quarterly files for Sunrise Apparel). Each file represents a different period; all files belong to the same contract.

2. **Multi-contract batch processing** — End-of-quarter processing where each file belongs to a different contract (e.g., 15 files, one from each licensee). The user needs to associate each file with the correct contract, then process all of them.

Both scenarios share common needs: saved mapping reuse, period auto-detection, and a batch-progress view. They differ in how contract assignment works.

A third sub-scenario is the **inbox batch** — multiple pending `InboundReport` items, each with an attachment that needs to be processed through the upload wizard. This is currently handled one-at-a-time through `/inbox/[id]`.

The proposed solution addresses all three.

---

### Feature 1: Inbox Batch Triage

This is the highest-priority feature because it addresses ongoing quarterly processing (Scenario B) for users who have enabled the email intake flow. It requires the least new infrastructure since the inbox UI and the upload wizard already exist.

#### What changes in the inbox list (`/inbox`)

Add a "Process selected" batch action to the inbox list. Users can check multiple pending items and perform a batch action:

- **Confirm selected** — Marks all selected items as `confirmed` without opening the upload wizard. Useful for auto-matched items the user trusts, where they want to process the files in a separate session.
- **Confirm and process all** — Confirms all selected items (where a contract is selected) and opens a new **Batch Processing Queue** view (see Feature 2) pre-populated with the confirmed items' attachments.

The inbox list should add a leftmost checkbox column (hidden on mobile, visible on `sm:` and above). Selecting any checkbox reveals a sticky batch action bar at the bottom of the page (similar to email client bulk action patterns):

```
[13 selected]   [Confirm selected]   [Confirm & Process all]   [Reject selected]
```

Contract match confidence gates what batch actions are available:
- **High confidence, all selected:** All three actions enabled.
- **Mixed confidence:** "Confirm selected" is enabled but shows a warning count: "3 items need manual contract selection." The user can click through to fix those before confirming.
- **No match in selection:** "Confirm selected" is disabled; only "Process with manual matching" is offered, which opens a triage panel for the unmatched items.

#### Inbox triage panel for unmatched or medium-confidence items

When batch-confirming a set that includes unmatched or medium-confidence items, a side panel or modal opens with a sequential review UI: one card per unmatched item, showing the sender, subject, attachment filename, detected period, and a contract selector. The user works through each card. Once all cards are resolved, the full batch is confirmed.

This is preferable to blocking the whole batch on unmatched items — the auto-matched majority should not be held back by the unmatched minority.

#### Suggested UX for the inbox list with batch support

The inbox table gains:
- A header checkbox (select all / deselect all) with an indeterminate state when some but not all are selected
- Per-row checkboxes in a fixed-width column (40px)
- A sticky action bar that appears at the bottom of the viewport when any items are selected (using `fixed bottom-0` with a slide-up transition)
- The action bar shows selected count, and action buttons that are contextually enabled/disabled based on the selection's confidence mix

The `MatchedContract` cell for medium-confidence items should show the suggested contract name in amber (not blank), with a "Verify" label, so the user can see at a glance which items need confirmation before batch processing.

---

### Feature 2: Batch Processing Queue

This is a new page, separate from the existing single-report wizard. The URL could be `/sales/upload/batch`. It is entered from:
- The inbox "Confirm & Process all" batch action (pre-populated with inbox-sourced files)
- A new "Upload Multiple Reports" entry point on the dashboard or reports list
- A direct link during onboarding

The batch processing queue is a two-panel layout:

**Left panel: File queue**
A list of all files in the batch. Each row shows:
- Contract name (or "Assign contract" if not yet assigned)
- Filename
- Detected period (if auto-detected from filename or file contents) or "Enter period"
- Status badge: Waiting / Parsing / Mapping needed / Category mapping needed / Ready / Complete / Failed

**Right panel: Active upload wizard (embedded)**
A compact version of the existing upload wizard, shown for whichever file is currently selected in the queue. When the user finishes a file (completes the wizard for it), the queue automatically advances to the next file that needs attention.

The key design principle is that the wizard is the same interaction the user already knows — only the context (queue sidebar) is new. The user does not need to learn a new UI for the upload itself; they just work through the queue.

#### How files enter the batch queue

**From inbox:** Inbox items that have been confirmed carry their `attachment_path` from Supabase Storage. The batch queue fetches those files and presents them pre-associated with their matched contracts and pre-filled with their detected periods. These files skip the period entry step.

**Manual upload:** A multi-file drop zone on the batch page allows the user to upload several files at once. Each uploaded file initially has no contract assigned. The user assigns contracts in the queue.

#### Contract assignment in the batch queue

For manually uploaded files, each queue row shows a contract assignment control. This is a searchable select (the same `<select>` pattern used in the inbox no-match state, but styled inline in the table). The user can type a licensee name to filter. Agreement numbers (`LKH-2026-N`) are shown alongside licensee names to help users disambiguate contracts with similar licensee names.

Once a contract is assigned to a file, the system immediately fetches the saved column mapping for that contract (if one exists) so it can determine whether the mapping step will be needed. If a saved mapping exists and the file's headers match, the file can move to "Ready" status without the user touching the mapping step at all.

#### Auto-detection of reporting period from file

The backend's existing `/api/upload/{contract_id}` endpoint returns `period_start` and `period_end` in the `UploadPreviewResponse`. This is derived from date columns in the file. However, the current upload wizard ignores these values — it uses the user-entered period dates instead.

In the batch queue, period auto-detection should be a first-class feature:

1. When a file is parsed, display any detected period dates prominently: "Detected period: Jan 1 – Mar 31, 2025. Use these dates?"
2. The user can accept with one click or override by typing different dates.
3. For inbox-sourced files, the `suggested_period_start` and `suggested_period_end` from the `InboundReport` are pre-applied (this already exists in the current inbox-to-wizard flow).

For the batch queue, when a period is auto-detected and accepted, the file advances to "Ready" status if a saved mapping exists and no category resolution is needed. The user is then processing files at near zero-friction — just a queue of "Ready" items to confirm in one action.

#### Batch confirm for "Ready" items

Once files are in "Ready" state (contract assigned, period confirmed, mapping resolved, category aliases all saved), they can be confirmed in bulk via a "Confirm all ready" button. This fires `POST /api/upload/{contract_id}/confirm` sequentially for each ready file, showing progress in the queue. This is the same sequential approach used in the bulk contract upload flow to avoid race conditions in agreement number assignment (less relevant here since sales periods do not have sequential numbers, but sequential processing simplifies error recovery).

If any confirm call fails (409 duplicate period, server error), that file is marked "Failed" with the error message. The user can inspect and retry. Other files continue processing.

#### Status badge states for the queue

| Badge | Color | Meaning |
|---|---|---|
| Waiting | `bg-gray-100 text-gray-600` | Uploaded but contract not yet assigned |
| Parsing | `bg-blue-100 text-blue-700` | File upload in progress |
| Assign contract | `bg-amber-100 text-amber-700` | File parsed; contract not yet selected |
| Enter period | `bg-amber-100 text-amber-700` | Period dates needed (auto-detection failed or unconfirmed) |
| Mapping needed | `bg-amber-100 text-amber-700` | Column mapping step required (saved mapping missing or changed) |
| Categories needed | `bg-amber-100 text-amber-700` | Category mapping step required |
| Ready | `bg-green-100 text-green-700` | All inputs resolved; can be confirmed |
| Processing | `bg-blue-100 text-blue-700` | Confirm call in flight |
| Complete | `bg-green-100 text-green-700` with checkmark | Sales period created successfully |
| Failed | `bg-red-100 text-red-700` | Error during parsing or confirm |

Files that require the user's attention (any amber status) are sorted to the top of the queue. Files in "Ready" or "Complete" states sort below.

---

### Feature 3: Multi-period Upload for One Contract

This is the simpler scenario — uploading a historical backlog for a single contract. The user is on the contract detail page (`/contracts/[id]`) and wants to upload 8 quarterly files at once.

The existing "Upload Report" button on the contract detail page could gain a second option: "Upload multiple periods." This opens a simplified version of the batch queue pre-filtered to the current contract. The contract assignment step is skipped (it is already known). The user only needs to:
1. Drop multiple files
2. Confirm or adjust the auto-detected period for each file
3. Confirm all ready files

Because all files are for the same contract, the saved column mapping applies to all of them. If the mapping is consistent across all files, the user may never see the column mapper at all. Category aliases from the first file are automatically applied to subsequent files.

**Order of processing matters for historical backlog.** When uploading 8 quarters of history for a contract, processing them out of chronological order does not affect correctness (each period is independent) but can be confusing. The batch queue should sort manually uploaded files by detected period start date when multiple periods are detected from the same contract. If period detection fails for some files, those are surfaced for manual entry and sorted to the top.

---

### Feature 4: Coverage View

A cross-contract view that answers: "For the reporting period that just ended, which contracts have a report uploaded and which do not?"

This view is distinct from the existing dashboard (which shows YTD totals) and the contracts list (which shows contract-level info without period status).

#### Where it lives

A new section on the dashboard, or a dedicated page at `/sales` (currently not used). The entry point could be a "Q4 2025 reporting" callout card on the dashboard that appears when the end of a quarter approaches or has just passed.

#### What it shows

A table of active contracts with:
- Licensee name
- Reporting frequency (monthly / quarterly / etc.)
- Expected period (the most recently completed period based on frequency and contract start date)
- Report status for that period: "On file" (green badge) or "Missing" (amber badge, with "Upload now" link)
- Last upload date

This table is sorted by status: missing reports at the top, on-file at the bottom. A summary at the top: "3 of 20 contracts are missing Q4 2025 reports."

Clicking "Upload now" on a missing-report row goes to `/sales/upload?contract_id=[id]` with the expected period pre-filled in the query string (period_start and period_end derived from the contract's frequency and last period).

Clicking a licensee name goes to the contract detail page.

The coverage view is read-only — it is a status view, not an action surface. The upload action happens in the existing wizard or in the batch queue.

---

### Feature 5: Mapping Divergence Alerts

When a saved column mapping exists for a contract but the new file's headers do not match, the current behavior is to show the full column mapper with the suggested mapping partially pre-filled (using keyword or AI matching for the new columns). There is no indication to the user of what specifically changed.

#### Proposed behavior

When a saved mapping exists but the file has different headers, the column mapper should open in a "Mapping divergence" mode with an additional callout at the top:

```
Your previous mapping for [Licensee Name] is mostly compatible.
2 columns changed:
  - "Gross Revenue" (previously mapped to Gross Sales) — not found in this file
  - "Product Line" (new column) — needs mapping
The 6 other columns were matched automatically.
```

The column mapper then focuses the user's attention on only the changed columns. Unchanged columns are shown in a collapsed "Matched automatically" section that the user can expand to verify.

This transforms what felt like "redo the whole mapping" into "fix the two things that changed." This pattern works for both single-upload and batch scenarios.

Implementation note: this requires the backend to return, alongside `suggested_mapping` and `mapping_source`, a structured diff against the saved mapping — specifically which previously-mapped columns are absent in the new file, and which new columns were not in the saved mapping. The diff can be computed server-side when `mapping_source` includes a saved mapping component.

---

## Technical Considerations

### Saved mapping reuse across periods for the same contract

The current saved mapping system stores one mapping per contract (in a `column_mappings` table, keyed by some combination of contract and licensee name). When a user uploads a second file for the same contract, the saved mapping is fetched in the initial `fetchData` call of the upload wizard and passed to the backend's upload endpoint, which uses it as the primary suggestion source.

For multi-period backlog upload (Feature 3), all files belong to the same contract, so the saved mapping applies to all. The category aliases (stored per `(contract_id, report_category)`) also apply to all uploads for that contract. This means that if the user processes Q1 first and saves all aliases, Q2 through Q8 will have zero category mapping friction — they will auto-resolve and skip the category mapper entirely.

The batch queue should make this explicit in the UI: after the user completes the first file for a contract (including saving mappings), subsequent files for the same contract should update their status to "Ready" automatically if the newly saved mappings resolve their pending mapping steps.

### Period detection from file contents

The upload endpoint (`POST /api/upload/{contract_id}`) already returns `period_start` and `period_end` in the `UploadPreviewResponse`. Examining the backend upload router would clarify whether this is derived from date columns in the spreadsheet or passed in from the request. Based on the frontend code, these values come from the user-entered dates (the wizard sends `period_start` and `period_end` as form fields alongside the file). The backend does not currently detect period dates from file contents.

To support period auto-detection, the backend would need to:
1. Look for a column mapped to `report_period` in the file (the current `LikhaField` type includes `report_period` as a valid field).
2. Parse date values from that column to infer the period start and end.
3. Also attempt detection from the filename (common patterns: `Q1_2025`, `2025-01-01_to_2025-03-31`, `Jan-Mar-2025`).
4. Return a `suggested_period_start`, `suggested_period_end`, and `period_detection_source` ('column' | 'filename' | 'none') in the `UploadPreviewResponse`.

This is a backend change to the upload endpoint. The frontend then displays the detected period for the user to confirm rather than requiring them to type it. For the batch queue, this detection runs for every uploaded file in the background before the user engages with it.

### Concurrent file parsing in batch upload

When a user uploads 15 files to the batch queue, they should all be parsed concurrently (subject to a concurrency cap). The same considerations from the bulk contract upload PRD apply: cap parallel requests at 3–5 to avoid rate limits and maintain UI responsiveness. Files complete parsing out of order; the queue must handle this gracefully.

Each file's parsing is independent — the `upload_id` returned by the backend is file-scoped. There is no shared state between parse calls. Failures in one file do not affect others.

### The `upload_id` lifespan

The `upload_id` is a temporary identifier linking a parsed file (held server-side) to the subsequent confirm call. In the current single-wizard flow, the `upload_id` has a short lifespan — the user parses and confirms within the same session. In a batch queue, a user might parse 15 files, then work through the mapping steps one by one over 20 minutes. The `upload_id` must remain valid for the duration of the batch session.

If the backend stores parsed data in memory (rather than in a persistent store like Redis or Supabase), there is a risk that `upload_id` references expire if the server restarts or the cache evicts them. This should be investigated. For batch processing, a session duration of at least 60 minutes for the `upload_id` is needed. If server-side storage of parsed uploads is ephemeral, the batch queue should surface a "File expired — re-upload to continue" error state and allow the user to re-trigger the parse without re-uploading the original file (by caching the file reference in the browser).

### Inbox batch confirm and the `confirmReport` API

The `confirmReport` function in the frontend calls `POST /api/inbox/{id}/confirm` with a `contract_id` and `open_wizard` flag. In the batch inbox triage, calling this for each selected inbox item fires N sequential (or parallel) requests. Since inbox confirm is not computationally expensive (it just updates the `inbound_reports` row status and potentially sets `contract_id`), parallel calls should be safe. There is no equivalent of the agreement number race condition from the contract bulk upload flow.

The `redirect_url` returned by a batch of confirm calls is irrelevant in batch mode — the batch queue handles navigation. The batch confirm response only needs to indicate success or failure per item.

### Category mapping persistence across periods

The category alias store (whatever table backs `category_mapping_sources` returning `'saved'`) is keyed by some combination of contract and category name. When uploading 8 historical quarters for the same contract:
- Q1 upload: user maps "Men's Tops" -> "Apparel", "Women's Tops" -> "Apparel". Saved.
- Q2 upload: "Men's Tops" and "Women's Tops" auto-resolve to "Apparel" via saved aliases. Category mapper skipped entirely.
- Q3-Q8: same.

This already works correctly when uploads are done sequentially (one period at a time, each going through the full wizard). In the batch queue, the same behavior should apply: once the user processes Q1 and saves aliases, the batch queue should re-evaluate Q2-Q8's status and update them to "Ready" if all their category resolution needs are now met.

This requires the batch queue to re-fetch `category_resolution` status for pending files after any mapping save event. Alternatively, the batch queue can re-trigger the parse endpoint (`POST /api/upload/{contract_id}`) for pending same-contract files after the first file's aliases are saved, which will return updated `category_resolution` with the new aliases pre-applied.

### Multi-contract batch file-to-contract assignment

In the multi-contract batch (Feature 2, manual upload path), the user uploads a set of files and assigns each to a contract. The assignment can be partially automated:

1. **Filename matching:** If the filename contains a licensee name, agreement number (`LKH-2026-3`), or a recognizable licensee identifier, the system can suggest a contract match. This is low-risk because the user always sees and confirms the assignment.
2. **Sender email matching:** Not applicable for manually uploaded files (only for inbox-sourced files where `sender_email` is available).
3. **No auto-assignment without confirmation:** Unlike the inbox flow where high-confidence matches are auto-assigned, manually uploaded files should always require explicit contract selection. The risk of silent misassignment (royalties credited to the wrong contract) is too high.

### Agreement number format in contract selectors

When a user is assigning a manually uploaded file to a contract in the batch queue, the contract selector should show both the licensee name and the agreement number:
- "Sunrise Apparel — LKH-2025-1"
- "Meridian Goods — LKH-2025-2"

This is especially important when a licensor has multiple contracts with the same licensee (e.g., separate contracts for different product lines). The licensee name alone is not sufficient to disambiguate. The `agreement_number` field (format `LKH-{year}-{seq}`) is already available on active contracts.

### PM: Data Integrity Concerns at Scale

**[PM]** The single-upload flow has multiple safeguards against bad data: period overlap detection (with an amber warning card), frequency mismatch warnings, contract date range validation, and a duplicate period 409 at confirm time. These safeguards exist because bad data in a financial system is hard to undo and erodes user trust quickly. The bulk flow must maintain all of these safeguards — applying them at batch scale without creating confirmation fatigue.

**Risk 1 — Silent royalty miscalculation from wrong contract assignment.** If a user assigns Sunrise Apparel's footwear report to the Sunrise Apparel apparel contract (because both appear similarly in the selector), Likha will calculate royalties using the wrong royalty rate. The apparel contract might have a 7% flat rate while the footwear contract has a tiered rate starting at 9%. The error may not be caught until the licensor cross-checks with their licensee. The batch confirmation summary (US-11) mitigates this by showing the royalty rate that will be applied per file before anything is written. The row format should be: "Sunrise Apparel — Footwear — LKH-2025-2 — 9% tiered — Q4 2025 — Calculated royalty: $14,300."

**Risk 2 — Duplicate period creation from batch re-runs.** If a user processes the same inbox report twice (e.g., the same file arrives in the inbox twice due to a forwarding loop), or if the user uploads the same spreadsheet to the batch queue twice in the same session, the system will create duplicate sales periods. The per-file overlap check (already implemented in the single-upload wizard) must run before each confirm in the batch queue. A 409 on one file must not silently resolve to creating a duplicate — it must surface as a "Duplicate period — this period already has a record" status badge, with the existing record's royalty total shown so the user can compare.

**Risk 3 — Minimum guarantee misapplication in backlog ingestion.** The `SalesPeriodCreate` model in `backend/app/models/sales.py` passes `net_sales` to `calculate_royalty_with_minimum`. The minimum guarantee logic computes a per-period floor based on `minimum_guarantee_period` (monthly, quarterly, annually). When ingesting 8 historical quarters in a batch, each confirm call applies the minimum guarantee independently. This is correct for quarterly contracts but may produce unexpected results for annual minimum guarantee contracts where the user's understanding is that the shortfall is measured annually, not per-quarter. The batch results summary should display whether minimum guarantee was applied for each period, so the user can verify the totals make sense before leaving the batch queue.

**Risk 4 — Advance payment double-counting.** The `advance_payment` field is credited against the first contract year's royalties in `calculate_ytd_summary`. If a user batch-imports 2 years of historical data in a single session, the advance payment is applied correctly (only in year 1 of the contract). However, if the user later adds more historical periods for year 1 individually, the advance payment credit recalculates correctly because it is computed dynamically at query time in `GET /api/sales/summary/{contract_id}`. This is not a batch-specific risk but should be noted in user-facing documentation: "Advance payment credit appears in the royalty summary view, not in individual period records."

**Risk 5 — Category breakdown loss in batch.** When a file has category-based sales and the user processes it through the full mapping flow, `category_breakdown` is populated on the `SalesPeriod`. If the batch queue skips the category mapping step for a file (because it incorrectly determines that no category resolution is needed), `category_breakdown` will be null and royalties will be calculated without the category-specific rates. This is a correctness bug. The batch queue must only mark a file as "Ready" (skipping the category mapper) if `category_resolution.required` is `false` in the `UploadPreviewResponse` — not based on client-side assumptions about saved aliases.

### No new backend endpoints required for MVP features 1-3

The batch queue can be built using the existing API surface:
- `GET /api/inbox/reports` — fetch inbox items
- `POST /api/inbox/{id}/confirm` — confirm individual inbox items (called N times)
- `POST /api/upload/{contract_id}` — parse each file (called N times, with concurrency cap)
- `POST /api/upload/{contract_id}/confirm` — confirm each parsed file (called N times, sequentially)
- `GET /api/upload/{contract_id}/saved-mapping` — fetch saved column mapping
- `GET /api/upload/{contract_id}/period-check` — validate period before confirm
- `GET /api/sales/contract/{contract_id}` — fetch existing periods for coverage view

Feature 4 (coverage view) requires a new backend endpoint: `GET /api/sales/coverage` that returns, for each active contract, the expected current period (computed from `reporting_frequency` and `contract_start_date`) and whether a sales period record exists for that date range.

Feature 5 (mapping divergence) requires a backend change to the upload endpoint — adding a `mapping_diff` field to `UploadPreviewResponse` when a saved mapping exists.

---

## PM: Interaction with the Email Intake Flow

**[PM]** The email intake flow (the inbox) was the most recently shipped feature set. Bulk sales upload must integrate with it cleanly rather than creating a parallel path that users find confusing. Key integration points:

**The inbox is the primary entry point for ongoing quarterly batches.** When all of a user's licensees send their quarterly reports by email, the inbox becomes the natural aggregation point. Feature 1 (inbox batch triage) is therefore not just a nice-to-have — it is the primary interface for ongoing batch processing. The manual upload path (Feature 2, batch queue via direct upload) is mainly relevant for:
- Onboarding backlog (files not received by email)
- One-off reports from licensees who do not email Likha's inbound address
- Licensees who send reports as PDFs or other non-spreadsheet formats (currently unsupported by the wizard either way)

**The `source=inbox` parameter signals downstream behavior.** The current upload wizard already reads `source=inbox` from the URL to show a "Detected from email attachment — verify before continuing" hint on the period date fields. In the batch queue, inbox-sourced files should carry this same provenance signal. Each queue row for an inbox-sourced file should show a small "From inbox" badge (similar to the existing inbox provenance hint in the wizard), so the user knows the file was received via email and the period dates are pre-populated from the attachment scan — not from the filename or manual entry.

**Confirmed-but-not-processed inbox items create a backlog.** The existing inbox flow supports two actions: "Confirm & Open Upload Wizard" (which opens the wizard immediately) and "Confirm Only" (which marks the report received without processing). Q7 in the Open Questions section already identifies that "Confirm Only" items create an implicit processing backlog. The batch queue should surface this backlog explicitly: the batch queue entry point on the dashboard should show a count of "confirmed but unprocessed" inbox items alongside a "Process now" link. This closes the loop between the inbox flow and the batch upload flow without requiring the user to mentally track which reports they have confirmed but not yet processed.

**Match confidence gating in batch must match the single-item inbox flow.** The single-item inbox review page (`/inbox/[id]`) requires a contract to be selected before either confirm action is available. The batch triage for inbox items must enforce the same rule: high-confidence auto-matched items can be confirmed in batch; medium-confidence or unmatched items require individual attention before inclusion in a batch confirm. Do not allow a batch action that silently skips unmatched items — make their exclusion explicit: "13 of 15 selected items will be confirmed. 2 items need contract selection and will not be included."

**Email-detected period dates are more reliable than filename detection.** The `suggested_period_start` and `suggested_period_end` on `InboundReport` are extracted from the email attachment by the intake processing pipeline. This is content-based detection (the pipeline reads the spreadsheet server-side during email processing). For inbox-sourced files in the batch queue, these dates should be treated with higher confidence than filename-based detection. The UX difference: filename-detected dates show "Detected from filename — verify before confirming" while inbox-detected dates show "Detected from attachment — verify before confirming." The visual treatment in the upload wizard already uses the blue `inbox-provenance-hint` pattern for the latter; the batch queue should adopt the same visual language.

**The inbox batch action must handle the "no attachment" case.** The `InboundReport` type allows `attachment_filename: null`. An inbox item with no attachment cannot be queued for processing. The batch triage should show these items with a "No attachment" badge that visually distinguishes them from processable items, and the batch action bar should exclude them from the count: "12 of 15 selected items can be processed (3 have no attachment)."

---

## Edge Cases

### One licensee, multiple active contracts

The `MultiContractCallout` component already exists in the inbox review page (`/inbox/[id]`) and warns the user when a matched licensee has more than one active contract. In batch processing, this case becomes more common and more consequential.

If Sunrise Apparel has two active contracts (one for Apparel, one for Footwear) and sends a single quarterly report, the licensor must decide:
- Is this report for one contract only? (Assign to the correct one.)
- Does the report cover both product lines? (It must be uploaded twice — once per contract.)

The batch queue should surface this by showing the number of active contracts for the auto-matched licensee directly on the queue row: "Sunrise Apparel (2 contracts)." Clicking the assignment selector shows both contracts and requires the user to choose. An info callout explains: "This licensee has multiple active contracts. Select the correct one, or upload this file again for the other contract."

### Report covers multiple periods

Some licensees send a single "annual summary" report that combines four quarters of data in one file. Uploading this file would create a single sales period with the full-year date range. If the contract has quarterly reporting, the period-check API will flag a frequency mismatch. The user must decide: treat it as an annual upload (override the warning) or ask the licensee for quarterly breakdowns.

In the batch queue, this case should not be automatically resolved — it requires a judgment call. The queue item should be placed in "Attention needed" status with the frequency mismatch warning displayed inline, rather than blocking the user with a modal.

### Files uploaded for the wrong contract

If a user accidentally assigns a file to the wrong contract in the batch queue and confirms it, there is currently no "undo" for a confirmed sales period. The only recovery is to delete the sales period from the contract detail page and re-upload the file with the correct contract.

The batch queue should add a confirmation step before firing confirm calls for multi-contract batches: a summary table showing "You are about to create N sales periods for the following contracts: [list]." This gives the user a final review moment before data is written.

### Mapping drift across a quarterly backlog

When uploading 8 quarters of historical data for one contract, the file format may have changed at some point (e.g., the licensee switched to a new reporting template in Q3 2024). If Q1-Q2 use one format and Q3-Q8 use another, the saved mapping from Q1 will not apply to Q3 onward. The batch queue will show those files as "Mapping needed" while Q1 and Q2 auto-resolve.

This is the correct behavior — the user must re-map the new format. Once they do, Q3-Q8 should all resolve automatically if the format is consistent from Q3 onward. The mapping divergence callout (Feature 5) is especially valuable here: "4 of your 6 remaining files have a different format from your saved mapping. 3 columns changed."

### Inbox items with no attachment

An inbox item with `attachment_filename: null` cannot be processed through the upload wizard. In the batch queue (when sourced from inbox items), these items should be excluded from "Confirm & Process all" and shown with a "No attachment" badge. The user can still confirm them (marking the report as received) without processing.

### Batch queue session expiry

If the user leaves the batch queue page open for an extended period and then tries to confirm files, some `upload_id` values may have expired server-side. The confirm call will return a 404 or error. The batch queue should catch this error, update the file's status to "Upload expired — re-parse," and allow the user to re-trigger parsing for that file (using the locally cached file object in the browser's memory, or by prompting a re-upload if the file is no longer in memory).

### Very large batches in onboarding

A licensor migrating a full historical backlog might upload 100+ files (e.g., 20 contracts × 5 years × quarterly = 400 files). This is an extreme case, but the batch queue UI must not break at this scale. Virtualization of the queue list (rendering only visible rows) should be implemented from the start to keep the UI performant. The queue should also support filtering by status so the user can quickly find items needing attention in a 400-item list.

### Period overlap within a batch

If the user uploads two files for the same contract covering overlapping periods (e.g., accidentally uploads Q1 2025 twice), the period-check API will detect the overlap when the second file is confirmed. The first confirm will succeed; the second will return a 409 overlap error. The batch queue should surface this as "Duplicate period detected" on the failed item, with a link to the already-created period on the contract detail page. The user can then decide whether to replace the existing period or discard the duplicate file.

### Inbox items for contracts the user does not own

The inbox flow already scopes reports to `user_id`. This does not change in batch mode. All contracts shown in the assignment selector are the current user's active contracts.

### PM: Additional Edge Cases from Code Review

**[PM]** The following edge cases were identified by reviewing the actual implementation and are not addressed in the sections above.

**Zero net_sales rows.** The `SalesPeriodCreate` model enforces `net_sales: Decimal = Field(ge=0)` — zero is explicitly allowed. In a batch, a licensee may legitimately report zero sales for a period (product line discontinued, market closure). The batch queue must not treat a "royalty_calculated = $0" result as an error. It should surface minimum guarantee application in this case — if the contract has a minimum guarantee, the minimum will be applied and the licensor should see "Minimum guarantee applied: $5,000" in the batch results, not a zero.

**Negative net_sales from returns.** The `ge=0` constraint on `SalesPeriodCreate.net_sales` means negative net sales are rejected at the API level. In practice, some licensees send reports where returns exceed gross sales in a period (e.g., a period with high product recalls). The current single-upload wizard would surface this as a validation error after file parsing. In the batch queue, this must mark the file as "Failed" with a clear explanation: "Net sales cannot be negative after returns. The file shows [gross_sales] gross sales and [returns] returns. Check the column mapping or contact your licensee." This is not a new behavior — the constraint is pre-existing — but the batch queue must surface it per-file, not as a page-level error.

**Tiered royalty rate boundary condition in category breakdown.** The `calculate_royalty` service handles tiered rates by applying marginal rate logic (like tax brackets). When a batch includes multiple periods for the same contract with a tiered royalty rate, each period's royalty is calculated independently — there is no YTD accumulation that affects per-period tier application. This is correct per the contract definition (tiers typically reset annually). However, if a user is uploading 4 quarterly periods for a contract with `$0-$2M @ 6%, $2M+ @ 8%`, and annual sales total $3M, the per-quarter royalty calculation will apply 6% to all four quarters (each quarter is ~$750K, under the $2M threshold). The licensor may expect the system to recognize that Q4 sales push the licensee into the 8% tier. This is a fundamental design question about whether tiers are applied per-period or YTD. Clarify this in the contract terms documentation and surface it in the batch results: "Royalty rates applied per reporting period. See contract royalty summary for YTD tier analysis."

**`upload_id` is not persisted.** The PRD correctly identifies that `upload_id` is ephemeral server-side. Reviewing the upload wizard code confirms that `upload_id` comes back in `UploadPreviewResponse` and is held only in React state (`uploadPreview.upload_id`). A page refresh in the single-upload wizard loses the `upload_id` and forces re-upload. In the batch queue, this is compounded: if the user has 15 files parsed and waiting, a page refresh loses all 15 `upload_id` values. The `localStorage`-based resume mechanism described in Q8 of the Open Questions section must include the `upload_id` keyed to the file fingerprint (name + size + last-modified) so that if the page is refreshed and the file is still in browser memory (the `File` object), the re-parse is triggered automatically rather than requiring the user to re-select files.

**The `save_mapping` flag per file, not per batch.** The current upload wizard has a "Save this mapping for future uploads" checkbox on the column mapper. In the batch queue, when processing multiple files for the same contract, the first file's mapping save should apply to all subsequent files in the queue for that same contract. If the user processes file 1 and unchecks "save mapping," subsequent files should not silently save the mapping either. The batch queue should not assume the user's intent is to save mappings for the whole batch — it should honor the per-file choice from the first file and apply it as the default for same-contract subsequent files, with an override available.

**The `reporting_frequency` field is used for the period check but is not enforced at the batch level.** The period-check API (`GET /api/upload/{contract_id}/period-check`) returns a `FrequencyWarning` when the entered period span does not match the contract's `reporting_frequency`. In the single-upload wizard, this is surfaced as a dismissible amber card. In the batch queue, if period dates are auto-detected (from filename or inbox), a frequency mismatch could silently carry through to confirm if the batch queue does not invoke the period-check API for each file before allowing "Ready" status. The batch queue must run the period-check for every file after period dates are set (auto-detected or manual), and must display frequency mismatch warnings inline on the queue row rather than allowing "Ready" status to be granted without acknowledgment.

---

## Open Questions

**Q1: Should the batch processing queue be a permanent feature or only surfaced during onboarding?**

The batch queue is useful for both onboarding (historical backlog) and ongoing quarterly processing. Making it a permanent feature at `/sales/upload/batch` and linking it from the dashboard ("Upload multiple reports") is better than burying it in an onboarding flow only. Ongoing quarterly processing is a recurring pain point; the batch queue solves it every quarter, not just once.

**Q2: Should period auto-detection be a backend responsibility or client-side?**

Detecting periods from filenames can be done client-side in the browser (regex parsing) without adding complexity to the backend upload endpoint. Detecting periods from file contents (e.g., a "Report Period" header row) requires the backend because file parsing happens server-side. Recommendation: do filename detection client-side (no backend change needed) and file-content detection server-side (requires one backend field addition to `UploadPreviewResponse`).

**Q3: What is the right concurrency cap for file parsing in a batch?**

The same question from the bulk contract upload PRD applies here. 3–5 parallel parse requests is a safe starting point, but should be configurable. Sales report files are typically smaller than contract PDFs, so the storage upload step will be faster. The AI-based column mapping suggestion (if invoked) is the rate-limited step. For files where a saved mapping exists and keyword matching suffices, AI is not called, and those files can be parsed more aggressively.

**Q4: Should the coverage view calculate "expected periods" dynamically or store them?**

Computing expected periods dynamically (based on `reporting_frequency`, `contract_start_date`, and today's date) avoids any storage overhead and is always current. The calculation is straightforward: for a quarterly contract starting Jan 1, 2024, the expected periods are Jan-Mar 2024, Apr-Jun 2024, etc. The most recently completed period as of today is the "current expected period." This calculation can be done client-side given the contract's `reporting_frequency` and `contract_start_date`, both already available in the `Contract` type. No new backend endpoint is strictly needed for the coverage view if it is computed client-side from existing contract data and the existing sales period list.

**Q5: How should category mapping interact with batch processing?**

In the batch queue, when a user is working through File 1 for a contract and saves category aliases, Files 2-8 for the same contract should automatically re-evaluate their status. This requires the batch queue to listen for mapping-save events and trigger status updates. The cleanest implementation is a re-parse call for affected files after each mapping save. This adds N extra API calls when aliases are saved, but for the backlog use case (files 2-8 waiting on file 1's aliases), this is the right behavior.

**Q6: Is the inbox batch triage a new page or an enhancement to the existing inbox list?**

The existing inbox list page (`/inbox/page.tsx`) is a relatively simple table component. Adding checkboxes, a sticky action bar, and a triage panel for unmatched items is achievable as an in-place enhancement without creating a new page. The complexity is manageable. Creating a new page would fragment the inbox experience. Recommendation: enhance the existing inbox list in place.

**Q7: What happens to inbox items that are "Confirm Only" (not opened in upload wizard) in the context of batch processing?**

"Confirm Only" marks the `InboundReport` as `confirmed` but does not create a sales period — the attachment file still needs to be processed through the upload wizard. In the batch triage model, "Confirm Only" is effectively the same as "queue this for later processing." The batch queue could show a "From inbox — not yet processed" item state for inbox items that are confirmed but not yet processed. This creates a natural backlog view that motivates the user to finish processing.

**Q8: Should the batch queue support pausing and resuming across browser sessions?**

In the bulk contract upload PRD, the recommendation was to accept that interrupted batch sessions are recovered through the existing draft resume flow. For sales upload, there is no equivalent "draft" state for a parsed-but-not-confirmed upload. The `upload_id` is ephemeral. If the user closes the batch queue and returns the next day, all pending `upload_id` values will have expired, and they must re-parse the files.

For onboarding backlog (potentially 400 files over multiple sessions), this is a real problem. The mitigation is to save progress as a list of `{ contract_id, period_start, period_end, status }` records in `localStorage` keyed by user ID. Files that are `Complete` do not need to be re-processed. Files that were `Ready` or earlier need to be re-parsed. This gives the user a "resume batch" experience without requiring server-side batch session storage.

---

## Relationship to Bulk Contract Upload PRD

The bulk sales upload PRD (`docs/product/prd/bulk-sales-upload.md`) and the bulk contract upload PRD (`docs/product/prd/bulk-contract-upload.md`) are companion documents. Key design decisions that should remain consistent:

- **Sequential confirm calls** for operations that have ordering implications. Sales periods do not have sequential identifiers like agreement numbers, but sequential processing still simplifies error recovery.
- **No new backend endpoints for MVP Features 1-3.** Both PRDs recommend building on existing API endpoints for the initial version.
- **Triage-first review UI.** Both PRDs use a table/queue with status badges and targeted attention on items needing action, rather than forcing sequential full-form review.
- **Progress persistence via localStorage.** Both PRDs accept that server-side batch session storage is out of scope for MVP and use client-side persistence as the practical fallback.

The main structural difference: bulk contract upload is primarily an onboarding concern (one-time migration of existing PDFs). Bulk sales upload is both an onboarding concern (historical backlog) and a recurring operational concern (quarterly processing). This means bulk sales upload has a higher ROI for investment — it provides value every quarter, not just at signup.

---

## PM: Acceptance Criteria

**[PM]** These are the minimum behaviors required before any feature in this PRD ships. They complement the designer's UX specifications.

### Feature 1 — Inbox Batch Triage

**AC-1.1** Selecting 10 high-confidence inbox items and clicking "Confirm selected" marks all 10 as `confirmed` status and shows a success banner: "10 reports confirmed." No page reload required.

**AC-1.2** When a selection includes medium-confidence or unmatched items, "Confirm selected" shows a warning count inline in the action bar. Clicking "Confirm selected" proceeds only for high-confidence items; medium/unmatched items remain `pending` and are listed in a "needs attention" callout after the action completes.

**AC-1.3** "Confirm & Process all" is only enabled when all selected items have a contract assigned (auto-matched or user-selected).

**AC-1.4** After "Confirm & Process all," the user is routed to the batch queue pre-populated with the confirmed items' attachments and their detected period dates. No manual re-entry of data that was already present on the `InboundReport`.

**AC-1.5** Inbox items with `attachment_filename: null` cannot be selected for "Confirm & Process all." They can still be selected for "Confirm selected."

**AC-1.6** Batch reject requires a secondary confirmation dialog listing the reports to be rejected.

### Feature 3 — Multi-period Upload for One Contract

**AC-3.1** The user can drag multiple files onto the batch dropzone on the contract detail page. All files are queued immediately; parsing begins concurrently up to the concurrency cap.

**AC-3.2** A file parsed successfully auto-detects its period from the filename (if the filename matches a known date pattern). Detected period is shown as pre-filled with a "Verify" label. The user can accept or override.

**AC-3.3** After saving column aliases on the first file in a batch for a contract, all other files for the same contract that were blocked on category resolution re-evaluate their status automatically. Files that are now fully resolved advance to "Ready" without user intervention.

**AC-3.4** The period-check API runs for every file in the queue after period dates are set. Files with frequency mismatches or period overlaps do not reach "Ready" status until the warning is explicitly acknowledged.

**AC-3.5** "Confirm all ready" fires confirm calls sequentially. A progress indicator tracks N of M files confirmed. If any confirm call fails, that file is marked "Failed" with the error detail. Other files continue.

**AC-3.6** A batch results summary is shown after all ready files are confirmed. The summary shows per-file: contract name, period, net sales, calculated royalty, whether minimum guarantee was applied, and any royalty discrepancy vs. the licensee-reported amount.

### All Batch Features

**AC-ALL.1** No batch action creates a sales period without the user seeing a confirmation summary first. The summary must show the royalty rate being applied for each file.

**AC-ALL.2** All existing single-upload safeguards (overlap detection, frequency mismatch warning, out-of-range period warning) apply to each file in a batch. They may not be silently bypassed by batch processing.

**AC-ALL.3** The batch queue degrades gracefully: a single file failure does not block other files. Error states are per-file, not page-level.

**AC-ALL.4** The batch queue must render without performance degradation for up to 50 files. For 51+ files, a virtualized list is required.

---

## PM: Success Metrics

**[PM]** These metrics should be instrumented from day one and reviewed after 60 days of availability.

### Primary Metrics (did we solve the problem?)

**Time to process N quarterly reports.** For users with 10+ active contracts: measure the median time from opening the inbox to having all quarterly reports as confirmed `sales_period` records. Baseline this on the single-upload flow before the batch features ship. Target: 50% reduction in processing time for a 10-contract quarterly batch.

**Batch completion rate.** Of batch sessions started (3+ files queued), what fraction reach "all files complete or failed" status in the same session? A low completion rate signals that the session is too long, the queue is confusing, or `upload_id` expiry is interrupting users. Target: 70%+ of batch sessions completed without a page reload or re-upload.

**Mapping step skip rate.** For files in a batch queue where a saved mapping exists, what fraction complete without the user touching the column mapper? This measures how well the saved mapping system is working at scale. Target: 80%+ of same-licensee batch files skip the mapping step entirely.

### Secondary Metrics (are we building it right?)

**Inbox batch action adoption.** Of inbox page sessions where 3+ pending items are present, what fraction use the batch select feature vs. clicking through items individually? Low adoption may indicate the checkboxes and action bar are not discoverable.

**Period auto-detection hit rate.** For files uploaded via the batch queue, what fraction have their period successfully detected from the filename vs. requiring manual entry? Track separately for inbox-sourced files (where detection uses the `InboundReport.suggested_period_*` fields) vs. manually uploaded files (filename-based). If filename detection hit rate is below 40%, prioritize content-based detection.

**Batch failure rate by failure type.** Track 409 (overlap), 422 (validation), 5xx (server error), and "upload_id expired" failures per file in batch sessions. This surfaces which failure modes are most common so we can prioritize mitigations.

**Royalty discrepancy surfacing rate.** After batch confirm, what fraction of completed periods have `has_discrepancy = true`? Track whether users click through to review those discrepancies. If the discrepancy rate is high but click-through to review is low, users are not acting on the data — which may indicate the discrepancy display in the batch results summary is not prominent enough.

### Guard Rails (are we breaking anything?)

**Single-upload wizard regression.** Monitor the single-upload wizard completion rate and error rate after batch features ship. Batch features touch shared components (column mapper, period check, confirm logic). Any degradation in the single-upload flow signals a regression.

**Data integrity: duplicate sales periods.** Monitor for `(contract_id, period_start, period_end)` duplicates in the `sales_periods` table. Any increase post-launch signals a bypass of the overlap detection in the batch flow.

---

## Out of Scope for MVP

- Automated period detection from file content (filename-based detection is in scope; content-based detection is deferred)
- Server-side batch session storage (client-side localStorage persistence is in scope)
- Mapping divergence diff in the backend (`UploadPreviewResponse.mapping_diff` field) — the UI indication is in scope, but the structured diff requires a backend change that is deferred
- Coverage view as a full page (`/sales`) — the MVP coverage view can be a widget on the dashboard
- Notifications (email or push) when a licensee's expected report is overdue
- Automated report routing: automatically processing an inbox item through the upload wizard without user review (fully automated "zero-touch" flow)
- Bulk delete of sales periods
- Export of batch processing results to CSV
- Multi-sheet Excel handling (a single Excel file with one sheet per product category or territory, each representing a different period or contract)

**[PM] On the "zero-touch" automated routing deferral:** This is the right call for now. Automatically processing a sales report without human review introduces royalty calculation errors with no opportunity for the licensor to catch them. The value of the inbox batch triage is that it compresses the review step — it does not eliminate it. Do not ship zero-touch automation until we have strong evidence from usage data that the manual review step is adding no value (i.e., users are confirming 95%+ of auto-matched reports without changing anything).

**[PM] On bulk delete deferral:** Correct. Bulk delete of financial records is a destructive operation that requires audit trail design before it can be built safely. The current delete endpoint (`DELETE /api/sales/{period_id}`) is one-at-a-time for this reason. Do not bulk-enable deletion without first establishing: who can delete, what the audit log captures, and whether deleted periods affect the YTD summary and minimum guarantee tracking correctly.
