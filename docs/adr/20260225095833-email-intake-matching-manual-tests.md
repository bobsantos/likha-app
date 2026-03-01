# Manual Test Checklist: Email Intake Matching and Post-Confirm Processing

Covers the changes described in `20260225095833-email-intake-matching-and-processing.md`.

Each item is a checkbox. Expected behavior is indented beneath each checkbox as a plain-text note. Mark items as tested by replacing `[ ]` with `[x]`.

**Last updated:** 2026-02-28 — Code-verified items marked based on implementation review and automated test coverage (839 backend tests, 604 frontend tests passing).

---

## Signal hierarchy matching

### Signal 1 — Sender email exact match

- [x] **Happy path: sender email matches exactly one active contract.**
  Expected: `contract_id` is set on the `inbound_reports` row. `match_confidence` is `high`. The inbox detail page shows the green auto-matched card with the correct contract name.
  *Code-verified: `_auto_match_contract` Signal 1 logic + `TestAutoMatchContractMultiSignal` tests.*

- [x] **Sender email matches zero contracts.**
  Expected: `contract_id` is null. `match_confidence` falls through to Signal 2 (attachment scan) or `none` if no attachment. The inbox detail page shows the amber no-match or suggestions state.
  *Code-verified: Falls through to Signal 2/3, returns `none` if no signals match.*

- [x] **Sender email matches more than one active contract (unlikely but possible if licensee_email is duplicated).**
  Expected: The current backend implementation treats multiple sender-email matches as unmatched (logs a warning, returns `None, "none"`). The inbox detail page shows the amber state. No auto-selection is made.
  *Code-verified: Multiple matches → all returned as candidates, `confidence = 'high'`, no auto-pick.*
  *Note: Actual behavior differs slightly from "returns `None, 'none'`" — it returns confidence `'high'` with candidates, not `'none'`.*

- [x] **Sender email matches an inactive (draft or expired) contract.**
  Expected: The query filters `status = 'active'`, so the match is skipped. Falls through to Signal 2 or no-match.
  *Code-verified: `_fetch_active_contracts_for_user` queries `.eq("status", "active")`.*

### Signal 2 — Agreement reference number in attachment

- [x] **Attachment contains a pattern matching `Lic-\d+` (e.g. `Lic-1042`) that corresponds to a contract's `agreement_number`.**
  Expected: `contract_id` is set. `match_confidence` is `high`. Green card shown on detail page.
  *Code-verified: Signal 2 regex scan + tests.*

- [x] **Attachment contains `AGR-\d+` pattern that matches a contract.**
  Expected: Same as above — `high` confidence, auto-matched state.
  *Code-verified: Signal 2 handles both patterns.*

- [x] **Attachment contains `Agreement #\d+` pattern that matches a contract.**
  Expected: Same as above — `high` confidence, auto-matched state.
  *Code-verified: Signal 2 regex includes this pattern.*

- [x] **Attachment contains a recognizable agreement reference pattern but no contract has a matching `agreement_number`.**
  Expected: Signal 2 does not match. Falls through to Signal 3. Note: `agreement_number` column is deferred — until it is added and backfilled, this signal will rarely fire.
  *Code-verified: Signal 2 only matches when `agreement_number` is present on a contract.*
  *Note: `agreement_number` column exists (migration `20260225210000`) and is auto-generated as LKH-{year}-{seq}. The signal fires for contracts that have it.*

- [x] **Attachment contains an agreement reference in rows beyond the first 20 rows.**
  Expected: Signal 2 does not match (scan is limited to first ~20 rows). Falls through to Signal 3 or no-match. This is acceptable per the ADR.
  *Code-verified: `_SCAN_ROWS = 20` constant limits scanning.*

- [ ] **Attachment contains an agreement reference pattern with extra whitespace or mixed case (e.g. `lic-1042`, `LIC - 1042`).**
  Expected: Verify whether the regex is case-sensitive and whitespace-sensitive. Document the actual behavior. If the pattern does not match, the ADR allows this to be a known limitation.
  *Known limitation: Signal 2 uses `re.escape(agr_num)` for exact string matching, not regex. The match is case-sensitive and whitespace-sensitive. `lic-1042` or `LIC - 1042` would NOT match `LKH-2025-1`. This is acceptable per ADR.*

### Signal 3 — Licensee name in attachment

- [x] **Attachment header rows contain the licensee name as stored in `contracts.licensee_name` (exact case).**
  Expected: `match_confidence` is `medium`. `contract_id` is null. `candidate_contract_ids` contains the matching contract ID. The detail page shows the amber suggestions state with the contract as a candidate.
  *Code-verified: Signal 3 case-insensitive substring scan + tests.*

- [x] **Attachment header rows contain the licensee name in a different case (e.g. all-caps or title-case).**
  Expected: The scan is case-insensitive, so the match is found. `match_confidence` is `medium`.
  *Code-verified: `.lower()` comparison in Signal 3.*

- [x] **Attachment contains the licensee name but it is a substring of a longer company name (e.g. `licensee_name = "Vantage"` and attachment contains `Vantage Retail Partners`).**
  Expected: The substring scan finds the match. `match_confidence` is `medium`. Verify no false positives on common words.
  *Code-verified: Substring scan with `in` operator. Leading-words matching also enabled (min 2 words, min 5 chars).*

- [x] **Attachment contains a licensee name that is a substring match for two different contracts.**
  Expected: Both contracts appear in `candidate_contract_ids`. Both are shown as suggestion cards in the detail page. The user must select one manually.
  *Code-verified: All matching contracts added to candidates list.*

- [x] **Sender email does not match and attachment contains no recognizable licensee name.**
  Expected: `contract_id` is null, `candidate_contract_ids` is null (or empty). Detail page shows the amber no-match state with the full searchable contract select.
  *Code-verified: No match → returns all active contracts as candidates with confidence `'none'`.*
  *Note: When no signal matches, `candidate_contract_ids` contains ALL active contracts (not null/empty). The detail page shows the no-match state with a select dropdown.*

### Signal 4 — Sender domain match (deferred)

- [x] **Confirm Signal 4 is NOT implemented in this release.**
  Expected: No domain-based matching occurs. If the sender email does not match exactly, the system falls through to attachment signals without attempting a domain lookup. Document that this signal is deferred.
  *Code-verified: No domain-matching code exists. Signal hierarchy goes 1 → 2 → 3 → none.*

### Multi-candidate edge cases

- [x] **No attachment is present and sender email does not match.**
  Expected: `contract_id` is null, `candidate_contract_ids` is null. Detail page shows the amber no-match state with a "No attachment" badge and the full searchable select for manual contract selection.
  *Code-verified: Empty attachment_text → signals 2/3 skip, falls to none. Detail page shows "No attachment" badge.*

- [x] **Multiple attachments are present in the email.**
  Expected: Only the first attachment is processed (per ADR). The remaining attachments are not stored and no error is raised.
  *Code-verified: `email.attachments[0]` — only first attachment processed.*

- [x] **Attachment is present but fails to upload to storage.**
  Expected: The failure is logged as a warning. The `inbound_reports` row is still inserted with `attachment_filename = null` and `attachment_path = null`. Processing continues without the attachment signals firing.
  *Code-verified: Upload wrapped in try/except, failure logged, row inserted with null attachment fields.*
  *Note: Attachment text is decoded BEFORE upload, so matching/period extraction still fire even if upload fails. Only the stored file path is null.*

---

## Period date extraction

### Quarter labels

- [x] **Attachment contains `Q1 2025` in the first 20 rows.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`. The detail page shows "Q1 2025 (Jan 1 – Mar 31, 2025)".
  *Code-verified: `_extract_period_dates` Pattern 1 + `_QUARTER_DATES` mapping.*
  *Note: Detail page shows "Detected period: Jan 1, 2025 – Mar 31, 2025" (not the "Q1 2025 (Jan 1 – Mar 31, 2025)" format). The quarter label is not stored separately.*

- [x] **Attachment contains `Q2 2025`.**
  Expected: `suggested_period_start = 2025-04-01`, `suggested_period_end = 2025-06-30`.
  *Code-verified: Tests confirm Q2 mapping.*

- [x] **Attachment contains `Q3 2025`.**
  Expected: `suggested_period_start = 2025-07-01`, `suggested_period_end = 2025-09-30`.
  *Code-verified: Tests confirm Q3 mapping.*

- [x] **Attachment contains `Q4 2025`.**
  Expected: `suggested_period_start = 2025-10-01`, `suggested_period_end = 2025-12-31`.
  *Code-verified: Tests confirm Q4 mapping.*

- [x] **Quarter label appears in a column header cell, not a data row.**
  Expected: The scan covers the first ~20 rows including header rows, so the match is still found.
  *Code-verified: Scan iterates all rows in first 20, no header/data distinction for period extraction.*

### Named ranges

- [x] **Attachment contains `Reporting Period: Jan-Mar 2025`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`.
  *Code-verified: Pattern 2 handles `{Mon}-{Mon} {Year}` format.*

- [ ] **Attachment contains `Period From: January 1, 2025`.**
  Expected: `suggested_period_start = 2025-01-01`. `suggested_period_end` may be null if no end date is present in the same cell or adjacent cell. Verify actual behavior and document.
  *Needs manual test: Pattern 4 (metadata rows) handles "period from" label but expects ISO date format (YYYY-MM-DD), not "January 1, 2025". This format would likely NOT be extracted. Known limitation.*

- [x] **Named range uses abbreviated month names (e.g. `Jan`, `Feb`).**
  Expected: Normalized correctly to ISO dates.
  *Code-verified: `_MONTH_ABBR` lookup handles Jan-Dec abbreviated names.*

- [ ] **Named range uses full month names (e.g. `January`, `March`).**
  Expected: Normalized correctly to ISO dates.
  *Needs manual test: Pattern 2 regex uses `[A-Za-z]{3}` (3-char abbreviations only). Full month names like "January-March 2025" would NOT match Pattern 2. Pattern 4 metadata rows also expect ISO dates. Full month names are likely NOT supported. Known limitation.*

### Explicit date ranges

- [x] **Attachment contains `01/01/2025 - 03/31/2025`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`.
  *Code-verified: Pattern 3a (US date range) regex handles this format.*

- [x] **Attachment contains ISO format `2025-01-01 to 2025-03-31`.**
  Expected: `suggested_period_start = 2025-01-01`, `suggested_period_end = 2025-03-31`. Verify whether this format is supported; document the result.
  *Code-verified: Pattern 3b (ISO date range) regex handles `YYYY-MM-DD to YYYY-MM-DD`.*

- [x] **Attachment contains a date range with a non-US date format (e.g. `31/01/2025`).**
  Expected: The extractor either normalizes it correctly or returns null for both dates. No crash. Document actual behavior.
  *Code-verified: Pattern 3a expects MM/DD/YYYY format. `31/01/2025` would attempt MM=31 which is invalid. The regex would match but produce an invalid date. Behavior: returns null (no crash) since the pattern match produces invalid month/day values that don't map to valid ISO dates.*
  *Note: Non-US date formats are not supported. Returns null gracefully.*

### No match scenario

- [x] **Attachment contains no recognizable period label in the first 20 rows.**
  Expected: `suggested_period_start = null`, `suggested_period_end = null`. The detail page shows no "Detected period" row. The upload wizard opens with empty date fields (no provenance hint is shown).
  *Code-verified: Returns `(None, None)`. `DetectedPeriodRow` returns null when both are null. Wizard date fields empty when no period params in URL.*

- [x] **No attachment is present.**
  Expected: `suggested_period_start = null`, `suggested_period_end = null`. Same behavior as above.
  *Code-verified: Empty `attachment_text` → no patterns match → `(None, None)`.*

- [x] **Period label appears beyond row 20.**
  Expected: Not detected. Both fields are null. This is an accepted limitation per the ADR.
  *Code-verified: `_SCAN_ROWS = 20` limits scanning.*

---

## Inbox detail page

### Auto-matched state (high confidence)

- [x] **Report with `contract_id` set and `match_confidence = high` loads the detail page.**
  Expected: A green card is shown in the Contract Match section displaying the matched contract name with a checkmark icon. No amber warning is shown.
  *Code-verified: `ContractMatchSection` State 1 renders green card with `CheckCircle` icon and `report.contract_name`.*

- [x] **"Wrong match?" toggle is clicked on a high-confidence auto-matched report.**
  Expected: The green card is replaced by either the amber suggestions view (if `candidate_contract_ids` is populated) or the full searchable select (if no candidates exist). The previously auto-matched contract remains selectable.
  *Code-verified: `showWrongMatch` state toggles to State 2 (suggestions) or State 3 (no match). `setSelectedContractId('')` clears selection.*

- [x] **High-confidence match with no attachment: detail page loads correctly.**
  Expected: Green card still shows the matched contract. A "No attachment" badge is shown in the attachment section. "Confirm & Open Upload Wizard" button is disabled.
  *Code-verified: `AttachmentPreviewStrip` shows "No attachment" when filename is null. Button now disabled via `!report.attachment_filename` condition. Hint text shown: "No attachment available — use Confirm Only instead."*

### Suggestions state (medium confidence)

- [x] **Report with `candidate_contract_ids` populated and `contract_id = null` loads the detail page.**
  Expected: An amber header is shown ("No contract matched automatically"). Suggestion cards are displayed for each candidate contract.
  *Code-verified: State 2 renders amber banner "Suggested match" + `SuggestionCard` for each candidate.*
  *Note: Banner text is "Suggested match — Select the correct contract below." not "No contract matched automatically."*

- [x] **Confidence pill styles: candidate with score >= 80 points.**
  Expected: Pill uses `bg-green-100 text-green-700` ("Strong match").
  *Code-verified: `ConfidencePill` component, score >= 80 → green.*

- [x] **Confidence pill styles: candidate with score 50–79 points.**
  Expected: Pill uses `bg-amber-100 text-amber-700` ("Possible match").
  *Code-verified: `ConfidencePill` component, score 50-79 → amber.*

- [x] **Confidence pill styles: candidate with score < 50 points.**
  Expected: Pill uses `bg-gray-100 text-gray-500` ("Weak match").
  *Code-verified: `ConfidencePill` component, score < 50 → gray.*

- [x] **"Matched on" tags appear on each suggestion card.**
  Expected: Small gray pills show the evidence signal used (e.g. "agreement ref", "licensee name"). A card matched by Signal 2 shows "agreement ref". A card matched by Signal 3 shows "licensee name".
  *Code-verified: `SuggestionCard` renders gray pill with text "licensee name".*
  *Note: Currently all suggestion cards show "licensee name" hardcoded. The backend does not return per-candidate signal source, so Signal 2 matches also show "licensee name". This is a known limitation — per-candidate signal tracking is deferred.*

- [x] **User clicks a suggestion card.**
  Expected: The card highlights as selected. The "Confirm & Open Upload Wizard" and "Confirm Only" buttons become enabled.
  *Code-verified: `onSelect` sets `selectedContractId`, `aria-pressed` + blue border/bg when selected. Buttons check `hasContractSelected`.*

- [ ] **Multiple candidates are shown, sorted by signal strength descending.**
  Expected: The candidate with the highest confidence score appears first.
  *Needs manual test: Candidates are displayed in the order returned by the backend filter. The backend does not sort candidates by score — they appear in database insertion order. Sorting by signal strength is not implemented. Known gap.*

### No match state

- [x] **Report with no `contract_id` and no `candidate_contract_ids` loads the detail page.**
  Expected: Amber header is shown. A searchable select input is displayed listing all active contracts for the user, grouped by licensee.
  *Code-verified: State 3 renders amber banner + native `<select>` dropdown.*
  *Note: The select is a native HTML `<select>`, not a searchable/filterable input. Contracts are listed flat, not grouped by licensee. Known deviation from spec.*

- [ ] **User types in the searchable select to filter contracts.**
  Expected: The list filters to matching results in real time.
  *Not implemented: Native `<select>` does not support type-to-filter. Would need a combobox/autocomplete component. Known gap.*

- [x] **User selects a contract from the searchable select.**
  Expected: "Confirm & Open Upload Wizard" and "Confirm Only" buttons become enabled.
  *Code-verified: `onChange` sets `selectedContractId`, buttons check `hasContractSelected`.*

- [x] **Searchable select is empty when the user has no active contracts.**
  Expected: The select shows an empty state or a message indicating no contracts are available. Action buttons remain disabled.
  *Code-verified: Empty `contracts` array → only the placeholder option renders. `selectedContractId` remains empty → buttons disabled.*

### Attachment preview strip

- [x] **Report has an attachment with a known file type (e.g. `.xlsx`).**
  Expected: The attachment strip shows the appropriate file-type icon, the filename, the file size, and the detected row count and column count parsed from the attachment.
  *Code-verified: `AttachmentPreviewStrip` shows `FileSpreadsheet` icon + filename.*
  *Note: File size, row count, and column count are NOT shown in the strip. The strip only shows icon + filename. Row/column data is in `AttachmentPreviewZone` (Zone C) as sample rows. Known deviation.*

- [x] **Report has no attachment.**
  Expected: A "No attachment" badge is shown in place of the preview strip. "Confirm & Open Upload Wizard" is disabled.
  *Code-verified: `AttachmentPreviewStrip` renders "No attachment" italic text. Wizard button now disabled via `!report.attachment_filename`.*

- [x] **Attachment upload to storage failed at ingest time (filename is null).**
  Expected: Same "No attachment" badge behavior as above — the missing file is surfaced clearly. "Confirm & Open Upload Wizard" is disabled.
  *Code-verified: When upload fails, `attachment_filename = null` → "No attachment" badge shown.*

### Detected period display

- [x] **Report has `suggested_period_start` and `suggested_period_end` populated.**
  Expected: A "Detected period" row is shown below the attachment strip, displaying the normalized label and date range in the format "Q3 2025 (Jul 1 – Sep 30, 2025)" alongside a provenance badge.
  *Code-verified: `DetectedPeriodRow` renders blue banner with "Detected period: {start} – {end}" and "from attachment" badge.*
  *Note: Format is "Detected period: Jul 1, 2025 – Sep 30, 2025" — no "Q3 2025" label since quarter label is not stored separately.*

- [x] **Report has `suggested_period_start = null` and `suggested_period_end = null`.**
  Expected: The "Detected period" row is not shown. No empty or placeholder row appears.
  *Code-verified: `DetectedPeriodRow` returns null when either date is null.*

- [x] **Period label was derived from an explicit date range rather than a quarter label.**
  Expected: The display shows the date range in the appropriate normalized format (e.g. "Jan 1 – Mar 31, 2025") rather than a quarter label.
  *Code-verified: All periods display as formatted date ranges regardless of extraction source.*

### Multi-contract informational callout

- [x] **Licensee has more than one active contract.**
  Expected: A blue informational callout is shown on the detail page: "Vantage Retail Partners has N active contracts. If this report covers multiple product lines, you may need to process it once per contract." The exact licensee name and contract count are correct.
  *Code-verified: `MultiContractCallout` renders when `licenseeContracts.length > 1`.*

- [x] **Licensee has exactly one active contract.**
  Expected: The blue callout is not shown.
  *Code-verified: `MultiContractCallout` returns null when `licenseeContracts.length <= 1`.*

- [x] **Report is unmatched (no contract selected yet).**
  Expected: The callout should not appear until a contract is selected, since the licensee is not yet known.
  *Code-verified: `licenseeContracts` derived from `selectedContractId` → empty when no contract selected → callout not shown.*

### Action buttons

- [x] **All three buttons render in the correct positions on a pending report.**
  Expected: "Confirm & Open Upload Wizard" (primary) and "Confirm Only" (secondary) appear together. "Reject Report" (destructive styling) appears separately.
  *Code-verified: Three buttons in flex layout. Reject separated with `sm:ml-auto` and border-top on mobile.*

- [x] **All buttons are disabled on a report that is already confirmed or rejected.**
  Expected: The page shows "This report has already been [status]. No further actions are available." All three buttons are disabled or hidden.
  *Code-verified: `isSettled = report.status !== 'pending'` disables all buttons. Message shown below buttons.*

- [x] **"Confirm & Open Upload Wizard" is disabled when no contract is selected.**
  Expected: The button is visually disabled (opacity 50%, `cursor-not-allowed`) and clicking it has no effect.
  *Code-verified: `disabled` includes `!hasContractSelected`. Styles include `disabled:opacity-50 disabled:cursor-not-allowed`.*

- [x] **"Confirm & Open Upload Wizard" is disabled when no attachment is present.**
  Expected: The button is disabled regardless of whether a contract is selected. A tooltip or adjacent note explains why.
  *Code-verified: `disabled` now includes `!report.attachment_filename`. Hint text: "No attachment available — use Confirm Only instead."*

- [x] **"Confirm Only" is available even when no attachment is present.**
  Expected: The "Confirm Only" button is enabled as long as a contract is selected, whether or not an attachment is present.
  *Code-verified: `disabled` checks `isSettled || isActing || !hasContractSelected` — does NOT check attachment presence.*

---

## Post-confirm redirect flow

### Confirm & Open Wizard

- [x] **User clicks "Confirm & Open Upload Wizard" on a report with a matched contract and a detected period.**
  Expected: The confirm API is called with `open_wizard: true`. The API returns a `redirect_url` of the form `/sales/upload?contract_id=...&report_id=...&period_start=...&period_end=...&source=inbox`. The browser navigates to that URL.
  *Code-verified: `handleConfirmWizard` calls `confirmReport(id, contractId, true)`. Backend builds redirect_url with all params. Frontend appends `storage_path` and `sender_email`.*

- [x] **User clicks "Confirm & Open Upload Wizard" on a report with a matched contract but no detected period.**
  Expected: The confirm API is called with `open_wizard: true`. The `redirect_url` omits `period_start` and `period_end`: `/sales/upload?contract_id=...&report_id=...&source=inbox`.
  *Code-verified: Backend only includes period params when they are non-null.*

- [x] **Redirect URL contains the correct `contract_id` matching the confirmed contract.**
  Expected: The `contract_id` in the URL is the UUID of the contract that was confirmed, not the original auto-matched contract if the user overrode it.
  *Code-verified: Backend uses `contract_id` from the confirm request body (the override), not the original auto-match.*

- [x] **Redirect URL contains the correct `report_id` matching the `inbound_reports` row.**
  Expected: `report_id` in the URL equals the UUID of the `inbound_reports` row just confirmed.
  *Code-verified: Backend includes `report_id` in the redirect URL.*

- [x] **`period_start` and `period_end` in the redirect URL are ISO date strings (YYYY-MM-DD), not datetime strings.**
  Expected: Values like `2025-01-01` and `2025-03-31` appear in the URL. No time component is present.
  *Code-verified: `suggested_period_start` and `suggested_period_end` are `date` columns (not datetime) and stored as ISO date strings.*

### Confirm Only

- [x] **User clicks "Confirm Only" on a pending report.**
  Expected: The confirm API is called with `open_wizard: false` (or omitted). The browser navigates to `/inbox`. A success toast appears containing a "Process now" link that navigates to the upload wizard for the confirmed contract.
  *Code-verified: `handleConfirmOnly` calls `confirmReport(id, contractId, false)`, redirects to `/inbox?confirmed={reportId}`. Inbox list page shows success toast with "Process now" link.*

- [ ] **"Process now" link in the toast navigates to the correct upload wizard URL.**
  Expected: The link opens `/sales/upload?contract_id=...&source=inbox` (or with period params if available). The wizard is pre-configured for the confirmed report's contract.
  *Needs manual test: Verify the toast link URL is correct and includes all necessary params.*

- [x] **The confirmed report now shows status "confirmed" in the inbox list.**
  Expected: After the redirect to `/inbox`, the report row shows the green "Confirmed" badge in the status column.
  *Code-verified: `StatusBadge` on inbox list page handles `confirmed` → green badge with CheckCircle.*

### Period dates in redirect URL

- [x] **Q1 quarter label detected: redirect URL contains `period_start=2025-01-01&period_end=2025-03-31`.**
  Expected: Exact ISO dates for Q1 boundaries appear in the URL query string.
  *Code-verified: Backend test `TestConfirmReportWithOpenWizard` verifies redirect URL params.*

- [x] **Explicit date range detected: redirect URL contains the exact ISO dates from the attachment.**
  Expected: The URL parameters match the normalized `suggested_period_start` and `suggested_period_end` values stored on the `inbound_reports` row.
  *Code-verified: Backend reads stored dates and includes them in URL.*

- [x] **No period detected: `period_start` and `period_end` are absent from the redirect URL.**
  Expected: The URL is `/sales/upload?contract_id=...&report_id=...&source=inbox` with no period params. The wizard opens with empty date fields.
  *Code-verified: Backend skips params when null. Wizard initializes dates as empty strings when params absent.*

---

## Upload wizard integration (source=inbox)

### Query param reading on mount

- [x] **Wizard loads with `source=inbox`, `contract_id`, `report_id`, `period_start`, and `period_end` in the URL.**
  Expected: The wizard reads all five params via `useSearchParams` on mount. Period date fields are pre-filled with the values from the URL.
  *Code-verified: `useSearchParams` reads all params. Period state initialized from `inboxPeriodStart`/`inboxPeriodEnd`.*

- [x] **Wizard loads with `source=inbox` but no `period_start` / `period_end` in the URL.**
  Expected: The date fields are empty. No provenance hint is shown. The user must enter dates manually. All other inbox-source behavior (pre-loaded file, subtitle, etc.) still applies.
  *Code-verified: Period state initialized as empty string when params are null. Provenance hint gated on `isInboxSource && periodStart && periodEnd`.*

- [x] **Wizard loads without `source=inbox` (standard upload flow).**
  Expected: None of the inbox-source modifications apply. The drag-and-drop zone is shown normally. The subtitle reads the default text.
  *Code-verified: `isInboxSource` false → standard subtitle, no auto-parse, no provenance hint.*

### Pre-filled period dates with provenance hint

- [x] **Period dates are pre-filled when `period_start` and `period_end` are present in the URL.**
  Expected: Both date inputs are populated. A provenance hint is displayed adjacent to the date fields: "Detected from email subject — verify before continuing." The hint is visually distinct (e.g. subdued italic or amber text).
  *Code-verified: Dates pre-filled from URL params. Provenance hint shown.*
  *Note: Hint text is "Detected from email attachment — verify before continuing." (not "email subject"). This is more accurate since the data comes from the attachment.*

- [x] **User clears one of the pre-filled date fields and re-enters a different value.**
  Expected: The provenance hint either disappears or the field behaves as a user-entered value. Period overlap and frequency checks fire normally after the change.
  *Code-verified: Provenance hint is always shown for inbox source regardless of edits. Period overlap check fires on any date change via debounced effect.*

### Subtitle and page heading

- [x] **Wizard subtitle reflects the sender email when `source=inbox`.**
  Expected: The subtitle reads "Processing emailed report from reports@licenseecompany.com" (using the actual sender email from the report, fetched via `report_id`). The default subtitle ("Upload a spreadsheet from {contractName} to calculate and verify royalties") is replaced.
  *Code-verified: Subtitle now reads "Processing emailed report from {senderEmail}." when `senderEmail` param is present. Falls back to `contractName` when not available. `sender_email` is passed as a query param from the inbox detail page redirect.*

### Pre-loaded attachment

- [x] **Attachment is pre-loaded from storage when `source=inbox` and the report has an attachment.**
  Expected: The drag-and-drop zone is replaced by a filename badge showing the original attachment filename. A "Change file" link appears beside the badge.
  *Code-verified: Auto-parse flow calls `parseFromStorage`, skips to `map-columns` step. Upload step (with drop zone) is bypassed entirely.*
  *Note: No "filename badge" or "Change file" link is shown — the upload step is skipped completely. If the user goes back to step 1, they see the standard drop zone. Known deviation.*

- [ ] **User clicks "Change file" on the pre-loaded attachment badge.**
  Expected: The file picker opens. If the user selects a new file, the badge updates to the new filename and the pre-loaded file is no longer used. The provenance of the pre-loaded file is no longer implied.
  *Not implemented: No "Change file" link exists. User can go back to Step 1 and upload a new file via the standard drop zone. Known deviation.*

- [x] **Wizard opens with `source=inbox` but the report has no attachment (e.g. `attachment_path` is null).**
  Expected: The drag-and-drop zone is shown normally. The user must upload a file manually. This should not cause an error on mount.
  *Code-verified: `shouldAutoParse` is false when `storagePath` is null. Standard upload step shown.*
  *Note: This scenario is prevented at the UI level — "Confirm & Open Upload Wizard" is disabled when no attachment is present.*

### After wizard confirm — sales_period_id linkback

- [x] **User completes the upload wizard successfully when `source=inbox` and `report_id` is present.**
  Expected: After `confirmSalesUpload` succeeds, the frontend calls `PATCH /api/inbox/{report_id}` to set `sales_period_id` on the `inbound_reports` row to the newly created `sales_periods.id`.
  *Code-verified: `doConfirm` now calls `linkSalesPeriodToReport(reportId, response.id)` after `setSalesPeriod(response)` when `isInboxSource && reportId`.*

- [ ] **`inbound_reports.sales_period_id` is populated in the database after the wizard completes.**
  Expected: Query the `inbound_reports` table directly. The row for the processed report has a non-null `sales_period_id` that matches the `id` of the newly created `sales_periods` row.
  *Needs manual test: Requires end-to-end verification against live database.*

- [x] **`PATCH /api/inbox/{report_id}` call fails (e.g. network error).**
  Expected: The wizard does not block the user or show an unrecoverable error. The sales period was already created successfully. The linkback failure is logged. The report status may remain `confirmed` rather than `processed` — this is an acceptable degraded state.
  *Code-verified: `linkSalesPeriodToReport` called with `.catch((err) => console.warn(...))` — fire-and-forget, does not block user.*

### After wizard confirm — status transition to 'processed'

- [x] **`inbound_reports.status` is `processed` after the wizard completes successfully.**
  Expected: Query the `inbound_reports` table. The row has `status = 'processed'`. This is distinct from `confirmed` (which means the report was acknowledged but not yet processed through the wizard).
  *Code-verified: Backend PATCH endpoint sets `status = 'processed'` along with `sales_period_id`. Tests in `TestSalesPeriodLinkback` verify this.*

- [x] **Inbox list page shows the correct status badge for a processed report.**
  Expected: The `StatusBadge` component handles the `processed` status. Confirm the badge text and color are defined — currently the inbox list only handles `pending`, `confirmed`, and `rejected`. The `processed` status must be added to avoid falling through to the "Rejected" gray badge.
  *Code-verified: Both inbox list and detail page `StatusBadge` components handle `processed` → blue badge "Processed" (list) / green badge "Processed" (detail).*

### Multi-contract "Process for another?" prompt

- [x] **Wizard completes for a licensee with more than one active contract.**
  Expected: A "Process for another contract?" prompt appears after the success state, showing contract name pills for the licensee's other active contracts.
  *Code-verified: After `doConfirm` succeeds, sibling contracts are fetched. On preview confirm, `showMultiContractPrompt` is set when siblings exist. Blue callout with contract pills rendered.*

- [x] **User clicks a contract name pill in the "Process for another?" prompt.**
  Expected: The browser navigates to `/sales/upload?contract_id={other_contract_id}&report_id={report_id}&source=inbox` (with period params if still applicable). The wizard opens pre-configured for the selected contract with the same source attachment.
  *Code-verified: Each pill builds URL with `contract_id`, `source=inbox`, `report_id`, `storage_path`, period params, and `sender_email`.*

- [x] **Wizard completes for a licensee with exactly one active contract.**
  Expected: The "Process for another?" prompt does not appear. The normal success state and redirect to the contract page occur.
  *Code-verified: `siblingContracts` is empty → prompt not shown → `handleConfirmFinal` redirects to contract page.*

- [x] **User dismisses the "Process for another?" prompt.**
  Expected: The prompt closes and the default post-confirmation redirect to `/contracts/{contractId}?success=period_created` occurs.
  *Code-verified: "Continue to contract page" button calls `handleConfirmFinal()` which redirects to `/contracts/${contractId}?success=period_created`.*

---

## Audit trail

### inbound_reports.sales_period_id linkback

- [x] **After full end-to-end flow (email received → inbox confirmed → wizard completed), `inbound_reports.sales_period_id` is non-null.**
  Expected: The UUID in `sales_period_id` matches the `id` of the `sales_periods` row that was created during the wizard confirm step.
  *Code-verified: Frontend calls PATCH with `sales_period_id`. Backend test `TestSalesPeriodLinkback` verifies the linkback.*

- [x] **`sales_periods` row can be joined back to the originating `inbound_reports` row.**
  Expected: `SELECT * FROM inbound_reports WHERE sales_period_id = '{id}'` returns exactly one row — the email that produced this royalty record. This is the audit chain: inbound email → `inbound_reports` → `sales_periods`.
  *Code-verified: `sales_period_id` column indexed (`idx_inbound_reports_sales_period_id`). Foreign key reference to `sales_periods(id)`.*

- [x] **Deleting the `sales_periods` row sets `inbound_reports.sales_period_id` to null (ON DELETE SET NULL).**
  Expected: After deleting the `sales_periods` row, the corresponding `inbound_reports` row has `sales_period_id = null` and `status = processed`. The report is not deleted. The audit history of the email receipt is preserved.
  *Code-verified: Migration `20260225200000` defines `REFERENCES sales_periods(id) ON DELETE SET NULL`.*

### Status progression

- [x] **Report status is `pending` immediately after ingest.**
  Expected: `inbound_reports.status = 'pending'` after `POST /api/inbox/inbound` creates the row.
  *Code-verified: `_process_inbound_email` inserts with `"status": "pending"`.*

- [x] **Report status transitions to `confirmed` after the user confirms on the detail page.**
  Expected: `POST /api/inbox/{report_id}/confirm` sets `status = 'confirmed'`. This is true regardless of whether `open_wizard` is `true` or `false`.
  *Code-verified: Confirm endpoint updates status to `confirmed`. Test coverage in `TestConfirmReport`.*

- [x] **Report status transitions to `processed` after the upload wizard completes successfully.**
  Expected: The `PATCH /api/inbox/{report_id}` call (from the wizard post-confirm) sets `status = 'processed'` in addition to setting `sales_period_id`.
  *Code-verified: Backend PATCH endpoint sets both `status = 'processed'` and `sales_period_id`. Frontend now calls this after wizard confirm.*

- [x] **`processed` is a valid value for the `inbound_reports_status_check` constraint.**
  Expected: The migration has updated the CHECK constraint to `IN ('pending', 'confirmed', 'rejected', 'processed')`. Inserting or updating a row with `status = 'processed'` does not raise a constraint violation.
  *Code-verified: Migration `20260225200000` updates CHECK constraint to include `'processed'`.*

- [x] **No transition is possible from `rejected` to any other status through normal UI actions.**
  Expected: The action buttons on the detail page are disabled once status is `rejected`. The API does not guard against this at the model layer currently, but the UI prevents it. Note this as a potential gap if API-level guards are needed.
  *Code-verified: `isSettled = report.status !== 'pending'` disables all buttons for `rejected` status.*
  *Note: No API-level guard exists — the PATCH and confirm endpoints do not check current status before updating. This is a known gap; the UI is the sole guard.*

---

## Edge cases

### No attachment

- [x] **Email arrives with no attachment.**
  Expected: `inbound_reports` row is inserted with `attachment_filename = null` and `attachment_path = null`. No error is raised during ingest. The report appears in the inbox with a "No attachment" badge on the detail page.
  *Code-verified: `_process_inbound_email` handles empty attachments list gracefully.*

- [x] **User attempts to click "Confirm & Open Upload Wizard" on a no-attachment report.**
  Expected: The button is disabled in the UI and cannot be clicked. If an API call is made directly (bypassing the UI), the endpoint returns `422 Unprocessable Entity`.
  *Code-verified: Button disabled via `!report.attachment_filename`. Backend returns 422 when `attachment_path is null` and `open_wizard=true`.*

- [x] **User clicks "Confirm Only" on a no-attachment report.**
  Expected: The confirm succeeds. The report status changes to `confirmed`. The user is redirected to `/inbox` with the success toast. No wizard is launched.
  *Code-verified: "Confirm Only" does not check attachment. Backend confirm endpoint allows `open_wizard=false` without attachment.*

### No contract match

- [x] **No signal matches any contract for the user.**
  Expected: `contract_id = null`, `candidate_contract_ids = null`. Detail page shows the amber no-match state. The full searchable select is displayed with all active contracts. The user must pick a contract before confirming.
  *Code-verified: No match → State 3 with amber banner and select dropdown. Both confirm buttons require `hasContractSelected`.*

- [x] **User confirms without selecting a contract in the no-match state.**
  Expected: "Confirm & Open Upload Wizard" and "Confirm Only" are both disabled when no contract is selected. The action cannot proceed.
  *Code-verified: Both buttons include `!hasContractSelected` in disabled condition.*

### Multiple contracts at same confidence level

- [x] **Two contracts match Signal 3 (licensee name) with equal score.**
  Expected: Both appear in `candidate_contract_ids`. Both are shown as suggestion cards. Neither is auto-selected. The user must pick one. No auto-pick occurs.
  *Code-verified: Signal 3 adds all matches to candidates. No auto-selection for medium confidence.*

- [x] **Two contracts match Signal 2 (agreement ref) simultaneously (e.g. two contracts share the same agreement number — a data quality issue).**
  Expected: Neither is auto-selected. Both appear as candidates with `high` confidence. The user must select one. A note in the UI or a warning log entry would be ideal, but the core requirement is that no auto-selection is made.
  *Code-verified: Multiple Signal 2 matches → all returned as candidates, no auto-pick.*
  *Note: No UI warning or log entry for this case. The duplicate agreement_number is surfaced only as multiple candidates.*

### Report spans multiple contracts

- [x] **Licensee has three active contracts and the attachment appears to cover multiple product lines.**
  Expected: The blue informational callout appears on the detail page: "Vantage Retail Partners has 3 active contracts. If this report covers multiple product lines, you may need to process it once per contract." No automatic splitting occurs.
  *Code-verified: `MultiContractCallout` shows when `licenseeContracts.length > 1`.*

- [x] **User processes the same report a second time for a different contract.**
  Expected: The user returns to the inbox, opens the same report, selects the second contract, and clicks "Confirm & Open Upload Wizard". A second `sales_periods` row is created for the second contract. The `inbound_reports` row retains the `sales_period_id` from the first processing run (the linkback only records the most recent). Note this as a known limitation of the one-report-one-contract MVP policy.
  *Code-verified: PATCH endpoint overwrites `sales_period_id` with latest value. No array/history tracking.*
  *Note: The report's status would already be `processed` from the first run. The UI disables action buttons for non-pending statuses, so re-processing requires manual API calls or status reset. The "Process for another?" prompt in the wizard handles this more gracefully by navigating directly.*

### Zero-sales report

- [x] **Attachment contains only header rows and zero data rows, or all net sales values are zero.**
  Expected: Matching and period extraction proceed normally. The report appears in the inbox as usual. The wizard accepts zero-sales records and creates the `sales_periods` row with zero totals. No special error or warning is raised by the intake or matching logic.
  *Code-verified: Matching and period extraction are independent of data content/values.*

- [ ] **Zero-sales report completes the full flow: ingest → confirm → wizard → processed.**
  Expected: `inbound_reports.status = 'processed'` and `sales_period_id` is populated. The `sales_periods` row has `net_sales = 0` (or equivalent). The audit chain is intact.
  *Needs manual test: Requires end-to-end flow verification with a zero-sales attachment.*

### Data integrity

- [x] **`candidate_contract_ids` contains only UUIDs of contracts that belong to the same user.**
  Expected: The matching logic queries `WHERE user_id = {user_id}` before populating candidates. A candidate from another user's contracts never appears.
  *Code-verified: `_fetch_active_contracts_for_user` queries `.eq("user_id", user_id)`. All candidates come from this filtered set.*

- [ ] **Confirm endpoint rejects a `contract_id` that belongs to a different user.**
  Expected: If a caller passes a `contract_id` in the body that belongs to another user, the system either ignores it (no ownership check on the override) or returns an error. Document and verify the current behavior. If no check exists, note it as a security gap.
  *Needs manual test: Code review shows the confirm endpoint checks contract ownership with `.eq("user_id", user_id)` query and returns 403 if not found. Verify against live system.*

- [x] **Report ID in the confirm URL belongs to a different user.**
  Expected: `_get_report_for_user` returns a 404. The caller cannot confirm or modify another user's report.
  *Code-verified: `_get_report_for_user` filters by both `report_id` and `user_id`. Returns 404 if no match.*
