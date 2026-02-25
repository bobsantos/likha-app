# Contract Match Panel — PM Recommendations

**Document type:** Product recommendation
**Status:** Draft for review
**Date:** 2026-02-25
**Scope:** Inbox review page (`frontend/app/(app)/inbox/[id]/page.tsx`) — Contract Match section

---

## Problem Statement

The current Contract Match panel shows only the licensee name for a matched or suggested contract. That is not enough signal for a licensor to confirm the match with confidence, especially when:

- They have multiple contracts with the same licensee (e.g., one for Apparel, one for Footwear)
- The auto-match came from a name-substring signal (medium confidence) rather than an exact email or agreement number match
- They receive reports from licensees they haven't heard from recently and need a memory-jog

Confirming the wrong contract links the sales period to the wrong royalty calculation. This is a financial error that is hard to unwind — the wrong royalty base, rate, and minimum guarantee tracking all become corrupted. The cost of a bad confirmation is high enough that we should invest meaningfully in making the right choice obvious.

---

## What Data Is Already Available

### In the InboundReport (frontend type + backend response)
- `sender_email` — shown on the page today
- `attachment_filename` — shown today
- `suggested_period_start` / `suggested_period_end` — shown today
- `match_confidence` — drives the three match states
- `candidate_contract_ids` — IDs of candidate contracts in medium/none states

### In the Contract type (already fetched as the full `contracts` list)
Every contract field is available client-side without any additional API call:
- `licensee_name`, `licensee_email`, `agreement_number`
- `contract_start_date`, `contract_end_date`
- `royalty_rate`, `royalty_base`
- `product_categories`, `territories`
- `reporting_frequency`
- `minimum_guarantee`, `minimum_guarantee_period`

### What is NOT available today
- Parsed attachment content (metadata rows and data rows from the spreadsheet). The attachment is stored in Supabase Storage at `attachment_path` but its parsed contents are not surfaced in the inbound_reports row or the GET /reports response.
- Any structured extraction of the attachment's header block (Licensee Name, Contract Number, Reporting Period rows that appear at the top of the spreadsheet before the data).

---

## Recommendations

### 1. Contract Fields to Show in the Match Panel

The goal is to answer the question: "Is this the contract this report belongs to?" For that, the licensor needs fields that either appear in the attachment or distinguish between contracts they hold with the same licensee.

**Always show (for all confidence levels):**

| Field | Rationale |
|---|---|
| Licensee name | Already shown; keep it |
| Agreement number | Most attachments include this in the header block (e.g., "Contract Number: BC-2024-0042"). Seeing it match is the strongest visual confirmation signal. Show as `—` if null on the contract. |
| Contract dates | Start date and end date together confirm whether this report's period falls within the contract's active window. Format as "Jan 1, 2024 – Dec 31, 2025". |
| Royalty rate (summarized) | A one-line summary: "8% flat", "Tiered", or "Apparel 10% / Accessories 12% / Footwear 8%". Enough to confirm it matches what the licensee reported. |
| Reporting frequency | Lets the licensor verify the reported period length matches what the contract requires (e.g., quarterly vs. monthly). |

**Show only when present (optional contract fields):**

| Field | When to show |
|---|---|
| Product categories | When `product_categories` is non-null and non-empty. Helps distinguish two contracts with the same licensee covering different product lines. |
| Territory | When `territories` is non-null and non-empty. Same rationale. |
| Licensee email | When `licensee_email` is set on the contract. Useful to confirm the sender email matches what the contract has on file. |

**Omit entirely:**
- `minimum_guarantee`, `advance_payment`, `royalty_base`, `pdf_url`, `storage_path` — these are internal accounting details that do not help confirm identity. They add visual noise without aiding the confirmation decision.

### 2. Attachment Preview Data

The README documents that every sample report starts with a structured header block before the data rows:

```
Licensee Name,     Sunrise Apparel Co.
Licensor Name,     BrandCo Holdings LLC
Contract Number,   BC-2024-0042
Reporting Period Start, 2025-01-01
Reporting Period End,   2025-03-31
Report Submission Date, 2025-04-28
Territory,         United States
```

Even the "messy real-world" format (sample-3) puts the agreement ref in a title row at the top:
```
VANTAGE RETAIL PARTNERS
ROYALTY STATEMENT - Q3 2025
AGREEMENT REF: VRP / BC-2025-0011
```

This header block is the single most useful thing to show — it is what the licensee themselves wrote about which contract and period this covers. Showing it next to the contract card gives the licensor a direct side-by-side comparison.

**Recommendation: Show parsed attachment metadata, not raw data rows.**

Show the first 6–8 rows of the attachment in a read-only key/value table before the real column headers begin. Call this "Attachment Header." This is the section the backend's `_extract_period_dates` and `_auto_match_contract` already scan — the first `_SCAN_ROWS = 20` rows.

Do not show actual sales data rows (Product Description, SKU, Gross Sales, etc.) on this review page. The licensor is not here to audit the numbers — they are here to confirm identity. Sales data review happens in the upload wizard after confirmation, which is already the next step in the flow. Showing it here adds cognitive load without supporting the decision.

**If it is impractical to parse the attachment server-side at intake time** (see backend section below), a reasonable fallback is to omit the attachment preview entirely and rely on the enhanced contract fields display. The contract fields alone are a large improvement over the current state. The attachment preview is additive, not load-bearing.

### 3. Confidence-Adaptive Display

The three match states have different information needs:

**High confidence (auto-matched)**

The current green card is appropriate. Add the contract field details beneath the matched contract name as a collapsed or always-expanded detail block. Because confidence is high, the detail block can start collapsed — the user only needs to expand it if something feels wrong. A "Show contract details" toggle is appropriate here.

The "Not the right contract? Change it" link should remain and be easy to find.

**Medium confidence (suggestions)**

The suggestion cards currently show only the licensee name and a confidence pill. This is the state where the mismatch risk is highest — the licensor must pick between two or more candidates. Each suggestion card should expand to show the contract fields inline, so the licensor can compare them without clicking away. Cards should start expanded when there are 2–3 candidates, and collapsed-by-default if there are 4 or more.

The attachment header preview (if available) should be shown once above the candidate cards, not repeated per card, since it is a fixed property of the incoming report.

**No match**

The existing amber callout and searchable select are the right pattern. Add the attachment header preview (if available) above the select as a reference for the licensor to search by. The contract details should appear as a read-only panel when the licensor selects a contract from the dropdown — they need to confirm their manual selection is correct before committing.

**Summary of confidence-adaptive logic:**

| Confidence | Contract detail | Attachment header | Card state |
|---|---|---|---|
| High | Collapsed toggle below match card | Optional, collapsed | N/A — single match |
| Medium | Expanded inline per candidate card | Shown once above cards | Expanded (≤3 candidates) |
| None | Read-only panel on selection | Shown above select dropdown | N/A — single panel |

### 4. Backend Changes Required

#### What requires backend changes

**Attachment preview content is the only piece not available today.**

The attachment is stored in Supabase Storage but its contents are not surfaced to the frontend. There are two approaches:

**Option A (preferred): Extract and store metadata rows at intake time.**

During `_process_inbound_email`, after decoding `attachment_text`, run a lightweight parser that extracts the first 10–15 rows as raw text before the data header. Store this as a `attachment_preview_rows: list[str]` or `attachment_header_text: str` column on `inbound_reports`. This is a small schema addition and a small code addition to the existing intake processing path.

Cost: one new nullable column on `inbound_reports`, one migration, minor parsing code, update to `InboundReport` and `InboundReportResponse` models and the frontend `InboundReport` type.

The backend already scans the first 20 rows for period detection and agreement number matching. Storing the raw text of those rows is a trivial incremental step.

**Option B: Serve the attachment bytes on-demand.**

Add a new endpoint, e.g. `GET /{report_id}/attachment-preview`, that fetches the attachment from Supabase Storage, parses the first N rows, and returns them. The frontend calls this lazily (on page load or when the user opens the detail section).

Cost: a new endpoint, Supabase Storage read, streaming/parsing in a request path, more frontend async logic.

Option B has higher implementation cost for no quality benefit. Option A is the right choice.

**What does NOT require backend changes**

Enhanced contract field display requires no backend changes. All contract fields are already fetched as part of the `GET /api/contracts` call that the page already makes. The `contracts` array in frontend state already contains `agreement_number`, `contract_start_date`, `contract_end_date`, `royalty_rate`, `product_categories`, `territories`, `reporting_frequency`, and `licensee_email`.

This means the most impactful improvement — showing meaningful contract fields — can be shipped immediately with frontend-only changes.

#### Migration note

Per project conventions: any addition of `attachment_preview_rows` to `inbound_reports` requires a new migration file in `supabase/migrations/` with a timestamped filename. Backend tests mock Supabase entirely and will not catch a missing migration.

### 5. Acceptance Criteria

#### AC1: Contract details visible for auto-matched contracts (high confidence)

- Given a report with `match_confidence = 'high'` and a matched contract
- When the user views the inbox review page
- Then the Contract Match section shows: agreement number (or "—" if null), contract dates as a formatted range, royalty rate summary, reporting frequency
- And a "Show contract details" toggle exists to reveal/hide the detail block
- And the toggle defaults to collapsed

#### AC2: Contract details visible per candidate card (medium confidence)

- Given a report with `match_confidence = 'medium'` and 2–3 candidate contracts
- When the user views the inbox review page
- Then each candidate card shows the contract detail fields inline (agreement number, contract dates, royalty rate summary)
- And the cards default to expanded state
- Given 4 or more candidates, cards default to collapsed

#### AC3: Contract details visible on manual selection (no match)

- Given a report with `match_confidence = 'none'`
- When the user selects a contract from the dropdown
- Then a read-only contract detail panel appears below the dropdown showing the same fields as AC1

#### AC4: Attachment header preview shown when available (requires backend Option A)

- Given a report where `attachment_preview_rows` is non-null
- When the user views the inbox review page
- Then an "Attachment Header" section appears above the contract match controls, showing the raw first rows of the attachment in a read-only preformatted block or key/value table
- And this section is shown for all confidence levels

#### AC5: Attachment header preview absent gracefully

- Given a report where `attachment_preview_rows` is null (no attachment, or attachment could not be parsed)
- Then no "Attachment Header" section is rendered
- And no error or empty placeholder is shown in its place

#### AC6: Royalty rate summary renders correctly for all rate types

- Given a flat rate contract (e.g., royalty_rate = 0.08): display as "8% flat"
- Given a tiered rate contract: display as "Tiered (3 tiers)" or similar non-misleading summary
- Given a category rate contract (e.g., Apparel 10%, Accessories 12%): display each category rate, truncated to 3 lines with "..." if more than 3 categories

#### AC7: No regression on existing match states

- All three match states (high, medium, none) continue to function: auto-match card, suggestion cards, select dropdown
- "Not the right contract? Change it" still appears and works on high-confidence matches
- Confirm and Reject buttons are not affected

#### AC8: Settled reports show contract details as read-only

- Given a report with status = 'confirmed' or 'processed' or 'rejected'
- The contract detail panel is visible but no interactive controls are available
- Matches the existing `isSettled` behavior for action buttons

---

## Implementation Sequencing

Given that contract field display requires no backend changes and attachment preview does, the recommended delivery order is:

**Phase 1 (frontend only, no backend changes needed):**
- Add contract detail display to the auto-match card (AC1)
- Add contract detail fields to suggestion cards (AC2)
- Add contract detail panel on manual selection (AC3)
- Add royalty rate summary formatter (AC6)
- Verify settled states (AC8)

**Phase 2 (requires backend + migration):**
- Add `attachment_preview_rows` column to `inbound_reports` (migration)
- Update intake processing to capture first 15 rows of attachment text at webhook time
- Update `InboundReport` and `InboundReportResponse` Pydantic models
- Update frontend `InboundReport` type
- Add `AttachmentHeaderPreview` component to inbox review page (AC4, AC5)

Phase 1 alone is a meaningful improvement and can ship independently. Phase 2 adds the remaining signal but is not a blocker.

---

## Out of Scope for This Feature

- Showing actual sales data rows from the attachment (belongs in the upload wizard, not the review page)
- Editable contract fields from this page
- Period overlap checking at review time (that happens after the upload wizard runs)
- Contract creation from the inbox review page
