# Sample Licensee Royalty Reports

Twelve realistic sample reports (3 original + 6 additional + 3 AI mapping tests) for testing Likha's Phase 1.1 spreadsheet upload and column mapping feature. Each contract has 4 reports covering different quarters and scenarios.

---

## What These Are

Synthetic but realistic royalty reports modeled on the industry-standard format documented in
`docs/product/prd/competitive-research-royalty-landscape.md` (Section 3: Industry Standards for Royalty Reports).

No single authoritative publicly distributable template exists. Licensing International does not publish a
mandatory format. Law firm template libraries and forum-shared files vary widely. These samples are grounded
in Likha's competitive research and domain knowledge rather than copied from any one source.

Use these to:
1. Manually test the Phase 1.1 spreadsheet upload flow during development
2. Validate the spreadsheet parser handles edge cases (header detection, multi-row aggregation, summary rows)
3. Demonstrate to beta users what Likha can ingest
4. Test AI-assisted column mapping against columns that fail keyword synonym matching

---

## File Inventory

---

## Sunrise Apparel Co. — BC-2024-0042 (8% flat on net sales)

### sample-1-flat-rate.csv (original)

**Represents:** A clean, well-formatted report from a cooperative licensee. The closest to ideal input.

**Contract context:**
- Licensee: Sunrise Apparel Co.
- Contract: BC-2024-0042
- Period: Q1 2025 (January 1 - March 31)
- Rate structure: 8% flat on net sales

**Verified math:**
- Gross sales: $87,500.00
- Returns / allowances: $4,200.00
- Net sales: $83,300.00
- Correct royalty (8% of $83,300): $6,664.00
- Licensee reported royalty: $6,384.00
- Discrepancy: $280.00 under-reported (licensee appears to have calculated on $79,800 instead of $83,300)

**Parsing challenges:**
- Metadata rows at the top (Licensee Name, Contract Number, etc.) appear before the actual column header row.
  The parser must skip these and find the real header row containing "Product Description, SKU, ..." etc.
- TOTAL row at the bottom must be excluded from data aggregation.
- The "Licensee Reported Royalty" field appears as a freestanding row below the data, not as a column.
  The parser may not extract this automatically — it is more likely entered manually into the form.
- Column names ("Returns / Allowances," "Royalty Due") are standard and should map cleanly via keyword matching.

**Tests this covers:**
- Happy-path upload with recognizable column names
- Header row detection past metadata rows
- Summary row exclusion
- Discrepancy detection: system calculates $6,664.00 vs. licensee reported $6,384.00

---

### sample-1b-flat-rate-q2.csv

**Represents:** The happy-path scenario where the licensee's math is exactly correct. No discrepancy.

**Contract context:**
- Licensee: Sunrise Apparel Co.
- Contract: BC-2024-0042
- Period: Q2 2025 (April 1 - June 30)
- Rate structure: 8% flat on net sales

**Verified math:**
- Gross sales: $101,200.00
- Returns / allowances: $4,800.00
- Net sales: $96,400.00
- Correct royalty (8% of $96,400): $7,712.00
- Licensee reported royalty: $7,712.00
- Discrepancy: none

**Parsing challenges:**
- Same structure as sample-1: metadata rows before the header, single aggregated data row, TOTAL row,
  freestanding Licensee Reported Royalty row.
- Column names are identical to sample-1 and should auto-map cleanly on a second upload from this licensee.

**Tests this covers:**
- Happy-path upload: system calculates $7,712.00, licensee reported $7,712.00, no discrepancy flagged
- Validates that the zero-discrepancy branch of the reconciliation flow works correctly
- Establishes Q2 baseline data for the same contract as sample-1, useful for YTD aggregation testing

---

### sample-1c-flat-rate-q3.csv

**Represents:** A higher-volume quarter with multiple product-line rows instead of a single aggregated row.
Licensee rounds up on one row, producing a $1.00 over-report. Tests multi-row flat-rate aggregation and
the over-reporting edge case.

**Contract context:**
- Licensee: Sunrise Apparel Co.
- Contract: BC-2024-0042
- Period: Q3 2025 (July 1 - September 30)
- Rate structure: 8% flat on net sales (same rate applies to all rows regardless of product line label)

**Verified math:**
- Row 1 — Logo Tee: gross $52,000, returns $2,100, net $49,900; correct royalty $3,992.00; licensee reports $3,993.00 (rounds up)
- Row 2 — Logo Outerwear: gross $38,500, returns $3,200, net $35,300; correct royalty $2,824.00; licensee reports $2,824.00
- Row 3 — Logo Accessories: gross $14,800, returns $600, net $14,200; correct royalty $1,136.00; licensee reports $1,136.00
- Total gross: $105,300.00
- Total returns: $5,900.00
- Total net: $99,400.00
- Correct royalty (8% of $99,400): $7,952.00
- Licensee reported royalty: $7,953.00
- Discrepancy: $1.00 over-reported

**Parsing challenges:**
- Three data rows instead of one. Parser must sum all data rows before computing royalty, not treat each
  row independently with its own rate application.
- The product line label on row 3 says "Logo Accessories" — the parser must not interpret this as a category
  rate trigger. BC-2024-0042 is a flat-rate contract; all rows use 8% regardless of product line name.
- Over-reporting scenario: system calculates $7,952.00, licensee reported $7,953.00. The discrepancy is
  $1.00 in the licensor's favor. The system should flag this and allow the licensor to decide whether to
  accept or request a corrected report.

**Tests this covers:**
- Multi-row aggregation under a flat rate (three rows, one rate)
- Over-reporting detection (licensee pays more than owed — rare but handled)
- Row-level rounding by the licensee accumulating a $1.00 overage at the total level
- Seasonal volume variation: Q3 net sales ($99,400) vs. Q1 ($83,300) and Q2 ($96,400)

---

### sample-ai-test-1-sunrise-flat.csv

**Represents:** A flat-rate Sunrise Apparel report using entirely non-standard column names. No column in
the file matches the keyword synonym list. This is the baseline AI mapping test: a familiar licensee
(same contract as samples 1, 1b, 1c) submitting a report in a format that keyword matching cannot resolve
at all.

**Contract context:**
- Licensee: Sunrise Apparel Co.
- Contract: BC-2024-0042
- Period: Q3 2025 (July 1 - September 30)
- Rate structure: 8% flat on net sales

**Verified math:**
- 8 data rows. "Revenue" column = net sales (Invoice $ minus Refund $ per row).
- Row totals: 18,250 + 15,100 + 25,200 + 18,550 + 12,900 + 15,100 + 11,000 + 12,225 = $128,325.00
- Correct royalty (8% of $128,325): $10,266.00
- Licensee reported (Amt Owed sum): $10,266.00
- Discrepancy: none — math is exact

**Parsing challenges (AI mapping focus):**

1. Every column fails keyword matching. Against FIELD_SYNONYMS in spreadsheet_parser.py:
   - "Item Description" — no synonym match → `ignore`
   - "Style #" — no synonym match → `ignore`
   - "Qty Sold" — no synonym match → `ignore`
   - "Invoice $" — not a recognized gross_sales synonym ("invoice" is not in the list) → `ignore`
   - "Refund $" — "refunds" is not in the returns synonym list (only "returns," "allowances,"
     "deductions," "credits," "returns and allowances," "r&a") → `ignore`
   - "Revenue" — neither "net revenue" nor "gross revenue" is a substring of "revenue" (synonym
     matching checks whether the synonym string appears inside the column name, not the reverse);
     "total sales" is also not a substring of "revenue" → `ignore`
   - "Amt Owed" — "amount owed" is in the licensee_reported_royalty synonym list, but "amount owed"
     is not a substring of "amt owed" (abbreviation breaks the match) → `ignore`
   - Keyword mapping produces all-`ignore` result. AI must infer all mappings from column names and
     sample values.

2. Metadata rows at the top use a two-cell key/value layout but without a colon in the first cell
   ("Submitted By" has no trailing colon). The `_looks_like_metadata_row` helper requires the first
   cell to end with `:` or contain `:`. These rows will not be flagged as metadata and may compete
   with the real header row in `_detect_header_row` scoring. The real header row (row 9) has 7 string
   columns and should outscore the 2-cell metadata rows.

3. There is no explicit royalty rate column. The rate (8%) must be inferred from the contract record,
   not from the spreadsheet. AI mapping should classify "Amt Owed" as `licensee_reported_royalty`
   from sample values (small dollar amounts consistent with 8% of the Revenue column).

**Tests this covers:**
- Complete AI mapping fallback: zero keyword matches require AI to classify every meaningful column
- Abbreviation sensitivity: "Amt Owed" vs. "amount owed" demonstrates that minor variations break
  substring keyword matching and must be caught by AI
- Flat-rate happy path with AI-resolved column mapping: no discrepancy once columns are correctly mapped
- Header detection with non-colon metadata rows at the top

---

## Meridian Goods LLC — BC-2024-0078 (Apparel 10%, Accessories 12%, Footwear 8%)

### sample-2-category-rates.csv (original)

**Represents:** A multi-category report with one row per SKU. Requires aggregation before rate application.
The most structurally complex of the three samples for the parser.

**Contract context:**
- Licensee: Meridian Goods LLC
- Contract: BC-2024-0078
- Period: Q2 2025 (April 1 - June 30)
- Rate structure: Apparel 10%, Accessories 12%, Footwear 8%

**Verified math:**
- Apparel (SKU-APP-001 through 004): net sales $61,800.00 x 10% = $6,180.00
- Accessories (SKU-ACC-001 through 004): net sales $29,450.00 x 12% = $3,534.00
- Footwear (SKU-FTW-001 through 003): net sales $55,200.00 x 8% = $4,416.00
- Total net sales: $146,450.00
- Total royalty: $14,130.00
- Licensee reported royalty: $14,130.00 (matches system calculation — no discrepancy)

**Parsing challenges:**
- 11 data rows across 3 categories. The parser must aggregate by category before applying rates.
  Failure to aggregate and instead applying one rate to each row would give incorrect results for
  any contract where rates differ by category.
- The TOTAL row at the bottom must be excluded from aggregation. If accidentally included,
  net sales would be double-counted.
- Column names are standard ("Product Category," "Net Sales," "Royalty Rate," "Royalty Due").
  Keyword matching should handle these.
- The "Licensee Reported Royalty" freestanding row (same pattern as Sample 1) appears below the data.

**Tests this covers:**
- Multi-row aggregation by category (core requirement from PRD Section 3c)
- Category-rate calculation: each category bucket gets its own rate applied to aggregated net sales
- TOTAL row exclusion from aggregation
- Correct royalty is the sum of per-category calculations, not a single rate on total net sales

---

### sample-2b-category-rates-q3.csv

**Represents:** A quarter where one category (Footwear) had zero sales. All three Footwear SKUs are present
in the report with $0.00 across all columns. Licensee also makes a $14.00 arithmetic error on one
Accessories row. Tests zero-category handling and discrepancy detection.

**Contract context:**
- Licensee: Meridian Goods LLC
- Contract: BC-2024-0078
- Period: Q3 2025 (July 1 - September 30)
- Rate structure: Apparel 10%, Accessories 12%, Footwear 8%

**Verified math:**
- Apparel (SKU-APP-001 through 004):
  - Net sales: $20,250 + $10,650 + $23,900 + $15,800 = $70,600.00
  - Royalty at 10%: $7,060.00
- Accessories (SKU-ACC-001 through 004):
  - Net sales: $12,450 + $9,300 + $5,000 + $7,200 = $33,950.00
  - Correct royalty at 12%: $4,074.00
  - Licensee reported per row: $1,480 + $1,116 + $600 + $864 = $4,060.00
  - (SKU-ACC-001: licensee wrote $1,480.00 instead of $1,494.00 — arithmetic error on that row)
- Footwear (SKU-FTW-001 through 003):
  - Net sales: $0.00
  - Royalty: $0.00
- Total net sales: $104,550.00
- Correct total royalty: $11,134.00
- Licensee reported royalty: $11,120.00
- Discrepancy: $14.00 under-reported

**Parsing challenges:**
- Three Footwear rows with all-zero values must be parsed and aggregated without error. A naive parser that
  divides by net sales or skips zero rows could behave unexpectedly.
- The zero-sales category must still appear in the reconciliation output (Footwear: $0.00 net sales,
  $0.00 royalty owed) so the licensor can confirm that no Footwear sales occurred.
- The discrepancy is row-level: SKU-ACC-001 net sales ($12,450) is correct, but the licensee's Royalty Due
  value ($1,480) does not match 12% of $12,450 ($1,494). The parser aggregates net sales correctly;
  the discrepancy surfaces when Likha recalculates and compares to the licensee's reported total.

**Tests this covers:**
- Zero-sales category: Footwear rows present with $0.00, system handles gracefully without division errors
- Missing category revenue does not break category-rate aggregation for the other two categories
- Row-level arithmetic error in Accessories accumulates to a $14.00 total discrepancy
- TOTAL row exclusion still applies even when Footwear contributes $0

---

### sample-2c-category-rates-q4.csv

**Represents:** Holiday quarter with higher volume and a new SKU in each category. Licensee applies the
wrong rate (10%) to the Accessories category instead of the contractual 12%, producing a $1,223.00
under-report. This is the most financially significant discrepancy across all samples.

**Contract context:**
- Licensee: Meridian Goods LLC
- Contract: BC-2024-0078
- Period: Q4 2025 (October 1 - December 31)
- Rate structure: Apparel 10%, Accessories 12%, Footwear 8%
- New SKUs: SKU-APP-005 (Holiday Crewneck Sweater), SKU-ACC-005 (Holiday Gift Set - Accessories), SKU-FTW-004 (Limited Edition Boot)

**Verified math:**
- Apparel (SKU-APP-001 through 005):
  - Net sales: $29,800 + $17,000 + $40,500 + $27,400 + $18,800 = $133,500.00
  - Royalty at 10%: $13,350.00
  - Licensee reports: $13,350.00 (correct for this category)
- Accessories (SKU-ACC-001 through 005):
  - Net sales: $17,900 + $13,800 + $8,700 + $11,250 + $9,500 = $61,150.00
  - Correct royalty at 12%: $7,338.00
  - Licensee reports at 10%: $6,115.00 (wrong rate applied; per-row: $1,790 + $1,380 + $870 + $1,125 + $950)
- Footwear (SKU-FTW-001 through 004):
  - Net sales: $41,600 + $26,400 + $12,500 + $20,000 = $100,500.00
  - Royalty at 8%: $8,040.00
  - Licensee reports: $8,040.00 (correct for this category)
- Total net sales: $295,150.00
- Correct total royalty: $28,728.00
- Licensee reported royalty: $27,505.00
- Discrepancy: $1,223.00 under-reported

**Parsing challenges:**
- The rate mismatch is visible in the raw data: every Accessories row shows "10%" in the Royalty Rate
  column, which contradicts the contract's 12% rate. The parser should surface a per-category rate
  mismatch warning, not just a total discrepancy.
- New SKUs appear for the first time this quarter. The parser must not require SKUs to match a pre-existing
  list; any SKU in a known category should aggregate correctly.
- 14 data rows (largest dataset in the sample set) plus the TOTAL row. TOTAL row must be excluded.
- The TOTAL row's licensee royalty ($27,505) reflects the wrong rate. The system's recalculated total
  ($28,728) is the correct figure.

**Tests this covers:**
- Category-level rate mismatch: licensee's reported rate (10%) differs from contract rate (12%) for Accessories
- New SKUs in existing categories aggregate correctly without configuration changes
- Largest volume quarter across all samples — stress tests aggregation with 5 SKUs per category
- Discrepancy of $1,223.00 is the largest in the sample set, validating that the system surfaces
  material discrepancies clearly, not just cents-level rounding differences

---

### sample-ai-test-2-meridian-category.csv

**Represents:** A category-rate Meridian Goods report where column names fail keyword matching and the
category values use internal grouping names that do not match the contract's configured category names.
This tests AI mapping combined with category name reconciliation — the toughest scenario for a
category-rate contract.

**Contract context:**
- Licensee: Meridian Goods LLC
- Contract: BC-2024-0078
- Period: Q4 2025 (October 1 - December 31)
- Rate structure: Apparel 10%, Accessories 12%, Footwear 8%
- Note: the licensee's Notes row explicitly maps their grouping names to contract categories

**Verified math:**
- 11 data rows across 3 Sku Groups. "Sales $" column = net sales.
- Tops & Bottoms (Apparel at 10%): 21,300 + 30,100 + 17,600 + 26,700 = $95,700.00 → royalty $9,570.00
- Hard Accessories (Accessories at 12%): 19,300 + 14,050 + 20,200 + 8,500 = $62,050.00 → royalty $7,446.00
- Footwear (Footwear at 8%): 36,600 + 28,000 + 12,100 = $76,700.00 → royalty $6,136.00
- Total net sales: $234,450.00
- Correct total royalty: $23,152.00
- Licensee reported royalty (Calculated Fee sum): $23,152.00
- Discrepancy: none — math and rates are correct

**Parsing challenges (AI mapping focus):**

1. Column names that fail keyword matching against FIELD_SYNONYMS:
   - "Invoice #" — no synonym match → `ignore`
   - "Merchandise Description" — no synonym match → `ignore`
   - "Sku Group" — "segment," "division," "collection," "line," "category," "product line,"
     "product type" are all product_category synonyms, but none of these strings appear inside
     "sku group" → `ignore`
   - "Invoice Amt" — "gross amount" is in the gross_sales synonym list, but "gross amount" is not
     a substring of "invoice amt" → `ignore`
   - "Returned Goods" — "returns" is in the returns synonym list, but "returns" is not a substring
     of "returned goods" (the column contains "return" without the trailing 's') → `ignore`
   - "Sales $" — none of the net_sales or gross_sales synonyms ("net sales," "gross sales,"
     "net revenue," "total sales," etc.) are substrings of "sales $" → `ignore`
   - "Calculated Fee" — "calculated royalty" is in the licensee_reported_royalty synonym list, but
     "calculated royalty" is not a substring of "calculated fee" → `ignore`
   - Result: all-`ignore` from keyword matching. AI must classify all columns.

2. Category name mismatch between the report and the contract:
   - Report uses "Tops & Bottoms," "Hard Accessories," "Footwear"
   - Contract categories are "Apparel," "Accessories," "Footwear"
   - "Footwear" matches directly. "Tops & Bottoms" and "Hard Accessories" do not.
   - The licensee's Notes row ("Tops & Bottoms = Apparel (10%). Hard Accessories = Accessories (12%)")
     provides the mapping key, but the parser does not read freestanding text rows.
   - The system must either prompt the user to confirm category mapping or AI must infer the
     equivalences from the notes text and sample values with their per-row Calculated Fee amounts.

3. Metadata rows at the top use two-cell key/value layout without colons. Same header detection
   challenge as sample-ai-test-1: "Operator," "Submitted To," "Ref #," "From," "Through,"
   "Submission Date" rows will not be caught by `_looks_like_metadata_row`. The real header row
   (row 8) has 7 string columns and should score highest.

4. The TOTAL row ("TOTAL,...") must be excluded. Likha calculates correct royalty as $23,152.00;
   if the TOTAL row were included, net sales would double to $468,900.00.

**Tests this covers:**
- Complete AI mapping fallback for a category-rate contract
- "Returned Goods" vs. "returns" demonstrates that morphological variations (plural/gerund) break
  substring keyword matching
- Category name aliasing: same licensee uses different names for the same contract categories,
  requiring either AI inference or a user-confirmed category mapping step
- No discrepancy on correctly classified data validates the end-to-end category mapping path

---

## Vantage Retail Partners — BC-2025-0011 (9% flat on net sales)

### sample-3-messy-real-world.csv (original)

**Represents:** A real-world report from a licensee who uses their own format and did not receive (or ignored)
any template from the licensor. This is the format that defeats static keyword matching and validates the
need for Phase 2 AI-assisted column mapping.

**Contract context:**
- Licensee: Vantage Retail Partners
- Contract: BC-2025-0011
- Period: Q3 2025 (July 1 - September 30)
- Rate structure: 9% flat on net sales (stored as decimal 0.09 in the report, not as "9%")

**Verified math:**
- 10 data rows across 3 product lines (Kitchen & Home, Wall Decor, Soft Goods)
- Individual row net sales sum: $101,950.00
- Correct royalty (9% of $101,950): $9,175.50
- Licensee reported amount: $9,175.50 (matches — no discrepancy in royalty)
- DELIBERATE BUG IN SUMMARY ROW: the TOTAL row shows net sales as $102,050.00 (off by $100).
  This is a real-world copy-paste error in the summary. The individual row data is correct;
  the summary row has a typo in the net sales column. Parser should aggregate from data rows,
  not trust the summary row total.

**Parsing challenges (this sample is intentionally the hardest):**

1. Title rows above the real header. The first 5 rows are:
   - "VANTAGE RETAIL PARTNERS"
   - "ROYALTY STATEMENT - Q3 2025"
   - "AGREEMENT REF: VRP / BC-2025-0011"
   - "PREPARED BY: Finance Dept."
   - (blank row)
   The real header row is row 6. The parser must detect this rather than treating row 1 as the header.

2. Non-standard column names that are outside the keyword synonym list:
   - "Total Revenue" instead of "Net Sales" — not in the synonym list
   - "Refunds" instead of "Returns / Allowances" — not in the synonym list
   - "Amount Owed" instead of "Royalty Due" — not in the synonym list
   - "Gross Revenue" instead of "Gross Sales" — "Gross Revenue" IS in the synonym list (borderline case)
   - "Rate (%)" instead of "Royalty Rate" — borderline; "Rate" is in the synonym list but "Rate (%)" may not match

3. Rate stored as decimal (0.09) not as percentage string ("9%").
   The parser must handle both representations.

4. Summary rows below data that must be excluded:
   - The TOTAL data row
   - Two freestanding text rows ("Amount Owed This Period: $9,175.50" and "Please remit payment...")

5. Summary row contains an arithmetic error in the net sales column ($102,050 vs. actual $101,950).
   Likha should catch this discrepancy between its aggregated calculation and the summary row total.

**What this sample demonstrates for Phase 2 planning:**
- Static keyword matching (Phase 1.1) will fail to auto-map "Total Revenue," "Refunds," and "Amount Owed."
  The user will need to map these manually on first upload.
- AI-assisted mapping (Phase 2) should be able to infer "Total Revenue" = Net Sales and "Amount Owed" =
  Royalty Due from column names plus sample values.
- After the first upload with manual mapping, the saved mapping for "Vantage Retail Partners" will
  auto-apply on all future uploads — so the pain is one-time per licensee.

---

### sample-3b-messy-q4.csv

**Represents:** The same messy real-world format as sample-3 (non-standard column names, title rows above
the header, decimal rate representation) but with a rate discrepancy: licensee applied 8% instead of
the contractual 9%. Tests that the messy-format parsing path plus discrepancy detection work together.

**Contract context:**
- Licensee: Vantage Retail Partners
- Contract: BC-2025-0011
- Period: Q4 2025 (October 1 - December 31)
- Rate structure: 9% flat on net sales (licensee uses 0.08 in the report — wrong rate)

**Verified math:**
- 10 data rows across 3 product lines (Kitchen & Home, Wall Decor, Soft Goods)
- Individual row net sales:
  - Kitchen & Home: $13,900 + $11,000 + $8,650 + $6,200 = $39,750.00
  - Wall Decor: $9,600 + $13,050 + $16,500 = $39,150.00
  - Soft Goods: $11,500 + $18,700 + $13,400 = $43,600.00
- Total net sales: $39,750 + $39,150 + $43,600 = $122,500.00
- Correct royalty (9% of $122,500): $11,025.00
- Licensee reported royalty (8% of $122,500): $9,800.00
- Per-row royalties at 8%: $1,112 + $880 + $692 + $496 + $768 + $1,044 + $1,320 + $920 + $1,496 + $1,072 = $9,800.00
- Discrepancy: $1,225.00 under-reported
- Note: the TOTAL row net sales ($122,500) is correct in this file. Unlike sample-3, there is no summary
  row arithmetic error — the discrepancy here is purely the wrong rate.

**Parsing challenges:**
- Same non-standard column names as sample-3 that require manual mapping on first upload:
  "Total Revenue" (Net Sales), "Refunds" (Returns), "Amount Owed" (Royalty Due), "Gross Revenue" (Gross Sales),
  "Rate (%)" (Royalty Rate).
- Same title rows above the real header (rows 1-5 are title/blank; real header is row 6).
- Rate stored as decimal 0.08 — the parser must normalize this to a percentage for comparison against
  the contract's stored rate of 9%.
- If the saved column mapping from sample-3 is applied, column detection succeeds immediately. But the
  rate mismatch (0.08 vs. contract 0.09) must still be caught by the royalty recalculation step.
- Two freestanding text rows below the data ("Amount Owed This Period" and "Please remit payment")
  must be excluded from aggregation.

**Tests this covers:**
- Messy format + rate discrepancy in combination: the hardest failure mode — wrong format AND wrong math
- Saved column mapping (from sample-3 upload) applies correctly to a second upload from the same licensee
- Rate represented as 0.08 in the report differs from the contractual 0.09 — system catches this
- Discrepancy of $1,225.00 (largest in the Vantage set) surfaces correctly despite format challenges

---

### sample-3c-cleaner-q1-2026.csv

**Represents:** The same licensee (Vantage Retail Partners) after adopting standard column names following
licensor feedback. The title rows at the top are retained (licensor said to fix column names, not the
whole format). Rate is correct (9%), math is exact — no discrepancy. Tests that a format change from a
previously mapped licensee does not break the upload flow.

**Contract context:**
- Licensee: Vantage Retail Partners
- Contract: BC-2025-0011
- Period: Q1 2026 (January 1 - March 31)
- Rate structure: 9% flat on net sales

**Verified math:**
- 10 data rows across 3 product lines (Kitchen & Home, Wall Decor, Soft Goods)
- Individual row net sales:
  - Kitchen & Home: $9,700 + $7,800 + $5,650 + $3,900 = $27,050.00
  - Wall Decor: $6,400 + $8,950 + $10,900 = $26,250.00
  - Soft Goods: $7,250 + $12,200 + $8,600 = $28,050.00
- Total net sales: $27,050 + $26,250 + $28,050 = $81,350.00
- Total gross sales: $84,400.00
- Total returns: $3,050.00
- Cross-check: $84,400 - $3,050 = $81,350 ✓
- Correct royalty (9% of $81,350): $7,321.50
- Per-row royalties: $873 + $702 + $508.50 + $351 + $576 + $805.50 + $981 + $652.50 + $1,098 + $774 = $7,321.50
- Licensee reported royalty: $7,321.50
- Discrepancy: none

**Parsing challenges:**
- Title rows still present at the top in the same position as sample-3 and sample-3b (rows 1-5).
  The parser's header-detection logic must still skip these.
- Column names are now standard: "Product Description," "SKU," "Product Line," "Gross Sales,"
  "Returns / Allowances," "Net Sales," "Royalty Rate," "Royalty Due." These should keyword-match without
  manual mapping.
- The saved column mapping from sample-3 / sample-3b was built for non-standard names. The system must
  handle the case where the new standard names match automatically, even if a prior mapping existed.
  It should not blindly apply the old mapping (which mapped "Total Revenue" to Net Sales) when the column
  "Total Revenue" no longer appears.
- Rate stored as "9%" (percentage string) instead of 0.09 (decimal). This is the inverse of the
  normalization challenge in sample-3 and sample-3b. Both representations must parse correctly.
- SKUs use a new VRP-XXXX format (VRP-1021 through VRP-1030) instead of plain item numbers. Parser
  should accept any SKU string without format enforcement.

**Tests this covers:**
- Format evolution: same licensee, same title rows, but standard column names replace non-standard ones
- Saved mapping from previous uploads does not interfere when column names change to recognized synonyms
- Rate as percentage string ("9%") normalizes correctly — symmetric test to sample-3's decimal rate
- Happy-path for a previously-messy licensee: no discrepancy, clean math, improved reporting
- Q1 2026 is the first quarter outside the 2025 calendar year across all samples, confirming date handling

---

### sample-ai-test-3-vantage-tiered.csv

**Represents:** A Vantage Retail Partners report with a heavily obfuscated column structure: an extra
"Warehouse Code" column not relevant to royalty calculation, starred title rows at the top, and column
names that are all unrecognizable except one partial match. One column ("Brand Division") will keyword-
match to `product_category` via the "division" synonym — but the division values ("Kitchenware,"
"Home Goods") are not contract category names. This tests the AI mapping path where keyword matching
produces one noisy match alongside several `ignore` results.

**Contract context:**
- Licensee: Vantage Retail Partners
- Contract: BC-2025-0011
- Period: Q4 2025 (October 1 - December 31)
- Rate structure: 9% flat on net sales

**Verified math:**
- 10 data rows. "Adjusted Revenue" column = net sales (Total Rev minus Customer Refunds per row).
- Kitchenware rows (VRP-Q4-0101 through 0105):
  18,850 + 14,900 + 10,900 + 8,200 + 6,150 = $58,900.00 in net sales → royalty $5,301.00
- Home Goods rows (VRP-Q4-0106 through 0110):
  12,600 + 17,850 + 21,300 + 14,400 + 23,700 = $89,850.00 in net sales → royalty $8,086.50
- Total net sales: $148,850.00
- Correct royalty (9% of $148,850): $13,396.50
- Licensee reported (Licensee Payment sum): $13,396.50
- Total Customer Refunds: $6,250.00 (confirmed by TOTAL row's Refunds column)
- Discrepancy: none — math is exact

**Parsing challenges (AI mapping focus):**

1. Column names against FIELD_SYNONYMS:
   - "Internal Ref #" — no synonym match → `ignore`
   - "Merchandise" — no synonym match → `ignore`
   - "Brand Division" — "division" IS in the product_category synonym list; "division" is a
     substring of "brand division" → keyword-maps to `product_category`. However, the division
     values ("Kitchenware," "Home Goods") are not contract categories for BC-2025-0011 (which is a
     flat-rate contract with no category rate structure). This is a false-positive match: the column
     is better classified as `metadata` or `ignore` because it does not drive royalty calculation.
   - "Warehouse Code" — no synonym match → `ignore`
   - "Total Rev" — "net revenue" and "gross revenue" are not substrings of "total rev"; "total sales"
     is not a substring either → `ignore`
   - "Customer Refunds" — "refunds" is not in the returns synonym list (returns synonyms are
     "returns," "allowances," "deductions," "credits," "returns and allowances," "r&a") → `ignore`
   - "Adjusted Revenue" — no synonym match; "net revenue" is not a substring of "adjusted revenue"
     (the order of words prevents a match) → `ignore`
   - "Licensee Payment" — no synonym match → `ignore`
   - Summary: only "Brand Division" gets a keyword match, and it is a false positive for this flat-
     rate contract. AI must override or supplement the keyword result.

2. Title rows use `*** text ***` format (single populated cell per row with asterisk delimiters).
   These are not caught by `_looks_like_metadata_row` (no colon, only 1 non-empty cell). They will
   be skipped by `_detect_header_row` because each has string_count = 1, which is below the minimum
   of 2 string cells required to be a header candidate. The real header row (row 6) has 8 string
   columns and will be selected correctly.

3. TOTAL row is malformed: `TOTAL,,,,,6250.00,148850.00,13396.50`. The "Total Rev" column is blank
   in the TOTAL row — only Customer Refunds, Adjusted Revenue, and Licensee Payment are filled.
   `_is_summary_row` detects "TOTAL" in the first cell and excludes this row from aggregation
   regardless of its structure.

4. No royalty rate column exists in the spreadsheet. The 9% rate comes entirely from the contract
   record. The `Licensee Payment` column effectively embeds the rate (each value is 9% of
   `Adjusted Revenue`), which AI can confirm by cross-checking sample values.

**Tests this covers:**
- Keyword false-positive: "Brand Division" matches `product_category` via the "division" synonym but
  should be `metadata` or `ignore` for a flat-rate contract — AI must handle the override
- Starred title rows (non-colon, single-cell format) are correctly bypassed by header detection
- Malformed TOTAL row with sparse columns is still excluded by summary row detection
- Complete flat-rate happy path with AI-resolved mappings: no discrepancy when columns are correct
- Column names using adjective+noun structures ("Adjusted Revenue," "Customer Refunds," "Brand
  Division") that fragment compound synonyms and consistently evade substring matching

---

## Column Name Reference

The following synonyms are what the Phase 1.1 keyword matcher is trained to recognize.
Sample 3 intentionally uses names outside this list to stress-test the fallback behavior.

| Likha Field          | Recognized Synonyms (from PRD)                                                     |
|----------------------|------------------------------------------------------------------------------------|
| Net Sales            | Net Sales, Net Revenue, Net Proceeds, Royalty Base, Net Sales Amount, Total Net Sales, NS |
| Gross Sales          | Gross Sales, Gross Revenue, Gross Proceeds, Gross Amount, Total Sales              |
| Returns              | Returns, Allowances, Deductions, Credits, Returns and Allowances, R&A              |
| Product Category     | Category, Product Line, Product Type, Line, Division, Collection, Segment          |
| Royalty Rate         | Rate, Royalty Rate, Applicable Rate, Contract Rate, %                              |
| Royalty Amount       | Royalty, Royalty Due, Amount Due, Calculated Royalty, Total Royalty                |
| Territory            | Territory, Region, Market, Country, Geography                                      |

Sample 3 column names vs. synonym list:
- "Total Revenue" — NOT in the list (closest match: "Net Revenue," but "Total Revenue" is ambiguous)
- "Refunds" — NOT in the list
- "Amount Owed" — NOT in the list
- "Gross Revenue" — IN the list under Gross Sales
- "Rate (%)" — partial match on "Rate" but the "(%) " suffix may prevent exact matching

---

## Notes on Finding Real Public Samples

A search for publicly available royalty report templates was performed before generating these samples.
What exists publicly:

- Law firm template libraries (Cooley, Wilson Sonsini, etc.) publish licensing agreement templates but
  not the operational royalty report form that accompanies them.
- SlideShare has some Excel royalty templates but they are older, inconsistent, and not licensed for
  redistribution.
- Licensing International does not publish a standard form (confirmed from their public site).
- The samples above are more useful than any found public template because they are constructed to
  specifically test the parsing scenarios documented in Likha's PRD rather than being generic examples.
