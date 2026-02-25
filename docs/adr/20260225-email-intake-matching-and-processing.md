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

---

## Consequences

* Good, because three matching signals cover the common cases (known sender, structured attachment with agreement ref, structured attachment with licensee name) without introducing an AI dependency or per-call cost.
* Good, because the post-confirm redirect closes the workflow gap — a user who confirms a report can reach the upload wizard in one click with dates and the file already in place.
* Good, because `sales_period_id` and `processed` status create a durable audit trail from inbound email to royalty record, which is necessary for licensee dispute resolution.
* Good, because candidate contracts with confidence pills give users enough context to pick the right contract without guessing, even when auto-matching fails.
* Neutral, because the one-report-one-contract policy means a report covering multiple contracts requires multiple processing runs. This is an acceptable MVP tradeoff; the informational callout sets expectations.
* Neutral, because period date extraction is best-effort — when no pattern matches, the wizard simply opens without pre-filled dates, which is no worse than the current baseline.
* Bad, because deferring `agreement_number` on `contracts` limits Signal 2 to contracts that already have a structured reference field populated. If most contracts lack this field, Signal 2 will rarely fire until a follow-up change adds and backfills `agreement_number`.
