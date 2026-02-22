# Sample Licensee Royalty Reports

Three realistic sample reports for testing Likha's Phase 1.1 spreadsheet upload and column mapping feature.

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

### sample-1-flat-rate.csv

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

### sample-2-category-rates.csv

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

### sample-3-messy-real-world.csv

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
