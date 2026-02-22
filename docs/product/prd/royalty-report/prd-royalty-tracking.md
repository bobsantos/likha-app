# PRD: Royalty Tracking — Verification, Upload, and Email Intake

**Created:** 2026-02-22
**Last Revised:** 2026-02-22
**Status:** Approved — Phase 1 ready for implementation
**Owner:** Product (Likha)
**Related Docs:** `docs/product/prd/royalty-report/competitive-research-royalty-landscape.md`

---

## Problem Statement

### The Core Insight: Verification, Not Computation

The original framing for Likha's sales reporting feature was wrong. The assumption was that the licensor's primary job is entering sales data and computing royalties. The revised understanding, validated by competitive research across every major platform in the market, is this:

**The licensor's primary job is verifying licensee-submitted royalty reports — not computing royalties from scratch.**

The workflow is:

1. Licensee sends an Excel file via email at the end of each reporting period
2. Licensor receives the spreadsheet and checks whether the licensee's math is correct
3. Licensor tracks any discrepancy between what the licensee reported and what the contract requires
4. Licensor follows up on shortfalls against minimum guarantees

Every enterprise competitor — Flowhaven, RoyaltyZone, Brainbase, Octane5 — has spreadsheet upload and discrepancy detection as core features, not v2 additions. Manual form entry is how people track royalties before they have a tool. It is the fallback, not the primary workflow.

This means Likha's current implementation (manual sales entry form) is the MVP baseline, but the following three capabilities are what convert Likha from "interesting" to "I use this every quarter":

1. **Discrepancy detection** — Record what the licensee reported; flag when it differs from the system calculation
2. **Spreadsheet upload with column mapping** — Ingest the Excel file the licensee sends directly
3. **Email intake** — Route licensee attachments to Likha automatically without any manual forwarding step

---

## User Persona

**Target User:** Emerging brand owner with 1-5 active licensing agreements, currently using spreadsheets.

**Core pain:**

- Quarterly "report crunch" — multiple licensees submit at the same time, each in a different format
- No way to quickly verify whether a licensee's submitted royalty calculation is correct
- Minimum guarantee shortfalls discovered too late (two or three quarters in)
- Royalty history locked in email threads — no structured record
- Every enterprise tool is overkill ($200-2,000+/month) and takes months to set up

**Current workflow:**

1. Receive licensee email with Excel attachment
2. Open the attachment
3. Manually re-key the numbers into a tracking spreadsheet
4. Manually verify the calculation (or not)
5. Track running YTD total in a separate column
6. Hope no formula is wrong

**What they actually need:**

1. Upload the Excel file they already have
2. See immediately whether the licensee's number matches the contract
3. See YTD progress against minimum guarantee without doing math

---

## Competitive Landscape Summary

For full competitive research, see `docs/product/prd/royalty-report/competitive-research-royalty-landscape.md`.

**Key findings relevant to this PRD:**

- Flowhaven, RoyaltyZone, Octane5, and Brainbase all have spreadsheet upload with column mapping. It is the industry-standard data entry method, not a premium feature.
- Every licensee portal built by enterprise tools has low adoption. Licensees keep emailing Excel regardless of what portal exists. Licensor-side upload (not licensee portal) is the correct architecture for Likha's target market.
- Brainbase (closest competitor) offers template generation — a pre-formatted Excel file per contract that they can ingest cleanly. This is their cleanest UX pattern.
- No competitor offers email intake. Every tool requires the licensor to manually upload the file. This is Likha's differentiation opportunity in Phase 2.
- The market gap: there is no tool priced at $29-79/month with spreadsheet upload and AI extraction. Brainbase starts at approximately $150-500/month. Excel is $0. Likha occupies an empty price point.

---

## Phase 1 Completion: Discrepancy Detection

### What It Is

The addition of a single field — what the licensee claimed to owe — alongside the system's calculation. When both are present, the system flags any difference automatically.

### Why It Matters

Without this, Likha is a royalty calculator. With this, it is a royalty verification tool. The licensor's core job is checking licensee math. A licensor who finds a $2,000 discrepancy in a single quarter has gotten more value from Likha than from any other feature. This is the minimum required for the product to be useful before beta.

### Feature Spec

**New field on SalesPeriod: `licensee_reported_royalty`**

- Type: decimal, nullable
- Meaning: The royalty amount the licensee stated on their submitted report — what they believe they owe
- This is distinct from `calculated_royalty`, which is what Likha computes from the contract terms and sales figures

**Computed fields on SalesPeriodResponse:**

`discrepancy_amount`

- Formula: `calculated_royalty - licensee_reported_royalty` when both are present, else null
- Positive value: licensee under-reported (they said they owe less than they actually do)
- Negative value: licensee over-reported (they said they owe more than they actually do)
- Zero: numbers match

`has_discrepancy`

- True when `abs(discrepancy_amount) > 0.01`
- The 1-cent tolerance handles floating-point rounding from rate calculations

### UX Spec

**Sales entry form — new field placement:**

Add "Licensee Reported Royalty" after the Net Sales field and before the submit button.

- Label: "Licensee Reported Royalty (optional)"
- Help text: "Enter the royalty amount the licensee stated on their report. Leave blank if you have not received their report yet."
- Input type: currency (number, 2 decimal places)
- The field is optional — most users will enter it after receiving the licensee's report, not at the same time as entering sales figures

**Royalty result card — discrepancy display:**

After form submission, show three lines when `licensee_reported_royalty` is present:

- "System calculated: $X,XXX.XX"
- "Licensee reported: $X,XXX.XX"
- Discrepancy line:
  - No discrepancy (or field blank): no discrepancy line shown
  - Positive (licensee under-reported): amber/orange — "Discrepancy: licensee under-reported by $X — they may owe more"
  - Negative (licensee over-reported): blue — "Discrepancy: licensee over-reported by $X"

**SalesHistoryTable — discrepancy column:**

Add a "Discrepancy" column to the table on the contract detail page.

| licensee_reported_royalty | discrepancy_amount | Display                                |
| ------------------------- | ------------------ | -------------------------------------- |
| null                      | null               | — (dash, neutral)                      |
| present                   | 0                  | Match (or checkmark)                   |
| present                   | positive           | Amber dollar amount — e.g., "+$500.00" |
| present                   | negative           | Blue dollar amount — e.g., "-$200.00"  |

**SalesPeriodModal** must be updated to include `licensee_reported_royalty` field with the same treatment as the sales entry form.

### Backend Spec

**Schema change — `sales_periods` table:**

Add column: `licensee_reported_royalty DECIMAL(15,2) NULL`

New migration file required: `supabase/migrations/[timestamp]_add_licensee_reported_royalty.sql`

**Pydantic model changes:**

`SalesPeriodCreate`:

```python
licensee_reported_royalty: Optional[Decimal] = None
```

`SalesPeriodResponse` (computed fields, not stored):

```python
discrepancy_amount: Optional[Decimal] = None
has_discrepancy: Optional[bool] = None
```

The computed fields are derived in the response serializer — they do not need to be stored in the database.

**API response shape (Phase 1 complete):**

```json
{
  "id": "...",
  "net_sales": 100000.0,
  "calculated_royalty": 8000.0,
  "licensee_reported_royalty": 7500.0,
  "discrepancy_amount": 500.0,
  "has_discrepancy": true
}
```

**Files to modify:**

- `backend/app/models/sales_period.py` — add fields
- `backend/app/routers/sales.py` — pass through new field
- `backend/tests/test_sales.py` — new test cases
- New: `supabase/migrations/[timestamp]_add_licensee_reported_royalty.sql`

**TypeScript type update:**

In `/frontend/types/index.ts`:

```typescript
licensee_reported_royalty?: number | null;
discrepancy_amount?: number | null;
has_discrepancy?: boolean;
```

**Test cases required (TDD):**

- Both fields present, calculation agrees (discrepancy_amount = 0, has_discrepancy = false)
- Both fields present, licensee under-reported by $500 (discrepancy_amount = 500, has_discrepancy = true)
- Both fields present, licensee over-reported by $200 (discrepancy_amount = -200, has_discrepancy = true)
- licensee_reported_royalty is null (discrepancy_amount = null, has_discrepancy = null)
- Rounding edge case: discrepancy of $0.005 — should not trigger has_discrepancy

### Success Criteria

- Licensor can enter what the licensee reported alongside their own sales figures
- System immediately flags whether the numbers agree
- Sales history table shows discrepancy status for all periods at a glance
- All new tests passing (TDD approach maintained)
- Beta users can use this to verify one real licensee report in their first session

---

## Phase 1.1: Spreadsheet Upload with Column Mapping

### What It Is

The ability for a licensor to upload the Excel or CSV file they receive from a licensee, map the columns to Likha's fields once, and have a sales period created automatically. Replaces manual transcription.

### Why It Matters

Without spreadsheet upload, every sales period entry requires the licensor to manually read numbers from the licensee's Excel file and type them into the form. For a licensor with 5 licensees reporting quarterly, that is 20 manual entries per year — each requiring the licensor to cross-reference the Excel file while typing. At 5-10 minutes per entry, that is 100-200 minutes per year of pure transcription.

Spreadsheet upload cuts this to 20 file uploads with guided column mapping. After the first upload per licensee, the column mapping is saved and subsequent uploads auto-apply it. The second and subsequent uploads take under a minute each.

This is the feature that converts Likha from "I tried it" to "I use it every quarter."

### Feature Spec

**Upload flow — 4 steps:**

1. Select contract and upload file (Excel or CSV)
2. Preview detected columns and map to Likha fields
3. Preview aggregated data (first 3-5 rows + totals + calculated royalty)
4. Confirm — creates the sales period

**Column mapping:**

The user sees a table: "Column in your file" | "Maps to (Likha field)"

For each detected column, a dropdown offers:

- Net Sales
- Gross Sales
- Returns / Allowances
- Product Category
- Licensee Reported Royalty
- Territory
- Ignore

Required: at least one column must be mapped to Net Sales before confirming.

Pre-population:

- If a saved mapping exists for this licensee, apply it automatically (user can still adjust)
- If no saved mapping, apply keyword-based suggestions from the synonym list (see below)

"Save this mapping for future uploads from [Licensee Name]" checkbox — checked by default.

**Multi-row aggregation:**

Many royalty reports have one row per SKU or product. The upload feature must aggregate by category (sum all rows where category = "Apparel") before applying rates. A $50K total labeled "Apparel" across 20 rows must produce the same royalty calculation as a single $50K "Apparel" row.

**Discrepancy detection during upload:**

If the uploaded file includes a column mapped to "Licensee Reported Royalty," the upload confirm step pre-populates `licensee_reported_royalty` on the resulting sales period. Discrepancy detection (Phase 1) then applies automatically.

### UX Spec

**Upload entry point:**

"Upload Report" button on the contract detail page (alongside the existing "Add Sales Period" button, which remains visible as the manual fallback).

Route: `/frontend/app/(app)/sales/upload/page.tsx?contract_id=[id]`

**Step 1 — File upload:**

Drag-and-drop zone, Excel and CSV only, max 10MB. Same visual pattern as the contract PDF upload. Reject unsupported types with a clear error message.

**Step 2 — Column mapper (`/frontend/components/sales-upload/column-mapper.tsx`):**

- Table with one row per detected column
- Dropdown in each row for Likha field mapping
- Required fields highlighted if unmapped (Net Sales is always required)
- Auto-suggested mappings shown as pre-selected dropdown values
- "Save mapping" checkbox below the table

**Step 3 — Data preview (`/frontend/components/sales-upload/upload-preview.tsx`):**

- First 3-5 rows shown with mapped field labels as column headers
- Aggregated totals below the preview rows (net sales by category, total net sales)
- System-calculated royalty displayed (same result card design as manual entry)
- Discrepancy shown if licensee reported royalty is present in the file
- "Confirm" / "Edit mapping" / "Cancel" actions

**Step 4 — Confirmation:**

Creates the sales period. Redirects to the contract detail page with the new period visible in the history table.

### Backend Spec

**Endpoints:**

```
POST /api/sales/upload/{contract_id}
  - Accept multipart: file, period_start, period_end
  - Returns: detected columns, preview rows (first 5), suggested mappings
  - Does NOT create a sales period — this is the preview step only

POST /api/sales/upload/{contract_id}/confirm
  - Accept: column_mapping, period_start, period_end
  - Saves column mapping per licensee
  - Calculates royalty on confirmed data
  - Creates and returns SalesPeriodResponse

GET /api/sales/upload/mapping/{contract_id}
  - Returns saved column mapping for this contract's licensee, if one exists
```

**Spreadsheet parser service: `backend/app/services/spreadsheet_parser.py`**

`parse_upload(file_bytes, filename) -> ParsedSheet`

- Detect file type from extension and magic bytes (xlsx, xls, csv)
- Find the header row (handle files with title rows above actual data headers)
- Return: column names list, sample rows (up to 10), total row count

`apply_mapping(parsed_sheet, column_mapping) -> SalesData`

- Map detected columns to Likha fields per the confirmed mapping
- Aggregate rows by category (sum net_sales for all rows with the same category value)
- Return: net_sales total, category_sales dict, licensee_reported_royalty if present

Handle encoding issues: Windows-1252, UTF-8 with BOM, ASCII.

**Column name synonyms for auto-suggestion (from competitive research):**

- Net Sales: "Net Sales," "Net Revenue," "Net Proceeds," "Royalty Base," "Net Sales Amount," "Total Net Sales," "NS"
- Gross Sales: "Gross Sales," "Gross Revenue," "Gross Proceeds," "Gross Amount," "Total Sales"
- Returns: "Returns," "Allowances," "Deductions," "Credits," "Returns and Allowances," "R&A"
- Product Category: "Category," "Product Line," "Product Type," "Line," "Division," "Collection," "Segment"
- Royalty Amount: "Royalty," "Royalty Due," "Amount Due," "Calculated Royalty," "Total Royalty"
- Territory: "Territory," "Region," "Market," "Country," "Geography"

**`licensee_column_mappings` table:**

```sql
CREATE TABLE licensee_column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  licensee_name TEXT NOT NULL,
  column_mapping JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

New migration: `supabase/migrations/[timestamp]_add_licensee_column_mappings.sql`

**Files to create:**

- `backend/app/services/spreadsheet_parser.py`
- `backend/app/routers/sales_upload.py` (or extend `sales.py`)
- `backend/tests/test_spreadsheet_parser.py`
- `supabase/migrations/[timestamp]_add_licensee_column_mappings.sql`

**Dependencies to add:**

```
openpyxl   # read .xlsx files
xlrd       # read legacy .xls files
```

**Test cases required (TDD):**

- Parse xlsx with standard columns — returns correct column names and row count
- Parse csv with non-standard column names — returns raw column names unchanged
- Handle file with title rows above actual headers — finds the real header row
- Aggregate multi-row report by category — sums net_sales per category
- Apply saved mapping on second upload — auto-maps columns, no user input needed
- Reject unsupported file types with a clear error message
- Handle encoding: Windows-1252 encoded csv parses without error

### Success Criteria

- Licensor can upload an Excel file received from a licensee and create a sales period in under 3 minutes on first use
- Column mapping is saved per licensee — second upload auto-applies with no mapping step
- Multi-row reports are aggregated by category before royalty calculation
- Discrepancy detection (Phase 1) works when the uploaded file includes a royalty amount column
- All tests passing (TDD approach maintained)
- Time to enter one sales period: under 3 minutes (vs. 5-10 minutes manual)

---

## Phase 2: AI Column Mapping + Template Generation + Email Intake

### Template Generation

**What it is:** An endpoint that generates a pre-formatted Excel file for a specific contract. The licensor downloads this file and emails it to their licensee. When the licensee completes it and returns it, Likha can ingest it with zero column mapping because the format is known.

**Why it matters:** This is Brainbase's differentiator in the enterprise market. For Likha it creates a clean, zero-friction ingest path. It also eliminates the "my licensee uses a weird format" problem for any licensee who adopts the template.

**Endpoint spec:**

```
GET /api/contracts/{id}/report-template
  - Generates a pre-formatted Excel file (.xlsx) for the contract
  - Returns as file download (Content-Disposition: attachment)
```

**Template structure:**

- Tab 1: Instructions — licensee fills in Tab 2; contract reference numbers included
- Tab 2: Sales Report — columns match the contract's rate structure:
  - Flat rate: Period, Gross Sales, Returns, Net Sales, Royalty Rate (pre-filled), Calculated Royalty (formula)
  - Category rates: one section per category with category name and rate pre-filled
  - Tiered: Net Sales column + note explaining tiers apply automatically
- Tab 3: Summary — auto-totals from Tab 2, royalty due, signature field
- Tab 4: Rate Schedule — royalty rate table from the contract, read-only reference

**Frontend:** "Download Report Template" button on the contract detail page.

### AI-Assisted Column Mapping

**What it is:** Using Claude to suggest column mappings instead of the static keyword synonym matching from Phase 1.1. After parsing the file, Likha sends the detected column names and sample values to Claude and asks it to map each column to a Likha field. The result pre-fills the column mapper UI. The user confirms or adjusts before proceeding.

**Why it matters:** Static synonym matching handles obvious cases ("Net Sales" → Net Sales). AI mapping handles the cases that defeat static matching: abbreviations, non-English column names, compound columns, inconsistent formatting. A licensor who receives reports from 5 different licensees with 5 different formats will benefit more from AI mapping than any other feature.

**Prompt design:**

"These are column headers from a licensing royalty report. Map each column to one of these Likha fields: [field list with descriptions]. Here are sample values for context: [column name: [value1, value2, value3]]. Return a JSON object where each key is a detected column name and each value is the Likha field name or 'ignore' if it does not map to any field."

**Implementation note:** Claude API call per upload. At 100 uploads per month this is negligible cost. Log usage per user for monitoring.

**This replaces** the static keyword synonym matching from Phase 1.1. Phase 1.1 ships with synonym matching; Phase 2 upgrades it to AI-assisted.

### Email Intake

**What it is:** A dedicated inbound email address per licensor account (`reports-[short-id]@likha.app`). Licensees are told to CC or forward their royalty reports to this address. Likha parses the attachments automatically and creates draft tasks for the licensor to review and confirm.

**Why it matters:** Every enterprise licensing tool has tried licensee portals. Every enterprise licensing tool has failed to get licensees to adopt them. G2 reviews across Flowhaven, RoyaltyZone, and Brainbase consistently report that 40-60% of licensees still email Excel files regardless of what portal is available. The licensee behavior problem is not solvable by building a better portal. Email intake accepts licensee behavior as a constant and automates around it.

No competitor offers this workflow. This is Likha's differentiation: instead of asking licensees to change, Likha routes their existing email behavior into a structured review queue.

**Design decision: forwarding address, not OAuth inbox access.**

Do not build OAuth inbox integration. Requiring licensors to grant Likha access to their email inbox is a significant permission ask that many users will refuse — IT policy conflicts, GDPR exposure from reading unrelated emails, and general reluctance to grant mail access to a new service. The forwarding address approach requires no inbox permissions. The licensor adds one email address to their licensee communications. No access to their inbox is ever required.

**Auto-matching is required in the MVP of this feature** (not a follow-up enhancement). The email intake feature only delivers value if inbound reports are routed to the correct contract without manual intervention. Manual contract assignment for every email defeats the purpose. Auto-matching works by comparing the sender email address against `licensee_email` fields stored on contracts. If a match is found, the report is pre-assigned. If no match is found, the licensor manually assigns from a dropdown on the review page. The auto-match rate will increase over time as licensee emails are captured.

**Dependency:** This feature requires Phase 1.1 (spreadsheet parser, column mapping, saved per-licensee mappings) to be complete and validated before building. Email intake is Phase 1.1 upload with the file arriving automatically — the parsing infrastructure must exist first.

### Backend Spec (Email Intake)

**Inbound email service:**

Use Postmark Inbound, SendGrid Inbound Parse, or Mailgun — they all offer a webhook that POSTs email data (sender, subject, attachments as base64) to an endpoint you specify.

Each licensor account gets a unique inbound address generated on signup: `reports-[short-id]@likha.app`. Store this in `user_settings` or a `inbound_address` field on the users table.

**Webhook endpoint:**

```
POST /api/email-intake/inbound
  - Authenticate webhook source (shared HMAC secret from email service)
  - Extract Excel/CSV attachments (ignore PDFs, images, calendar files)
  - For each valid attachment:
    - Attempt to match sender email to licensee_email on any contract for this user
    - Attempt to detect reporting period from filename or email subject
    - Run attachment through Phase 1.1 spreadsheet parser
    - Apply saved column mapping if one exists for the matched licensee
    - Create InboundReport record with status: pending_review
  - If no valid attachment: create record with status: no_attachment
  - No silent failures — every inbound email produces a record
```

**`inbound_reports` table:**

```sql
CREATE TABLE inbound_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  sender_email TEXT NOT NULL,
  email_subject TEXT,
  filename TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  matched_contract_id UUID REFERENCES contracts(id),
  detected_period_start DATE,
  detected_period_end DATE,
  parsed_data JSONB,
  status TEXT NOT NULL CHECK (status IN (
    'pending_review', 'confirmed', 'rejected', 'no_attachment'
  )),
  created_sales_period_id UUID REFERENCES sales_periods(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

New migration: `supabase/migrations/[timestamp]_add_inbound_reports.sql`

**Confirmation endpoint:**

```
POST /api/email-intake/{report_id}/confirm
  - Accept: contract_id, period_start, period_end, column_mapping (if not auto-applied)
  - Calculate royalty on confirmed data
  - Create SalesPeriod record
  - Update inbound_reports: status = confirmed, created_sales_period_id = [new id]
```

**Rejection endpoint:**

```
POST /api/email-intake/{report_id}/reject
  - Mark record as rejected with optional note
  - Record remains visible in history; no sales period is created
```

**`licensee_email` field on contracts:**

Add `licensee_email TEXT NULL` to the contracts table. This is the email address the licensor uses to identify which contract an inbound report belongs to.

New migration: `supabase/migrations/[timestamp]_add_licensee_email_to_contracts.sql`

### Frontend Spec (Email Intake)

**Settings page — inbound address display:**

A section on the settings page showing the licensor's unique inbound address.

- Display: "Ask your licensees to forward reports to: reports-[id]@likha.app"
- Copy-to-clipboard button
- Explainer text: "When a licensee sends their royalty report to this address, it will appear here for your review. No email account access required."

**Inbox view: `/frontend/app/(app)/inbox/page.tsx`**

- List of inbound reports sorted by received_at (newest first)
- Each item shows: sender email, filename, received date, matched contract name or "unmatched," detected period
- Status badges: Pending Review, Confirmed, Rejected, No Attachment
- Empty state: "No reports received yet. Share your inbound address with your licensees."

**Review page: `/frontend/app/(app)/inbox/[report_id]/page.tsx`**

- Email metadata header (from address, subject, date received)
- If column mapping is needed: column mapper component (reuse Phase 1.1)
- Contract assignment dropdown (pre-filled if auto-matched; required field if not)
- Period date fields (pre-filled if auto-detected; required if not)
- Data preview component (reuse Phase 1.1)
- System-calculated royalty card
- Confirm / Reject action buttons

**Dashboard badge:**

If any `inbound_reports` records exist with status `pending_review`, show a count badge on the dashboard. Clicking routes to `/inbox`.

### Success Criteria (Phase 2)

**Template generation:**

- Licensor can generate a template, email it to a licensee, receive it back, and upload it with zero manual column mapping
- Template format is understandable by a licensee without separate instructions

**AI-assisted column mapping:**

- AI suggestions reduce manual mapping time from 5-10 minutes to under 1 minute for non-standard column names
- AI suggestions are correct (no adjustment needed) for at least 80% of standard royalty report formats

**Email intake:**

- Licensor receives unique inbound address on signup (available in settings)
- Forwarded Excel attachment creates a pending review task within 60 seconds
- Auto-matched reports (known sender email, saved mapping, readable period) require only one-click confirm
- Unmatched reports show sufficient context (sender, filename, preview) for manual assignment in under 2 minutes
- Zero silent failures — every inbound email produces a visible record

---

## Data Model Changes Across All Phases

### Phase 1 — `sales_periods` table

| Column                      | Type               | Change     |
| --------------------------- | ------------------ | ---------- |
| `licensee_reported_royalty` | DECIMAL(15,2) NULL | New column |

Computed fields on response (not stored):

- `discrepancy_amount` — calculated_royalty minus licensee_reported_royalty
- `has_discrepancy` — true when abs(discrepancy_amount) > 0.01

Migration: `supabase/migrations/[timestamp]_add_licensee_reported_royalty.sql`

### Phase 1.1 — new table

**`licensee_column_mappings`**

| Column           | Type           | Notes                                   |
| ---------------- | -------------- | --------------------------------------- |
| `id`             | UUID PK        |                                         |
| `user_id`        | UUID NOT NULL  |                                         |
| `licensee_name`  | TEXT NOT NULL  | Matched against contracts.licensee_name |
| `column_mapping` | JSONB NOT NULL | {detected_column: likha_field}          |
| `created_at`     | TIMESTAMPTZ    |                                         |
| `updated_at`     | TIMESTAMPTZ    |                                         |

Migration: `supabase/migrations/[timestamp]_add_licensee_column_mappings.sql`

### Phase 2 — `contracts` table and new table

**`contracts` table change:**

| Column           | Type      | Change                                              |
| ---------------- | --------- | --------------------------------------------------- |
| `licensee_email` | TEXT NULL | New column — used for auto-matching inbound reports |

Migration: `supabase/migrations/[timestamp]_add_licensee_email_to_contracts.sql`

**`inbound_reports`** — new table

| Column                    | Type                 | Notes                                              |
| ------------------------- | -------------------- | -------------------------------------------------- |
| `id`                      | UUID PK              |                                                    |
| `user_id`                 | UUID NOT NULL        |                                                    |
| `sender_email`            | TEXT NOT NULL        | Who sent the email                                 |
| `email_subject`           | TEXT                 |                                                    |
| `filename`                | TEXT                 | Attachment filename                                |
| `received_at`             | TIMESTAMPTZ NOT NULL |                                                    |
| `matched_contract_id`     | UUID NULL FK         | Auto-matched or manually assigned                  |
| `detected_period_start`   | DATE NULL            | Parsed from filename or subject                    |
| `detected_period_end`     | DATE NULL            |                                                    |
| `parsed_data`             | JSONB NULL           | Output from spreadsheet parser                     |
| `status`                  | TEXT NOT NULL        | pending_review, confirmed, rejected, no_attachment |
| `created_sales_period_id` | UUID NULL FK         | Set on confirm                                     |
| `created_at`              | TIMESTAMPTZ          |                                                    |

Migration: `supabase/migrations/[timestamp]_add_inbound_reports.sql`

---

## Implementation Order and Dependencies

```
Phase 1 (Discrepancy Detection)
  - No dependencies — can ship immediately
  - Required before beta testing

Phase 1.1 (Spreadsheet Upload)
  - Depends on Phase 1 (discrepancy detection works on upload too)
  - Required before paid user conversion
  - Template generation can be built in parallel (no parser dependency)

Phase 2 (Email Intake)
  - Depends on Phase 1.1 (parser + column mapping must be validated first)
  - AI column mapping replaces Phase 1.1 synonym matching (non-breaking upgrade)
  - Email intake is Phase 1.1 upload with automated file delivery
```
