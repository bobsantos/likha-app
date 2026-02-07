# Likha Backend Tests

Comprehensive test suite for the Likha backend API.

## Test Coverage

### Unit Tests: Royalty Calculator (`test_royalty_calc.py`)

**41 test cases covering:**

1. **Percentage Parsing** (5 tests)
   - Simple percentages (e.g., "8%")
   - Percentages with text (e.g., "8% of Net Sales")
   - Decimal percentages (e.g., "7.5%")
   - Invalid input handling

2. **Threshold Parsing** (5 tests)
   - Range thresholds (e.g., "$0-$2,000,000")
   - Open-ended thresholds (e.g., "$5,000,000+")
   - With and without dollar signs
   - Maximum threshold extraction

3. **Flat Rate Calculations** (6 tests)
   - Basic flat rate (8% of $100K = $8K)
   - Decimal rates
   - Zero sales
   - Large amounts
   - Decimal precision preservation

4. **Tiered Rate Calculations** (6 tests)
   - Single tier (all sales in first bracket)
   - Two-tier marginal calculation
   - Three-tier marginal calculation
   - Exact boundary conditions
   - Out-of-order tier handling
   - Zero sales

5. **Category-Specific Calculations** (6 tests)
   - Multi-category calculations
   - Single category
   - Fuzzy matching (case-insensitive)
   - Partial matching (e.g., "textiles" matches "home textiles")
   - Missing category error handling
   - Zero sales per category

6. **Main Calculator Dispatch** (5 tests)
   - Flat rate dispatch (string → flat calculator)
   - Tiered rate dispatch (list → tiered calculator)
   - Category rate dispatch (dict → category calculator)
   - Error handling for missing category breakdown
   - Invalid rate type handling

7. **Edge Cases** (4 tests)
   - Very small amounts
   - Very large amounts
   - Decimal precision maintenance
   - Negative sales (documented behavior)

8. **Real-World Scenarios** (4 tests)
   - Simple apparel license (flat 8%)
   - Home goods with volume incentives (tiered)
   - Multi-category home brand
   - High-volume licensee hitting all tiers

**Result: 41/41 tests passing** ✅

### Integration Tests: Contract Extraction (`test_extractor.py`)

**19 test cases covering:**

1. **PDF Text Extraction** (5 tests)
   - Simple contract extraction
   - Tiered contract extraction
   - Category-specific contract extraction
   - Structured content handling (tables, lists)
   - Nonexistent file error handling

2. **Claude API Extraction** (4 tests - require API key)
   - Simple flat-rate contract
   - Tiered rate structure
   - Category-specific rates
   - Full async pipeline

3. **Ground Truth Validation** (3 tests - require API key)
   - Simple contract validation (8% flat rate)
   - Tiered contract validation (multiple tiers)
   - Category contract validation (dict structure)

4. **Edge Cases** (3 tests)
   - Empty/corrupt PDF handling
   - Minimal contract text (requires API key)
   - Ambiguous contract notes (requires API key)

5. **Token Usage Tracking** (2 tests - require API key)
   - Token usage structure validation
   - Cost estimate validation (~$0.02-0.05 per extraction)

6. **Extraction Quality** (2 tests - require API key)
   - Extraction notes presence
   - Confidence score validation

**Result: 6/19 tests passing, 13 skipped (no API key)** ⚠️

## Running Tests

### All Tests
```bash
cd backend
pytest tests/ -v
```

### Unit Tests Only (No API Key Required)
```bash
pytest tests/test_royalty_calc.py -v
```

### Integration Tests Only
```bash
pytest tests/test_extractor.py -v
```

### PDF Extraction Only (No API Key Required)
```bash
pytest tests/test_extractor.py::TestPdfExtraction -v
```

### With API Key (Full Integration Tests)
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key
pytest tests/test_extractor.py -v
```

## Test Requirements

### Dependencies
- pytest>=8.0.0
- pytest-asyncio>=0.23.0
- httpx>=0.26.0

Install with:
```bash
pip install -r requirements.txt
```

### Sample Contracts
Tests use sample contracts from the spike project:
```
/Users/bobsantos/likha/dev/likha-contract-extraction-spike/sample_contracts/
├── contract_simple.pdf         # Flat 8% rate
├── contract_tiered.pdf         # Tiered rates (6%, 8%, 10%)
├── contract_categories.pdf     # Category-specific rates
└── contract_sec_smith_wesson.pdf  # Real SEC filing
```

### Environment Variables
- `ANTHROPIC_API_KEY` - Required for Claude extraction tests (optional for PDF extraction tests)
- `SUPABASE_URL` - Not needed for unit/integration tests
- `SUPABASE_KEY` - Not needed for unit/integration tests

## Test Structure

```
tests/
├── __init__.py
├── test_royalty_calc.py    # Unit tests for calculation engine
├── test_extractor.py       # Integration tests for PDF + Claude extraction
└── README.md              # This file
```

## Coverage by Feature

| Feature | Test File | Tests | Status |
|---------|-----------|-------|--------|
| Flat rate calculation | test_royalty_calc.py | 6 | ✅ Passing |
| Tiered rate calculation | test_royalty_calc.py | 6 | ✅ Passing |
| Category-specific calculation | test_royalty_calc.py | 6 | ✅ Passing |
| Parsing utilities | test_royalty_calc.py | 10 | ✅ Passing |
| Edge cases | test_royalty_calc.py | 4 | ✅ Passing |
| Real scenarios | test_royalty_calc.py | 4 | ✅ Passing |
| PDF text extraction | test_extractor.py | 5 | ✅ Passing |
| Claude extraction | test_extractor.py | 4 | ⚠️ Skipped (no API key) |
| Ground truth validation | test_extractor.py | 3 | ⚠️ Skipped (no API key) |
| Extraction edge cases | test_extractor.py | 3 | ⚠️ Partially (1/3 passing) |
| Token tracking | test_extractor.py | 2 | ⚠️ Skipped (no API key) |
| Quality metrics | test_extractor.py | 2 | ⚠️ Skipped (no API key) |

## Validation Against MVP Requirements

### Day 5 Testing Requirements (from docs/MVP.md)

- [x] **Unit tests for royalty calculator** (41 tests)
  - [x] Flat rate calculations
  - [x] Tiered rate calculations (marginal)
  - [x] Category-specific calculations

- [x] **Integration tests for extraction flow** (19 tests)
  - [x] PDF text extraction
  - [x] Claude API integration (13 tests require API key)

- [ ] **Validate against spike's ground truth** (requires API key)
  - Contract extraction tests written but skipped without API key
  - To run: Set `ANTHROPIC_API_KEY` environment variable

### Royalty Calculation Logic Validation (from MVP.md)

1. **Flat Rate:** `royalty = net_sales * parse_percentage(rate)` ✅
   - Tested in: `TestFlatRoyalty` (6 tests)
   - Example: 8% of $100,000 = $8,000

2. **Tiered Rate (marginal):** Like tax brackets ✅
   - Tested in: `TestTieredRoyalty` (6 tests)
   - Example: $3M → ($2M × 6%) + ($1M × 8%) = $200,000

3. **Category-Specific:** Different rates per category ✅
   - Tested in: `TestCategoryRoyalty` (6 tests)
   - Example: (textiles $50K × 10%) + (dinnerware $30K × 7%) = $7,100

4. **Minimum Guarantee Application:** ⚠️ Not yet implemented
   - TODO: Backend API currently doesn't apply minimum guarantee
   - Logic exists in sales endpoint but not tested

5. **Advance Payment Credit:** ⚠️ Not yet implemented
   - TODO: Backend doesn't track advance credits yet
   - Will be needed for YTD summary calculations

## Next Steps

### Immediate
1. ✅ Run tests without API key (PDF extraction + royalty calc)
2. ⚠️ Run tests with API key (full Claude extraction validation)
3. ⚠️ Implement minimum guarantee logic
4. ⚠️ Implement advance payment tracking

### Future
1. Add API endpoint integration tests (FastAPI TestClient)
2. Add database integration tests (with test Supabase instance)
3. Add tests for YTD summary calculations
4. Add tests for multi-period calculations
5. Add performance tests (large contract extraction)

## Notes

- **Decimal Precision:** All financial calculations use `Decimal` type (never `float`)
- **Test Data:** Sample contracts from spike are required for extraction tests
- **API Costs:** Claude extraction tests cost ~$0.02-0.05 per contract
- **Skip Markers:** Tests requiring API key are automatically skipped when key is not set
- **Async Tests:** pytest-asyncio handles async test execution automatically

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Ensure all existing tests pass
3. Add new test cases to this README
4. Update coverage table
5. Document any new dependencies

## Test Execution Times

- Royalty calculator tests: ~0.03s (very fast, pure Python)
- PDF extraction tests: ~0.7s (pdfplumber parsing)
- Claude extraction tests: ~5-10s per test (API calls)
- Full suite without API: ~0.8s
- Full suite with API: ~60s (due to Claude API calls)
