# Improve email intake: contract auto-matching and post-confirm upload wizard integration

## Context and Problem Statement

The email intake feature receives inbound sales reports from licensees and stores them in `inbound_reports`. Today it has two gaps:

1. **Auto-matching is too narrow.** The only matching signal is an exact sender-email lookup. When a licensee sends from an unexpected address, or when the email body or attachment contains a clear reference to the agreement, the system misses the match and drops the report in an unmatched state with no candidates to offer the user.

2. **Confirmation is a dead end.** After a user confirms an inbound report, they are returned to the inbox with no path to the upload wizard. They must navigate away, find the contract, and manually start an upload — with no pre-populated dates and no reference to the attachment they already reviewed. The confirmed report has no link to the resulting sales period, so there is no audit trail connecting an inbound email to the royalty record it produced.

## Considered Options

* **Do nothing** — keep sender-email-only matching and the confirmation dead end.
* **Claude-assisted matching** — send attachment text to Claude to identify agreement references and licensee names.
* **Regex + string matching with signal hierarchy (chosen)** — scan attachment content for known patterns without an AI call; rank signals by reliability; populate candidate lists when confidence is below threshold.

## Decision Outcome

Chosen option: **regex + string matching with a defined signal hierarchy**, combined with a post-confirm redirect that pre-loads the attachment and period dates into the upload wizard.

Claude is not used for matching. The signal hierarchy (see below) produces a deterministic, auditable result with no API cost and sub-millisecond latency. The edge cases where Claude would add value — ambiguous licensee names, free-form prose references — are deferred until there is evidence that regex matching falls short in practice.

### Signal hierarchy

Signals are evaluated in order. The first signal that produces a match sets the confidence level and stops evaluation.

| Priority | Signal | How matched | Confidence |
|---|---|---|---|
| 1 | Sender email exact match | `contracts.licensee_email = sender_email` | `high` |
| 2 | Agreement reference number in attachment | Regex scan of first ~20 rows for patterns like `Lic-\d+`, `AGR-\d+`, `Agreement #\d+` against `contracts.agreement_number` | `high` |
| 3 | Licensee name in attachment | Case-insensitive substring scan of first ~20 rows for `contracts.licensee_name` | `medium` |
| 4 | Sender domain match | Domain of sender email against domain of licensee email | `low` — **deferred, not in MVP** |

When confidence is `high`, the system sets `contract_id` directly. When confidence is `medium` or when no signal matches, the system populates `candidate_contract_ids` with the ranked matches (or all active contracts for the current user when there are no candidates) and leaves `contract_id` null.

No Claude call is made at any point in the matching flow.

### Period date extraction

When an attachment is present, the intake processor scans the first ~20 rows for period labels matching common patterns:

- Quarter labels: `Q1 2025`, `Q3 2025` etc.
- Named ranges: `Reporting Period: Jan-Mar 2025`, `Period From: January 1, 2025`
- Explicit date ranges: `01/01/2025 - 03/31/2025`

Matched values are normalized to `suggested_period_start` and `suggested_period_end` (ISO dates). For quarter labels, the conversion is deterministic: Q1 = Jan 1 – Mar 31, Q2 = Apr 1 – Jun 30, Q3 = Jul 1 – Sep 30, Q4 = Oct 1 – Dec 31. When no pattern matches, both fields are null.

### Post-confirm redirect and upload wizard integration

The confirm endpoint (`POST /api/inbox/{id}/confirm`) gains an optional `open_wizard: boolean` body field (default `false`). When `true`, the response includes a `redirect_url`:

```
/sales/upload?contract_id=...&report_id=...&period_start=...&period_end=...&source=inbox
```

`period_start` and `period_end` are included only when `suggested_period_start` / `suggested_period_end` are non-null.

The upload wizard reads these query params on mount. When `source=inbox`:
- The attachment is pre-loaded from storage (the drag-and-drop zone is replaced by a filename badge with a "Change file" link).
- Period date fields are pre-filled with a provenance hint: "Detected from email subject — verify before continuing."
- The page subtitle changes to "Processing emailed report from {sender_email}."
- After the wizard completes successfully, and the licensee has more than one active contract, a "Process for another contract?" prompt appears with contract name pills for one-click navigation back to the wizard with a different `contract_id`.

### Audit trail

When the upload wizard confirms successfully for a report that originated from inbox (`source=inbox`, `report_id` present), the confirm endpoint links the resulting `sales_period.id` back to `inbound_reports.sales_period_id`. The report status is also updated from `confirmed` to `processed`. This creates a durable audit chain: inbound email → `inbound_reports` row → `sales_periods` row.

### One report, one contract (MVP policy)

A single inbound report maps to one contract per processing run. If a report covers multiple product lines that belong to different contracts, the user processes it once per contract, each time returning to the inbox and choosing a different contract from the candidate list. Automatic row-level splitting across contracts is deferred.

When a licensee has multiple active contracts, an informational callout appears on the report detail page: "Vantage Retail Partners has 3 active contracts. If this report covers multiple product lines, you may need to process it once per contract."

### Implementation

**Schema — new columns on `inbound_reports`:**

```sql
ALTER TABLE inbound_reports
  ADD COLUMN candidate_contract_ids text[]      DEFAULT NULL,
  ADD COLUMN suggested_period_start  date        DEFAULT NULL,
  ADD COLUMN suggested_period_end    date        DEFAULT NULL,
  ADD COLUMN sales_period_id         uuid        REFERENCES sales_periods(id) ON DELETE SET NULL;

-- Extend status CHECK to include 'processed'
ALTER TABLE inbound_reports
  DROP CONSTRAINT inbound_reports_status_check,
  ADD CONSTRAINT inbound_reports_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'processed'));
```

A migration file is required at `supabase/migrations/YYYYMMDD_inbound_reports_matching.sql`.

**Backend — `backend/app/routers/email_intake.py`:**

- `_auto_match_contract(sender_email, attachment_text, user_contracts)` — implements the signal hierarchy above. Returns `(contract_id, confidence, candidate_contract_ids)`.
- `_extract_period_dates(attachment_text)` — scans first ~20 rows, returns `(suggested_period_start, suggested_period_end)` or `(None, None)`.
- `POST /api/inbox/ingest` — calls both helpers after parsing attachment; stores all new fields on insert.
- `POST /api/inbox/{id}/confirm` — accepts `open_wizard: bool`; when `True`, computes and returns `redirect_url`; after wizard confirms, updates `sales_period_id` and sets `status = 'processed'`.

**Backend — `backend/app/models/email_intake.py`:**

- `InboundReport` — add `candidate_contract_ids`, `suggested_period_start`, `suggested_period_end`, `sales_period_id`, extend `status` literal.
- `ConfirmRequest` — add `open_wizard: bool = False`.
- `ConfirmResponse` — add `redirect_url: str | None`.

**Frontend — `/inbox/[id]` page redesign (`frontend/app/(app)/inbox/[id]/page.tsx`):**

Status banner at top. Three contract-match states:

1. **Auto-matched (high confidence):** Green card showing contract name with "Wrong match?" toggle that falls back to the candidate/search state.
2. **Suggestions (medium confidence):** Amber header with clickable suggestion cards. Each card shows the contract name and confidence pill (see styles below) plus "matched on" tags — small gray pills listing the evidence signal (e.g. "agreement ref", "licensee name").
3. **No match:** Amber header with a searchable select input grouped by licensee, spanning all active contracts.

Confidence pill styles:
- Strong match (>=80 points): `bg-green-100 text-green-700`
- Possible match (50-79 points): `bg-amber-100 text-amber-700`
- Weak match (<50 points): `bg-gray-100 text-gray-500`

Attachment preview strip: file-type icon, filename, file size, detected row count and column count.

Detected period row: displays the normalized label and date range, e.g. "Q3 2025 (Jul 1 – Sep 30, 2025)", with a provenance badge.

Multi-contract informational callout (blue) when licensee has more than one active contract.

Split action buttons:
- Primary: "Confirm & Open Upload Wizard" — disabled when no contract is selected; calls confirm API with `open_wizard: true`, then redirects to `redirect_url`.
- Secondary: "Confirm Only" — calls confirm API with `open_wizard: false`, redirects to `/inbox` with a success toast that includes a "Process now" link.
- Destructive: "Reject Report" — sets status to `rejected`.

**Frontend — upload wizard (`frontend/app/(app)/sales/upload/page.tsx`):**

- Read `report_id`, `period_start`, `period_end`, `source` from `useSearchParams` on mount.
- When `source=inbox`: pre-fill period dates, show provenance hint, pre-load attachment from storage, replace drop zone with filename badge + "Change file" link, update page subtitle.
- After confirm: when `report_id` is present, call `PATCH /api/inbox/{report_id}` to link `sales_period_id`. When licensee has multiple active contracts, show "Process for another contract?" prompt.

**Frontend — types and API (`frontend/types/index.ts`, `frontend/lib/api.ts`):**

- Update `InboundReport` type with new fields.
- Update `ConfirmRequest` and `ConfirmResponse` types.
- Add or update API helpers for confirm with wizard flag, and for the sales-period linkback.

**Tests:**

- `backend/tests/test_email_intake.py` — matching signal coverage (exact email hit, agreement ref regex, licensee name substring, no match → candidates), period extraction (quarter labels, named ranges, explicit ranges, no match), confirm response with and without `open_wizard`, `sales_period_id` linkback, `processed` status transition.
- `frontend/__tests__/inbox-detail.test.tsx` — three contract match state renders, confidence pill styles, "matched on" tags, action button states, post-confirm redirect behavior.

### Edge cases

**Unknown sender:** Silently discard — existing behavior is retained unchanged.

**No attachment:** Show "No attachment" badge on the report detail page. Disable "Confirm & Open Upload Wizard" and return `422` if the endpoint is called without an attachment present. "Confirm Only" remains available.

**No contract match:** User picks manually from all active contracts via the searchable select. No pre-selection.

**Multiple contract matches (same confidence level):** Do not auto-pick. Surface all matches as candidates sorted by signal strength descending. The user must select one.

**Report spans multiple contracts:** Informational warning is shown; no automatic splitting. The user processes the report once per contract.

**Zero-sales report:** Valid. Matching and period extraction proceed normally. The upload wizard handles zero-sales records as it does today.

**Duplicate inbound detection:** Deferred. The existing overlap detection in the upload wizard catches duplicate periods downstream.

### MVP vs deferred

**In scope:**
- Signals 1–3 (sender email, agreement ref, licensee name)
- Candidate contract suggestions in inbox UI
- Post-confirm redirect to upload wizard with pre-filled dates and pre-loaded attachment
- `sales_period_id` link and `processed` status
- Multi-contract informational warning
- "Process for another contract" prompt after wizard completion

**Deferred:**
- Signal 4 (sender domain match)
- Automatic row-level splitting across contracts
- Claude-assisted matching
- Attachment preview rendering in inbox
- Duplicate inbound detection
- `agreement_number` field on `contracts` table

### Files to modify

| File | Changes |
|---|---|
| `supabase/migrations/YYYYMMDD_inbound_reports_matching.sql` | New columns on `inbound_reports`, status constraint update |
| `backend/app/routers/email_intake.py` | `_auto_match_contract`, `_extract_period_dates`, updated ingest + confirm endpoints |
| `backend/app/models/email_intake.py` | New fields on `InboundReport`, `ConfirmRequest`, `ConfirmResponse` |
| `backend/tests/test_email_intake.py` | Tests for all matching signals, period extraction, confirm flow, linkback |
| `frontend/app/(app)/inbox/[id]/page.tsx` | Redesigned detail page with match states, attachment strip, period row, split actions |
| `frontend/app/(app)/sales/upload/page.tsx` | Query param reading, pre-fill, pre-load, "process another" prompt |
| `frontend/types/index.ts` | Updated types for new API fields |
| `frontend/lib/api.ts` | Updated API helpers |

No migration is needed for the `contracts` table. The `agreement_number` column, which would improve the precision of Signal 2, is deferred and is not added in this change.

### Known deviations from original spec

Documented during implementation review (2026-02-28). These are intentional deviations or known limitations accepted for the MVP.

- **Signal 2 matching is case-sensitive and whitespace-sensitive.** `re.escape(agr_num)` does exact string matching. `lic-1042` or `LIC - 1042` would NOT match `LKH-2025-1`. Acceptable per ADR.
- **Signal 1 multiple matches return confidence `'high'` with candidates**, not `'none'`. All matches are surfaced as candidates; no auto-pick.
- **When no signal matches, `candidate_contract_ids` contains ALL active contracts** (not null/empty). The detail page shows the no-match state with a select dropdown.
- **Suggestion cards show "licensee name" hardcoded as the "matched on" tag.** The backend does not return per-candidate signal source, so Signal 2 matches also show "licensee name". Per-candidate signal tracking is deferred.
- **Candidates are not sorted by signal strength.** They appear in the order returned by the database. Sorting is deferred.
- **No-match contract select is a native `<select>`**, not a searchable/filterable combobox. Contracts are listed flat, not grouped by licensee. A combobox upgrade is deferred.
- **Attachment preview strip shows icon + filename only.** File size, row count, and column count are not shown in the strip. Row/column data is in the Zone C preview (metadata + sample data table).
- **Detected period display format is "Detected period: Jul 1, 2025 – Sep 30, 2025"**, not "Q3 2025 (Jul 1 – Sep 30, 2025)". The quarter label is not stored separately.
- **Provenance hint text is "Detected from email attachment — verify before continuing"**, not "email subject". More accurate since the data comes from the attachment.
- **Wizard skips the upload step entirely for inbox source** instead of showing a filename badge with "Change file" link. The user can go back to Step 1 to upload a new file via the standard drop zone.
- **Period extraction does not support full month names** (e.g. "January-March 2025"). The Pattern 2 regex uses 3-char abbreviations only. Known limitation.
- **Period extraction does not support "Period From: January 1, 2025" format.** Pattern 4 metadata rows expect ISO date format (YYYY-MM-DD). Known limitation.
- **Non-US date formats (e.g. `31/01/2025`) return null gracefully.** No crash, but the date is not extracted.
- **No API-level guard exists for status transitions.** The PATCH and confirm endpoints do not check current status before updating. The UI is the sole guard (buttons disabled for non-pending statuses).

---

## Acceptance criteria

**Last verified:** 2026-02-28 — 83 of 91 items code-verified via implementation review and automated test coverage (839 backend tests, 604 frontend tests passing).

### Signal hierarchy matching

#### Signal 1 — Sender email exact match

- [x] **Happy path: sender email matches exactly one active contract.** `contract_id` is set. `match_confidence` is `high`. Green auto-matched card shown.
- [x] **Sender email matches zero contracts.** Falls through to Signal 2/3 or `none`.
- [x] **Sender email matches more than one active contract.** All returned as candidates, `confidence = 'high'`, no auto-pick.
- [x] **Sender email matches an inactive contract.** Query filters `status = 'active'`; match is skipped.

#### Signal 2 — Agreement reference number in attachment

- [x] **`Lic-\d+` pattern matches a contract's `agreement_number`.** `high` confidence, auto-matched.
- [x] **`AGR-\d+` pattern matches.** Same behavior.
- [x] **`Agreement #\d+` pattern matches.** Same behavior.
- [x] **Pattern present but no contract has matching `agreement_number`.** Falls through to Signal 3.
- [x] **Reference in rows beyond first 20.** Not matched (scan limited to `_SCAN_ROWS = 20`).
- [ ] **Extra whitespace or mixed case (e.g. `lic-1042`, `LIC - 1042`).** Known limitation: case-sensitive, whitespace-sensitive exact match.

#### Signal 3 — Licensee name in attachment

- [x] **Exact case match.** `medium` confidence. `contract_id` null, candidate populated.
- [x] **Different case (all-caps, title-case).** Case-insensitive scan finds it.
- [x] **Substring of longer company name.** Substring scan finds it. Leading-words matching also enabled (min 2 words, min 5 chars).
- [x] **Substring matches two contracts.** Both in `candidate_contract_ids`. User must select.
- [x] **No email match and no licensee name found.** All active contracts returned as candidates, `confidence = 'none'`.

#### Signal 4 — Sender domain match (deferred)

- [x] **Signal 4 is NOT implemented.** No domain-matching code exists.

#### Multi-candidate edge cases

- [x] **No attachment, no email match.** No-match state with "No attachment" badge and select dropdown.
- [x] **Multiple attachments.** Only first processed. No error.
- [x] **Attachment upload fails.** Logged as warning. Row inserted with null attachment fields. Matching/period extraction still fire (text decoded before upload).

### Period date extraction

#### Quarter labels

- [x] **`Q1 2025` → `2025-01-01` / `2025-03-31`.**
- [x] **`Q2 2025` → `2025-04-01` / `2025-06-30`.**
- [x] **`Q3 2025` → `2025-07-01` / `2025-09-30`.**
- [x] **`Q4 2025` → `2025-10-01` / `2025-12-31`.**
- [x] **Quarter label in header cell.** Scan covers all rows in first 20, no header/data distinction.

#### Named ranges

- [x] **`Reporting Period: Jan-Mar 2025` → `2025-01-01` / `2025-03-31`.**
- [ ] **`Period From: January 1, 2025`.** Known limitation: Pattern 4 expects ISO dates, not long-form dates.
- [x] **Abbreviated month names (`Jan`, `Feb`).** Normalized via `_MONTH_ABBR` lookup.
- [ ] **Full month names (`January`, `March`).** Known limitation: Pattern 2 regex uses 3-char abbreviations only.

#### Explicit date ranges

- [x] **US format `01/01/2025 - 03/31/2025`.** Handled by Pattern 3a.
- [x] **ISO format `2025-01-01 to 2025-03-31`.** Handled by Pattern 3b.
- [x] **Non-US format (e.g. `31/01/2025`).** Returns null gracefully; no crash.

#### No match

- [x] **No recognizable period label in first 20 rows.** Both fields null. No "Detected period" row shown.
- [x] **No attachment.** Both fields null.
- [x] **Period label beyond row 20.** Not detected. Accepted limitation.

### Inbox detail page

#### Auto-matched state (high confidence)

- [x] **High-confidence report loads detail page.** Green card with CheckCircle icon and contract name.
- [x] **"Wrong match?" toggle clicked.** Falls back to suggestions or search state.
- [x] **High-confidence with no attachment.** Green card shown. "Confirm & Open Upload Wizard" disabled. Hint: "No attachment available — use Confirm Only instead."

#### Suggestions state (medium confidence)

- [x] **Candidates populated, `contract_id = null`.** Amber banner "Suggested match" + suggestion cards.
- [x] **Confidence pill >= 80.** `bg-green-100 text-green-700` "Strong match".
- [x] **Confidence pill 50–79.** `bg-amber-100 text-amber-700` "Possible match".
- [x] **Confidence pill < 50.** `bg-gray-100 text-gray-500` "Weak match".
- [x] **"Matched on" tags on suggestion cards.** Gray pills showing evidence signal (currently "licensee name" hardcoded).
- [x] **User clicks suggestion card.** Card highlights. Confirm buttons become enabled.
- [ ] **Candidates sorted by signal strength.** Known gap: displayed in database order, not sorted by score.

#### No match state

- [x] **No `contract_id`, no `candidate_contract_ids`.** Amber banner + native `<select>` dropdown.
- [ ] **Type-to-filter in select.** Not implemented: native `<select>` lacks search. Known gap.
- [x] **User selects contract from dropdown.** Confirm buttons become enabled.
- [x] **No active contracts.** Placeholder option only. Buttons remain disabled.

#### Attachment preview strip

- [x] **Attachment present.** FileSpreadsheet icon + filename shown.
- [x] **No attachment.** "No attachment" badge. Wizard button disabled.
- [x] **Upload failed at ingest (filename null).** Same "No attachment" badge.

#### Detected period display

- [x] **Period dates populated.** Blue banner: "Detected period: {start} – {end}" with "from attachment" badge.
- [x] **Period dates null.** Row not shown.
- [x] **Explicit date range (not quarter).** Displays formatted date range.

#### Multi-contract callout

- [x] **Licensee has >1 active contract.** Blue callout with licensee name and contract count.
- [x] **Licensee has exactly 1 contract.** Callout not shown.
- [x] **No contract selected yet.** Callout not shown (licensee unknown).

#### Action buttons

- [x] **Three buttons in correct positions.** Primary + secondary together; reject separated.
- [x] **Buttons disabled when already confirmed/rejected.** Message: "This report has already been {status}."
- [x] **Wizard button disabled without contract.** `disabled:opacity-50 disabled:cursor-not-allowed`.
- [x] **Wizard button disabled without attachment.** Disabled with hint text.
- [x] **"Confirm Only" enabled without attachment.** Only requires contract selection.

### Post-confirm redirect flow

#### Confirm & Open Wizard

- [x] **Matched contract + detected period.** Redirect URL includes `contract_id`, `report_id`, `period_start`, `period_end`, `source=inbox`. Frontend appends `storage_path` and `sender_email`.
- [x] **Matched contract, no detected period.** URL omits period params.
- [x] **Correct `contract_id` (override, not original auto-match).**
- [x] **Correct `report_id`.**
- [x] **Period params are ISO date strings (YYYY-MM-DD).**

#### Confirm Only

- [x] **Confirm Only on pending report.** API called with `open_wizard: false`. Redirects to `/inbox?confirmed={reportId}`. Success toast with "Process now" link.
- [ ] **"Process now" link URL is correct.** Needs manual verification.
- [x] **Report shows "Confirmed" badge in inbox list.**

#### Period dates in redirect URL

- [x] **Q1 → `period_start=2025-01-01&period_end=2025-03-31`.**
- [x] **Explicit range → exact ISO dates.**
- [x] **No period detected → params absent from URL.**

### Upload wizard integration (source=inbox)

#### Query param reading

- [x] **All params present.** Wizard reads them. Period fields pre-filled.
- [x] **No period params.** Date fields empty. Other inbox behaviors still apply.
- [x] **No `source=inbox`.** Standard upload flow.

#### Pre-filled period dates

- [x] **Period dates pre-filled with provenance hint.** Hint: "Detected from email attachment — verify before continuing."
- [x] **User edits pre-filled dates.** Period overlap check fires normally.

#### Subtitle

- [x] **Subtitle reflects sender email.** "Processing emailed report from {senderEmail}." Falls back to contract name if sender_email param absent.

#### Pre-loaded attachment

- [x] **Attachment pre-loaded from storage.** Auto-parse skips to map-columns step.
- [ ] **"Change file" link.** Not implemented. User can go back to Step 1 for manual upload.
- [x] **No attachment (attachment_path null).** Standard drop zone shown. No error on mount.

#### sales_period_id linkback

- [x] **Wizard completes with `source=inbox` and `report_id`.** Frontend calls `PATCH /api/inbox/{report_id}` with `sales_period_id`.
- [ ] **Database verification.** Needs end-to-end manual test.
- [x] **PATCH call fails.** Fire-and-forget; logged via `console.warn`. Does not block user.

#### Status transition to 'processed'

- [x] **Status is `processed` after wizard completes.** Backend PATCH sets both `status = 'processed'` and `sales_period_id`.
- [x] **StatusBadge handles `processed`.** Blue badge "Processed" (list) / green badge "Processed" (detail).

#### Multi-contract "Process for another?" prompt

- [x] **Licensee with >1 active contract.** Prompt appears with sibling contract pills.
- [x] **User clicks contract pill.** Navigates to wizard with all params (contract_id, report_id, storage_path, period, sender_email).
- [x] **Licensee with exactly 1 contract.** Prompt not shown; normal redirect.
- [x] **User dismisses prompt.** "Continue to contract page" redirects to `/contracts/{id}?success=period_created`.

### Audit trail

#### sales_period_id linkback

- [x] **End-to-end flow produces non-null `sales_period_id`.** Matches `sales_periods.id`.
- [x] **Join back to originating report.** `sales_period_id` indexed + FK reference.
- [x] **`ON DELETE SET NULL`.** Defined in migration `20260225200000`.

#### Status progression

- [x] **`pending` after ingest.**
- [x] **`confirmed` after user confirms.** Regardless of `open_wizard` value.
- [x] **`processed` after wizard completes.** PATCH sets both status and `sales_period_id`.
- [x] **`processed` valid in CHECK constraint.** Migration includes it.
- [x] **`rejected` → no further UI transitions.** Buttons disabled. No API-level guard (known gap).

### Edge cases

#### No attachment

- [x] **Email with no attachment.** Row inserted with null attachment fields.
- [x] **Wizard button disabled.** Also returns 422 if called via API.
- [x] **"Confirm Only" succeeds.** Status changes to `confirmed`.

#### No contract match

- [x] **No signal matches.** Amber no-match state. Both buttons require contract selection.
- [x] **Confirm without selecting contract.** Both buttons disabled.

#### Multiple contracts at same confidence

- [x] **Two Signal 3 matches.** Both shown as candidates. No auto-pick.
- [x] **Two Signal 2 matches.** Both shown as candidates. No auto-pick or warning.

#### Report spans multiple contracts

- [x] **Multi-contract licensee.** Blue callout shown.
- [x] **Re-processing for different contract.** PATCH overwrites `sales_period_id` with latest. "Process for another?" prompt handles this gracefully.

#### Zero-sales report

- [x] **Zero data or zero values.** Matching and extraction proceed normally.
- [ ] **Full end-to-end flow with zero-sales.** Needs manual test.

#### Data integrity

- [x] **Candidates restricted to user's contracts.** `_fetch_active_contracts_for_user` filters by `user_id`.
- [ ] **Confirm rejects cross-user `contract_id`.** Code review confirms 403 check; needs live verification.
- [x] **Cross-user report access returns 404.** `_get_report_for_user` filters by both `report_id` and `user_id`.

---

## Consequences

* Good, because three matching signals cover the common cases (known sender, structured attachment with agreement ref, structured attachment with licensee name) without introducing an AI dependency or per-call cost.
* Good, because the post-confirm redirect closes the workflow gap — a user who confirms a report can reach the upload wizard in one click with dates and the file already in place.
* Good, because `sales_period_id` and `processed` status create a durable audit trail from inbound email to royalty record, which is necessary for licensee dispute resolution.
* Good, because candidate contracts with confidence pills give users enough context to pick the right contract without guessing, even when auto-matching fails.
* Neutral, because the one-report-one-contract policy means a report covering multiple contracts requires multiple processing runs. This is an acceptable MVP tradeoff; the informational callout sets expectations.
* Neutral, because period date extraction is best-effort — when no pattern matches, the wizard simply opens without pre-filled dates, which is no worse than the current baseline.
* Bad, because deferring `agreement_number` on `contracts` limits Signal 2 to contracts that already have a structured reference field populated. If most contracts lack this field, Signal 2 will rarely fire until a follow-up change adds and backfills `agreement_number`.
