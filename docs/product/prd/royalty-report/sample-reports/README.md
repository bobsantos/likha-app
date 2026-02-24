# Sample Licensee Royalty Reports

Nine realistic sample reports (3 original + 6 additional) for testing Likha's Phase 1.1 spreadsheet upload and column mapping feature. Each contract has 3 reports covering different quarters and scenarios.

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

---

## File Inventory

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
