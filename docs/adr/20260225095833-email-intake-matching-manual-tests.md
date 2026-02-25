# Manual Test Checklist: Email Intake Matching and Post-Confirm Processing

Covers the changes described in `20260225095833-email-intake-matching-and-processing.md`.

Each item is a checkbox. Expected behavior is indented beneath each checkbox as a plain-text note. Mark items as tested by replacing `[ ]` with `[x]`.

---

## Signal hierarchy matching

### Signal 1 — Sender email exact match

- [ ] **Happy path: sender email matches exactly one active contract.**
  Expected: `contract_id` is set on the `inbound_reports` row. `match_confidence` is `high`. The inbox detail page shows the green auto-matched card with the correct contract name.

- [ ] **Sender email matches zero contracts.**
  Expected: `contract_id` is null. `match_confidence` falls through to Signal 2 (attachment scan) or `none` if no attachment. The inbox detail page shows the amber no-match or suggestions state.

- [ ] **Sender email matches more than one active contract (unlikely but possible if licensee_email is duplicated).**
  Expected: The current backend implementation treats multiple sender-email matches as unmatched (logs a warning, returns `None, "none"`). The inbox detail page shows the amber state. No auto-selection is made.

- [ ] **Sender email matches an inactive (draft or expired) contract.**
  Expected: The query filters `status = 'active'`, so the match is skipped. Falls through to Signal 2 or no-match.

### Signal 2 — Agreement reference number in attachment

- [ ] **Attachment contains a pattern matching `Lic-\d+` (e.g. `Lic-1042`) that corresponds to a contract's `agreement_number`.**
  Expected: `contract_id` is set. `match_confidence` is `high`. Green card shown on detail page.

- [ ] **Attachment contains `AGR-\d+` pattern that matches a contract.**
  Expected: Same as above — `high` confidence, auto-matched state.

- [ ] **Attachment contains `Agreement #\d+` pattern that matches a contract.**
  Expected: Same as above — `high` confidence, auto-matched state.

- [ ] **Attachment contains a recognizable agreement reference pattern but no contract has a matching `agreement_number`.**
  Expected: Signal 2 does not match. Falls through to Signal 3. Note: `agreement_number` column is deferred — until it is added and backfilled, this signal will rarely fire.

- [ ] **Attachment contains an agreement reference in rows beyond the first 20 rows.**
  Expected: Signal 2 does not match (scan is limited to first ~20 rows). Falls through to Signal 3 or no-match. This is acceptable per the ADR.

- [ ] **Attachment contains an agreement reference pattern with extra whitespace or mixed case (e.g. `lic-1042`, `LIC - 1042`).**
  Expected: Verify whether the regex is case-sensitive and whitespace-sensitive. Document the actual behavior. If the pattern does not match, the ADR allows this to be a known limitation.

### Signal 3 — Licensee name in attachment

- [ ] **Attachment header rows contain the licensee name as stored in `contracts.licensee_name` (exact case).**
  Expected: `match_confidence` is `medium`. `contract_id` is null. `candidate_contract_ids` contains the matching contract ID. The detail page shows the amber suggestions state with the contract as a candidate.

- [ ] **Attachment header rows contain the licensee name in a different case (e.g. all-caps or title-case).**
  Expected: The scan is case-insensitive, so the match is found. `match_confidence` is `medium`.

- [ ] **Attachment contains the licensee name but it is a substring of a longer company name (e.g. `licensee_name = "Vantage"` and attachment contains `Vantage Retail Partners`).**
  Expected: The substring scan finds the match. `match_confidence` is `medium`. Verify no false positives on common words.

- [ ] **Attachment contains a licensee name that is a substring match for two different contracts.**
  Expected: Both contracts appear in `candidate_contract_ids`. Both are shown as suggestion cards in the detail page. The user must select one manually.

- [ ] **Sender email does not match and attachment contains no recognizable licensee name.**
  Expected: `contract_id` is null, `candidate_contract_ids` is null (or empty). Detail page shows the amber no-match state with the full searchable contract select.

### Signal 4 — Sender domain match (deferred)

- [ ] **Confirm Signal 4 is NOT implemented in this release.**
  Expected: No domain-based matching occurs. If the sender email does not match exactly, the system falls through to attachment signals without attempting a domain lookup. Document that this signal is deferred.

### Multi-candidate edge cases

- [ ] **No attachment is present and sender email does not match.**
  Expected: `contract_id` is null, `candidate_contract_ids` is null. Detail page shows the amber no-match state with a "No attachment" badge and the full searchable select for manual contract selection.

- [ ] **Multiple attachments are present in the email.**
  Expected: Only the first attachment is processed (per ADR). The remaining attachments are not stored and no error is raised.

- [ ] **Attachment is present but fails to upload to storage.**
  Expected: The failure is logged as a warning. The `inbound_reports` row is still inserted with `attachment_filename = null` and `attachment_path = null`. Processing continues without the attachment signals firing.

---

## Period date extraction

### Quarter labels

- [ ] **Attachment contains `Q1 2025` in the first 20 rows.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`. The detail page shows "Q1 2025 (Jan 1 – Mar 31, 2025)".

- [ ] **Attachment contains `Q2 2025`.**
  Expected: `suggested_period_start = 2025-04-01`, `suggested_period_end = 2025-06-30`.

- [ ] **Attachment contains `Q3 2025`.**
  Expected: `suggested_period_start = 2025-07-01`, `suggested_period_end = 2025-09-30`.

- [ ] **Attachment contains `Q4 2025`.**
  Expected: `suggested_period_start = 2025-10-01`, `suggested_period_end = 2025-12-31`.

- [ ] **Quarter label appears in a column header cell, not a data row.**
  Expected: The scan covers the first ~20 rows including header rows, so the match is still found.

### Named ranges

- [ ] **Attachment contains `Reporting Period: Jan-Mar 2025`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`.

- [ ] **Attachment contains `Period From: January 1, 2025`.**
  Expected: `suggested_period_start = 2025-01-01`. `suggested_period_end` may be null if no end date is present in the same cell or adjacent cell. Verify actual behavior and document.

- [ ] **Named range uses abbreviated month names (e.g. `Jan`, `Feb`).**
  Expected: Normalized correctly to ISO dates.

- [ ] **Named range uses full month names (e.g. `January`, `March`).**
  Expected: Normalized correctly to ISO dates.

### Explicit date ranges

- [ ] **Attachment contains `01/01/2025 - 03/31/2025`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`.

- [ ] **Attachment contains ISO format `2025-01-01 to 2025-03-31`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`. Verify whether this format is supported; document the result.

- [ ] **Attachment contains a date range with a non-US date format (e.g. `31/01/2025`).**
  Expected: The extractor either normalizes it correctly or returns null for both dates. No crash. Document actual behavior.

### No match scenario

- [ ] **Attachment contains no recognizable period label in the first 20 rows.**
  Expected: `suggested_period_start = null`, `suggested_period_end = null`. The detail page shows no "Detected period" row. The upload wizard opens with empty date fields (no provenance hint is shown).

- [ ] **No attachment is present.**
  Expected: `suggested_period_start = null`, `suggested_period_end = null`. Same behavior as above.

- [ ] **Period label appears beyond row 20.**
  Expected: Not detected. Both fields are null. This is an accepted limitation per the ADR.

---

## Inbox detail page

### Auto-matched state (high confidence)

- [ ] **Report with `contract_id` set and `match_confidence = high` loads the detail page.**
  Expected: A green card is shown in the Contract Match section displaying the matched contract name with a checkmark icon. No amber warning is shown.

- [ ] **"Wrong match?" toggle is clicked on a high-confidence auto-matched report.**
  Expected: The green card is replaced by either the amber suggestions view (if `candidate_contract_ids` is populated) or the full searchable select (if no candidates exist). The previously auto-matched contract remains selectable.

- [ ] **High-confidence match with no attachment: detail page loads correctly.**
  Expected: Green card still shows the matched contract. A "No attachment" badge is shown in the attachment section. "Confirm & Open Upload Wizard" button is disabled.

### Suggestions state (medium confidence)

- [ ] **Report with `candidate_contract_ids` populated and `contract_id = null` loads the detail page.**
  Expected: An amber header is shown ("No contract matched automatically"). Suggestion cards are displayed for each candidate contract.

- [ ] **Confidence pill styles: candidate with score >= 80 points.**
  Expected: Pill uses `bg-green-100 text-green-700` ("Strong match").

- [ ] **Confidence pill styles: candidate with score 50–79 points.**
  Expected: Pill uses `bg-amber-100 text-amber-700` ("Possible match").

- [ ] **Confidence pill styles: candidate with score < 50 points.**
  Expected: Pill uses `bg-gray-100 text-gray-500` ("Weak match").

- [ ] **"Matched on" tags appear on each suggestion card.**
  Expected: Small gray pills show the evidence signal used (e.g. "agreement ref", "licensee name"). A card matched by Signal 2 shows "agreement ref". A card matched by Signal 3 shows "licensee name".

- [ ] **User clicks a suggestion card.**
  Expected: The card highlights as selected. The "Confirm & Open Upload Wizard" and "Confirm Only" buttons become enabled.

- [ ] **Multiple candidates are shown, sorted by signal strength descending.**
  Expected: The candidate with the highest confidence score appears first.

### No match state

- [ ] **Report with no `contract_id` and no `candidate_contract_ids` loads the detail page.**
  Expected: Amber header is shown. A searchable select input is displayed listing all active contracts for the user, grouped by licensee.

- [ ] **User types in the searchable select to filter contracts.**
  Expected: The list filters to matching results in real time.

- [ ] **User selects a contract from the searchable select.**
  Expected: "Confirm & Open Upload Wizard" and "Confirm Only" buttons become enabled.

- [ ] **Searchable select is empty when the user has no active contracts.**
  Expected: The select shows an empty state or a message indicating no contracts are available. Action buttons remain disabled.

### Attachment preview strip

- [ ] **Report has an attachment with a known file type (e.g. `.xlsx`).**
  Expected: The attachment strip shows the appropriate file-type icon, the filename, the file size, and the detected row count and column count parsed from the attachment.

- [ ] **Report has no attachment.**
  Expected: A "No attachment" badge is shown in place of the preview strip. "Confirm & Open Upload Wizard" is disabled.

- [ ] **Attachment upload to storage failed at ingest time (filename is null).**
  Expected: Same "No attachment" badge behavior as above — the missing file is surfaced clearly. "Confirm & Open Upload Wizard" is disabled.

### Detected period display

- [ ] **Report has `suggested_period_start` and `suggested_period_end` populated.**
  Expected: A "Detected period" row is shown below the attachment strip, displaying the normalized label and date range in the format "Q3 2025 (Jul 1 – Sep 30, 2025)" alongside a provenance badge.

- [ ] **Report has `suggested_period_start = null` and `suggested_period_end = null`.**
  Expected: The "Detected period" row is not shown. No empty or placeholder row appears.

- [ ] **Period label was derived from an explicit date range rather than a quarter label.**
  Expected: The display shows the date range in the appropriate normalized format (e.g. "Jan 1 – Mar 31, 2025") rather than a quarter label.

### Multi-contract informational callout

- [ ] **Licensee has more than one active contract.**
  Expected: A blue informational callout is shown on the detail page: "Vantage Retail Partners has N active contracts. If this report covers multiple product lines, you may need to process it once per contract." The exact licensee name and contract count are correct.

- [ ] **Licensee has exactly one active contract.**
  Expected: The blue callout is not shown.

- [ ] **Report is unmatched (no contract selected yet).**
  Expected: The callout should not appear until a contract is selected, since the licensee is not yet known.

### Action buttons

- [ ] **All three buttons render in the correct positions on a pending report.**
  Expected: "Confirm & Open Upload Wizard" (primary) and "Confirm Only" (secondary) appear together. "Reject Report" (destructive styling) appears separately.

- [ ] **All buttons are disabled on a report that is already confirmed or rejected.**
  Expected: The page shows "This report has already been [status]. No further actions are available." All three buttons are disabled or hidden.

- [ ] **"Confirm & Open Upload Wizard" is disabled when no contract is selected.**
  Expected: The button is visually disabled (opacity 50%, `cursor-not-allowed`) and clicking it has no effect.

- [ ] **"Confirm & Open Upload Wizard" is disabled when no attachment is present.**
  Expected: The button is disabled regardless of whether a contract is selected. A tooltip or adjacent note explains why.

- [ ] **"Confirm Only" is available even when no attachment is present.**
  Expected: The "Confirm Only" button is enabled as long as a contract is selected, whether or not an attachment is present.

---

## Post-confirm redirect flow

### Confirm & Open Wizard

- [ ] **User clicks "Confirm & Open Upload Wizard" on a report with a matched contract and a detected period.**
  Expected: The confirm API is called with `open_wizard: true`. The API returns a `redirect_url` of the form `/sales/upload?contract_id=...&report_id=...&period_start=...&period_end=...&source=inbox`. The browser navigates to that URL.

- [ ] **User clicks "Confirm & Open Upload Wizard" on a report with a matched contract but no detected period.**
  Expected: The confirm API is called with `open_wizard: true`. The `redirect_url` omits `period_start` and `period_end`: `/sales/upload?contract_id=...&report_id=...&source=inbox`.

- [ ] **Redirect URL contains the correct `contract_id` matching the confirmed contract.**
  Expected: The `contract_id` in the URL is the UUID of the contract that was confirmed, not the original auto-matched contract if the user overrode it.

- [ ] **Redirect URL contains the correct `report_id` matching the `inbound_reports` row.**
  Expected: `report_id` in the URL equals the UUID of the `inbound_reports` row just confirmed.

- [ ] **`period_start` and `period_end` in the redirect URL are ISO date strings (YYYY-MM-DD), not datetime strings.**
  Expected: Values like `2025-01-01` and `2025-03-31` appear in the URL. No time component is present.

### Confirm Only

- [ ] **User clicks "Confirm Only" on a pending report.**
  Expected: The confirm API is called with `open_wizard: false` (or omitted). The browser navigates to `/inbox`. A success toast appears containing a "Process now" link that navigates to the upload wizard for the confirmed contract.

- [ ] **"Process now" link in the toast navigates to the correct upload wizard URL.**
  Expected: The link opens `/sales/upload?contract_id=...&source=inbox` (or with period params if available). The wizard is pre-configured for the confirmed report's contract.

- [ ] **The confirmed report now shows status "confirmed" in the inbox list.**
  Expected: After the redirect to `/inbox`, the report row shows the green "Confirmed" badge in the status column.

### Period dates in redirect URL

- [ ] **Q1 quarter label detected: redirect URL contains `period_start=2025-01-01&period_end=2025-03-31`.**
  Expected: Exact ISO dates for Q1 boundaries appear in the URL query string.

- [ ] **Explicit date range detected: redirect URL contains the exact ISO dates from the attachment.**
  Expected: The URL parameters match the normalized `suggested_period_start` and `suggested_period_end` values stored on the `inbound_reports` row.

- [ ] **No period detected: `period_start` and `period_end` are absent from the redirect URL.**
  Expected: The URL is `/sales/upload?contract_id=...&report_id=...&source=inbox` with no period params. The wizard opens with empty date fields.

---

## Upload wizard integration (source=inbox)

### Query param reading on mount

- [ ] **Wizard loads with `source=inbox`, `contract_id`, `report_id`, `period_start`, and `period_end` in the URL.**
  Expected: The wizard reads all five params via `useSearchParams` on mount. Period date fields are pre-filled with the values from the URL.

- [ ] **Wizard loads with `source=inbox` but no `period_start` / `period_end` in the URL.**
  Expected: The date fields are empty. No provenance hint is shown. The user must enter dates manually. All other inbox-source behavior (pre-loaded file, subtitle, etc.) still applies.

- [ ] **Wizard loads without `source=inbox` (standard upload flow).**
  Expected: None of the inbox-source modifications apply. The drag-and-drop zone is shown normally. The subtitle reads the default text.

### Pre-filled period dates with provenance hint

- [ ] **Period dates are pre-filled when `period_start` and `period_end` are present in the URL.**
  Expected: Both date inputs are populated. A provenance hint is displayed adjacent to the date fields: "Detected from email subject — verify before continuing." The hint is visually distinct (e.g. subdued italic or amber text).

- [ ] **User clears one of the pre-filled date fields and re-enters a different value.**
  Expected: The provenance hint either disappears or the field behaves as a user-entered value. Period overlap and frequency checks fire normally after the change.

### Subtitle and page heading

- [ ] **Wizard subtitle reflects the sender email when `source=inbox`.**
  Expected: The subtitle reads "Processing emailed report from reports@licenseecompany.com" (using the actual sender email from the report, fetched via `report_id`). The default subtitle ("Upload a spreadsheet from {contractName} to calculate and verify royalties") is replaced.

### Pre-loaded attachment

- [ ] **Attachment is pre-loaded from storage when `source=inbox` and the report has an attachment.**
  Expected: The drag-and-drop zone is replaced by a filename badge showing the original attachment filename. A "Change file" link appears beside the badge.

- [ ] **User clicks "Change file" on the pre-loaded attachment badge.**
  Expected: The file picker opens. If the user selects a new file, the badge updates to the new filename and the pre-loaded file is no longer used. The provenance of the pre-loaded file is no longer implied.

- [ ] **Wizard opens with `source=inbox` but the report has no attachment (e.g. `attachment_path` is null).**
  Expected: The drag-and-drop zone is shown normally. The user must upload a file manually. This should not cause an error on mount.

### After wizard confirm — sales_period_id linkback

- [ ] **User completes the upload wizard successfully when `source=inbox` and `report_id` is present.**
  Expected: After `confirmSalesUpload` succeeds, the frontend calls `PATCH /api/inbox/{report_id}` to set `sales_period_id` on the `inbound_reports` row to the newly created `sales_periods.id`.

- [ ] **`inbound_reports.sales_period_id` is populated in the database after the wizard completes.**
  Expected: Query the `inbound_reports` table directly. The row for the processed report has a non-null `sales_period_id` that matches the `id` of the newly created `sales_periods` row.

- [ ] **`PATCH /api/inbox/{report_id}` call fails (e.g. network error).**
  Expected: The wizard does not block the user or show an unrecoverable error. The sales period was already created successfully. The linkback failure is logged. The report status may remain `confirmed` rather than `processed` — this is an acceptable degraded state.

### After wizard confirm — status transition to 'processed'

- [ ] **`inbound_reports.status` is `processed` after the wizard completes successfully.**
  Expected: Query the `inbound_reports` table. The row has `status = 'processed'`. This is distinct from `confirmed` (which means the report was acknowledged but not yet processed through the wizard).

- [ ] **Inbox list page shows the correct status badge for a processed report.**
  Expected: The `StatusBadge` component handles the `processed` status. Confirm the badge text and color are defined — currently the inbox list only handles `pending`, `confirmed`, and `rejected`. The `processed` status must be added to avoid falling through to the "Rejected" gray badge.

### Multi-contract "Process for another?" prompt

- [ ] **Wizard completes for a licensee with more than one active contract.**
  Expected: A "Process for another contract?" prompt appears after the success state, showing contract name pills for the licensee's other active contracts.

- [ ] **User clicks a contract name pill in the "Process for another?" prompt.**
  Expected: The browser navigates to `/sales/upload?contract_id={other_contract_id}&report_id={report_id}&source=inbox` (with period params if still applicable). The wizard opens pre-configured for the selected contract with the same source attachment.

- [ ] **Wizard completes for a licensee with exactly one active contract.**
  Expected: The "Process for another?" prompt does not appear. The normal success state and redirect to the contract page occur.

- [ ] **User dismisses the "Process for another?" prompt.**
  Expected: The prompt closes and the default post-confirmation redirect to `/contracts/{contractId}?success=period_created` occurs.

---

## Audit trail

### inbound_reports.sales_period_id linkback

- [ ] **After full end-to-end flow (email received → inbox confirmed → wizard completed), `inbound_reports.sales_period_id` is non-null.**
  Expected: The UUID in `sales_period_id` matches the `id` of the `sales_periods` row that was created during the wizard confirm step.

- [ ] **`sales_periods` row can be joined back to the originating `inbound_reports` row.**
  Expected: `SELECT * FROM inbound_reports WHERE sales_period_id = '{id}'` returns exactly one row — the email that produced this royalty record. This is the audit chain: inbound email → `inbound_reports` → `sales_periods`.

- [ ] **Deleting the `sales_periods` row sets `inbound_reports.sales_period_id` to null (ON DELETE SET NULL).**
  Expected: After deleting the `sales_periods` row, the corresponding `inbound_reports` row has `sales_period_id = null` and `status = processed`. The report is not deleted. The audit history of the email receipt is preserved.

### Status progression

- [ ] **Report status is `pending` immediately after ingest.**
  Expected: `inbound_reports.status = 'pending'` after `POST /api/inbox/inbound` creates the row.

- [ ] **Report status transitions to `confirmed` after the user confirms on the detail page.**
  Expected: `POST /api/inbox/{report_id}/confirm` sets `status = 'confirmed'`. This is true regardless of whether `open_wizard` is `true` or `false`.

- [ ] **Report status transitions to `processed` after the upload wizard completes successfully.**
  Expected: The `PATCH /api/inbox/{report_id}` call (from the wizard post-confirm) sets `status = 'processed'` in addition to setting `sales_period_id`.

- [ ] **`processed` is a valid value for the `inbound_reports_status_check` constraint.**
  Expected: The migration has updated the CHECK constraint to `IN ('pending', 'confirmed', 'rejected', 'processed')`. Inserting or updating a row with `status = 'processed'` does not raise a constraint violation.

- [ ] **No transition is possible from `rejected` to any other status through normal UI actions.**
  Expected: The action buttons on the detail page are disabled once status is `rejected`. The API does not guard against this at the model layer currently, but the UI prevents it. Note this as a potential gap if API-level guards are needed.

---

## Edge cases

### No attachment

- [ ] **Email arrives with no attachment.**
  Expected: `inbound_reports` row is inserted with `attachment_filename = null` and `attachment_path = null`. No error is raised during ingest. The report appears in the inbox with a "No attachment" badge on the detail page.

- [ ] **User attempts to click "Confirm & Open Upload Wizard" on a no-attachment report.**
  Expected: The button is disabled in the UI and cannot be clicked. If an API call is made directly (bypassing the UI), the endpoint returns `422 Unprocessable Entity`.

- [ ] **User clicks "Confirm Only" on a no-attachment report.**
  Expected: The confirm succeeds. The report status changes to `confirmed`. The user is redirected to `/inbox` with the success toast. No wizard is launched.

### No contract match

- [ ] **No signal matches any contract for the user.**
  Expected: `contract_id = null`, `candidate_contract_ids = null`. Detail page shows the amber no-match state. The full searchable select is displayed with all active contracts. The user must pick a contract before confirming.

- [ ] **User confirms without selecting a contract in the no-match state.**
  Expected: "Confirm & Open Upload Wizard" and "Confirm Only" are both disabled when no contract is selected. The action cannot proceed.

### Multiple contracts at same confidence level

- [ ] **Two contracts match Signal 3 (licensee name) with equal score.**
  Expected: Both appear in `candidate_contract_ids`. Both are shown as suggestion cards. Neither is auto-selected. The user must pick one. No auto-pick occurs.

- [ ] **Two contracts match Signal 2 (agreement ref) simultaneously (e.g. two contracts share the same agreement number — a data quality issue).**
  Expected: Neither is auto-selected. Both appear as candidates with `high` confidence. The user must select one. A note in the UI or a warning log entry would be ideal, but the core requirement is that no auto-selection is made.

### Report spans multiple contracts

- [ ] **Licensee has three active contracts and the attachment appears to cover multiple product lines.**
  Expected: The blue informational callout appears on the detail page: "Vantage Retail Partners has 3 active contracts. If this report covers multiple product lines, you may need to process it once per contract." No automatic splitting occurs.

- [ ] **User processes the same report a second time for a different contract.**
  Expected: The user returns to the inbox, opens the same report, selects the second contract, and clicks "Confirm & Open Upload Wizard". A second `sales_periods` row is created for the second contract. The `inbound_reports` row retains the `sales_period_id` from the first processing run (the linkback only records the most recent). Note this as a known limitation of the one-report-one-contract MVP policy.

### Zero-sales report

- [ ] **Attachment contains only header rows and zero data rows, or all net sales values are zero.**
  Expected: Matching and period extraction proceed normally. The report appears in the inbox as usual. The wizard accepts zero-sales records and creates the `sales_periods` row with zero totals. No special error or warning is raised by the intake or matching logic.

- [ ] **Zero-sales report completes the full flow: ingest → confirm → wizard → processed.**
  Expected: `inbound_reports.status = 'processed'` and `sales_period_id` is populated. The `sales_periods` row has `net_sales = 0` (or equivalent). The audit chain is intact.

### Data integrity

- [ ] **`candidate_contract_ids` contains only UUIDs of contracts that belong to the same user.**
  Expected: The matching logic queries `WHERE user_id = {user_id}` before populating candidates. A candidate from another user's contracts never appears.

- [ ] **Confirm endpoint rejects a `contract_id` that belongs to a different user.**
  Expected: If a caller passes a `contract_id` in the body that belongs to another user, the system either ignores it (no ownership check on the override) or returns an error. Document and verify the current behavior. If no check exists, note it as a security gap.

- [ ] **Report ID in the confirm URL belongs to a different user.**
  Expected: `_get_report_for_user` returns a 404. The caller cannot confirm or modify another user's report.
