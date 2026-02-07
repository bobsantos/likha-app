# Likha Backend Tests

Comprehensive test suite for the Likha backend API with **zero API costs**.

## Test Philosophy

All tests use **mocked API calls** to avoid costs and API key requirements. This means:
- No ANTHROPIC_API_KEY needed
- No API costs during testing
- Fast test execution
- Reliable, deterministic results

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

### Unit Tests: Contract Extraction (`test_extractor.py`)

**25 test cases covering:**

1. **PDF Text Extraction** (6 tests)
   - Simple contract extraction
   - Tiered contract extraction
   - Category-specific contract extraction
   - Structured content handling (tables, lists)
   - Nonexistent file error handling
   - Empty/corrupt PDF handling

2. **Claude API Extraction - Mocked** (8 tests)
   - Simple flat-rate contract
   - Tiered rate structure
   - Category-specific rates
   - Markdown code fence handling
   - Null fields handling
   - Full async pipeline
   - Minimal contract text
   - Ambiguous contract handling

3. **Token Usage Tracking** (3 tests)
   - Token usage structure validation
   - Cost estimate validation (~$0.02-0.05 per extraction)
   - Different token usage scenarios

4. **Extraction Quality** (2 tests)
   - Extraction notes presence
   - Confidence score validation

5. **API Call Verification** (2 tests)
   - Verify correct API parameters
   - Error handling simulation

6. **Mocking Patterns** (4 tests)
   - Fixture-based mocking
   - Inline mocking
   - Predefined constants
   - Parametrized mocking

**Result: 25/25 tests passing** ✅

## Running Tests

### All Tests
```bash
cd backend
pytest tests/ -v
```

### Unit Tests Only - Royalty Calculator
```bash
pytest tests/test_royalty_calc.py -v
```

### Unit Tests Only - Extraction (Mocked API)
```bash
pytest tests/test_extractor.py -v
```

### PDF Extraction Only (No API Mocking)
```bash
pytest tests/test_extractor.py::TestPdfExtraction -v
```

### Run All Tests (No API Key Needed!)
```bash
pytest tests/ -v
```

## Test Requirements

### Dependencies
- pytest>=8.0.0
- pytest-asyncio>=0.23.0
- pytest-mock>=3.15.0
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
- No environment variables needed for testing!
- All Anthropic API calls are mocked
- `SUPABASE_URL` - Not needed for unit tests
- `SUPABASE_KEY` - Not needed for unit tests

## Test Structure

```
tests/
├── __init__.py
├── test_royalty_calc.py    # Unit tests for calculation engine
├── test_extractor.py       # Unit tests for PDF + mocked Claude extraction
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
| PDF text extraction | test_extractor.py | 6 | ✅ Passing |
| Claude extraction (mocked) | test_extractor.py | 8 | ✅ Passing |
| Token tracking | test_extractor.py | 3 | ✅ Passing |
| Quality metrics | test_extractor.py | 2 | ✅ Passing |
| API verification | test_extractor.py | 2 | ✅ Passing |
| Mocking patterns | test_extractor.py | 4 | ✅ Passing |

## Validation Against MVP Requirements

### Day 5 Testing Requirements (from docs/MVP.md)

- [x] **Unit tests for royalty calculator** (41 tests)
  - [x] Flat rate calculations
  - [x] Tiered rate calculations (marginal)
  - [x] Category-specific calculations

- [x] **Unit tests for extraction flow** (25 tests)
  - [x] PDF text extraction
  - [x] Claude API integration (fully mocked)
  - [x] Token usage tracking
  - [x] Error handling

- [x] **Validate against expected behavior** (all mocked)
  - Contract extraction tests use realistic mock responses
  - All tests run without API key
  - No API costs incurred

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

## Mocking Approach

### Why Mocked Tests?

1. **No API Costs**: Real Claude API calls cost $0.02-0.05 per extraction
2. **No API Key Required**: Tests run in any environment
3. **Fast Execution**: 0.8s for all tests vs 60s with real API
4. **Deterministic**: Same results every time
5. **Easier Debugging**: Full control over responses

### Mock Response Structure

Tests use predefined mock responses that match real API responses:

```python
MOCK_FLAT_RATE_RESPONSE = {
    "licensor_name": "Test Licensor Inc",
    "licensee_name": "Test Licensee Corp",
    "royalty_rate": "8% of Net Sales",
    "confidence_score": 0.95,
    "extraction_notes": ["All key terms clearly stated"]
    # ... other fields
}
```

### Creating New Tests

When adding new extraction tests:

1. **Use the `mocker` fixture** from pytest-mock
2. **Mock the Anthropic client** with realistic responses
3. **Verify API call parameters** (model, max_tokens, etc.)
4. **Test both success and error cases**

Example:
```python
def test_new_extraction_case(self, mocker):
    import json

    # Create mock response
    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    # Setup mock client
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    # Run test
    extracted, token_usage = extract_terms_with_claude("test text")

    # Verify results
    assert extracted.licensor_name == "Test Licensor Inc"
```

## Real API Testing (Optional)

If you want to test against the real Claude API:

1. **Create a separate test file** (e.g., `test_extractor_real_api.py`)
2. **Mark tests with custom marker** (e.g., `@pytest.mark.real_api`)
3. **Add API key requirement** in the test
4. **Document the costs** in test docstrings

This keeps real API tests separate from the main test suite.

## Next Steps

### Immediate
1. ✅ Run all tests without API key (fast, no cost)
2. ⚠️ Implement minimum guarantee logic
3. ⚠️ Implement advance payment tracking

### Future
1. Add API endpoint integration tests (FastAPI TestClient)
2. Add database integration tests (with test Supabase instance)
3. Add tests for YTD summary calculations
4. Add tests for multi-period calculations
5. Optional: Add performance tests with real API

## Notes

- **Decimal Precision:** All financial calculations use `Decimal` type (never `float`)
- **Test Data:** Sample contracts from spike are required for PDF extraction tests
- **Mock Responses:** Match the structure of real Claude API responses
- **No API Costs:** All extraction tests use mocked API calls
- **Fast Execution:** Full test suite runs in under 1 second

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Use mocked API calls for extraction tests
3. Ensure all existing tests pass
4. Add new test cases to this README
5. Update coverage table
6. Document any new dependencies

## Test Execution Times

- Royalty calculator tests: ~0.03s (very fast, pure Python)
- PDF extraction tests: ~0.2s (pdfplumber parsing)
- Mocked Claude extraction tests: ~0.5s (no API calls)
- **Full suite: ~0.8s** (all tests, all mocked)

## Troubleshooting

### Import Errors
- Ensure virtual environment is activated
- Run `pip install -r requirements.txt`

### Mock Errors
- Verify `pytest-mock` is installed
- Check that `mocker` fixture is passed to test function
- Ensure mock responses match expected structure

### PDF Extraction Errors
- Check that sample contracts exist in spike directory
- Verify pdfplumber is installed
- Tests gracefully skip if contracts not found

## Related Documentation

- See `MOCKING_GUIDE.md` for detailed mocking patterns (if exists)
- See `TESTING_STRATEGY.md` for overall testing approach (if exists)
- See `docs/MVP.md` for MVP requirements
