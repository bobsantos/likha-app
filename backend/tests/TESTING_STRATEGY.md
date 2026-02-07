# Testing Strategy: Mocked vs Real API

## Overview

The Likha backend has two types of tests for the Anthropic API:

1. **Mocked Tests** (`test_extractor_mocked.py`) - Fast, free, offline-capable
2. **Real API Tests** (`test_extractor.py`) - Slow, costly, requires API key

## Cost Comparison

### Without Mocking (Real API Only)

```
Development scenario:
- 10 developers
- Each runs tests 20 times/day
- 5 extraction tests per run
- $0.03 per extraction

Daily cost: 10 × 20 × 5 × $0.03 = $30/day
Monthly cost: $30 × 20 working days = $600/month
```

### With Mocking (Default)

```
Development scenario:
- Same 10 developers
- Same 20 test runs/day
- 14 mocked tests + 5 real API tests (run once/day)
- Mocked tests: $0
- Real API tests: 10 × 1 × 5 × $0.03 = $1.50/day

Daily cost: $1.50/day
Monthly cost: $30/month

Savings: $570/month (95% reduction)
```

## Test File Comparison

### test_extractor_mocked.py (NEW)

**Purpose**: Unit tests with zero API cost

**Features**:
- 14 comprehensive tests
- Tests all rate types (flat, tiered, category)
- Tests edge cases (null fields, markdown fences)
- Verifies API call parameters
- Tests error handling
- Runs in ~0.36 seconds
- No internet required
- No API key required

**Run with**:
```bash
pytest tests/test_extractor_mocked.py
```

**Classes**:
- `TestMockedClaudeExtraction` - Core extraction tests
- `TestMockingHelpers` - Helper utilities
- `TestMockingPatterns` - Different mocking approaches
- `TestMockingBestPractices` - Verification and error handling

### test_extractor.py (EXISTING)

**Purpose**: Integration tests with real API

**Features**:
- Tests against actual sample contracts
- Validates real Claude API behavior
- Ground truth validation
- Token usage tracking
- Requires ANTHROPIC_API_KEY
- Requires sample PDFs
- Runs in ~30-60 seconds (network dependent)
- Costs ~$0.15-0.30 per full run

**Run with**:
```bash
# Requires API key
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/test_extractor.py
```

**Classes**:
- `TestPdfExtraction` - PDF parsing (no API cost)
- `TestClaudeExtraction` - Real API extraction (costs money)
- `TestGroundTruthValidation` - Validate against known contracts (costs money)
- `TestExtractionEdgeCases` - Edge cases with real API (costs money)
- `TestTokenUsageTracking` - Token tracking (costs money)

## Recommended Workflow

### During Active Development

```bash
# Run mocked tests frequently (fast, free)
pytest tests/test_extractor_mocked.py

# Run royalty calc tests (also fast, free)
pytest tests/test_royalty_calc.py

# Run all non-API tests
pytest -m "not extraction"
```

### Before Committing

```bash
# Run all mocked tests
pytest tests/test_extractor_mocked.py tests/test_royalty_calc.py

# Optionally run ONE real API test to verify
pytest tests/test_extractor.py::TestClaudeExtraction::test_extract_simple_contract
```

### Before Deploying

```bash
# Run full suite including real API tests
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/

# Or run just integration tests
pytest -m "extraction"
```

### In CI/CD

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run mocked tests (no API cost)
        run: pytest tests/test_extractor_mocked.py tests/test_royalty_calc.py

  integration-tests:
    runs-on: ubuntu-latest
    # Only run on main branch or manually
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run real API tests
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: pytest tests/test_extractor.py -k "test_extract_simple_contract"
```

## Test Coverage Comparison

### Mocked Tests Cover

✅ Flat rate extraction
✅ Tiered rate extraction
✅ Category-specific extraction
✅ Null/missing field handling
✅ Markdown code fence parsing
✅ API call parameter verification
✅ Error handling
✅ Token usage tracking
✅ Different confidence scores
✅ Extraction notes
✅ Full pipeline (async)
✅ Multiple mocking patterns

### Real API Tests Cover

✅ Actual PDF parsing
✅ Real Claude API behavior
✅ Ground truth validation
✅ Real-world sample contracts
✅ Actual token costs
✅ API error responses
✅ Network issues
✅ SEC filing extraction

## When to Use Each

### Use Mocked Tests For:

- **Unit testing** - Testing individual functions
- **Development** - Rapid iteration and debugging
- **TDD** - Test-driven development
- **Refactoring** - Safe code changes
- **CI/CD** - Fast feedback on every commit
- **Offline work** - No internet required
- **Edge cases** - Test scenarios that are hard to create with real API

### Use Real API Tests For:

- **Integration testing** - End-to-end validation
- **Regression testing** - Verify behavior against known contracts
- **Pre-deployment** - Final validation before production
- **API changes** - Verify after Claude API updates
- **New contract types** - Validate extraction on new formats
- **Performance testing** - Measure actual token usage
- **Ground truth** - Establish baseline expectations

## Migration Guide

If you have existing tests using real API, migrate them to mocked tests:

### Before (Real API)

```python
@pytest.mark.skipif(
    not os.getenv("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY not set"
)
def test_extract_flat_rate():
    text = extract_text_from_pdf("sample.pdf")
    extracted, _ = extract_terms_with_claude(text)
    assert extracted.royalty_rate == "8%"
```

### After (Mocked)

```python
def test_extract_flat_rate(mocker):
    import json

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps({
        # ... full response schema
        "royalty_rate": "8%",
        "confidence_score": 0.95,
        "extraction_notes": []
    }))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("test text")
    assert extracted.royalty_rate == "8%"
```

Or use fixtures:

```python
def test_extract_flat_rate(mock_anthropic_flat_rate):
    extracted, _ = extract_terms_with_claude("test text")
    assert extracted.royalty_rate == "8%"
```

## Performance Comparison

### Real API Tests (test_extractor.py)

```
$ time pytest tests/test_extractor.py -k "TestClaudeExtraction"

5 passed in 45.23s
Cost: ~$0.15
```

### Mocked Tests (test_extractor_mocked.py)

```
$ time pytest tests/test_extractor_mocked.py

14 passed in 0.36s
Cost: $0.00
```

**Speed improvement: 125x faster**
**Cost reduction: 100% (free)**

## Quick Reference

### Run all tests (mocked + real)
```bash
pytest tests/
```

### Run only mocked tests (fast, free)
```bash
pytest tests/test_extractor_mocked.py
```

### Run only real API tests (slow, costs money)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/test_extractor.py -k "TestClaudeExtraction"
```

### Run all tests except API tests
```bash
pytest -m "not extraction"
```

### Run a single mocked test
```bash
pytest tests/test_extractor_mocked.py::TestMockedClaudeExtraction::test_extract_terms_with_mock_flat_rate
```

### Run all mocked tests with verbose output
```bash
pytest tests/test_extractor_mocked.py -v
```

### Run tests and show print statements
```bash
pytest tests/test_extractor_mocked.py -v -s
```

## Summary

**Default approach**: Use mocked tests for 99% of development work.

**Mocked tests provide**:
- ✅ Zero cost
- ✅ Fast execution (~0.36s)
- ✅ Offline capability
- ✅ Deterministic results
- ✅ Easy edge case testing
- ✅ No rate limits

**Reserve real API tests for**:
- 🔍 Integration validation
- 🔍 Pre-deployment checks
- 🔍 New contract types
- 🔍 API behavior verification

**Expected savings**: ~$570/month for a 10-person team.

## Additional Resources

- **Mocking Guide**: See `MOCKING_GUIDE.md` for detailed examples
- **Test Examples**: See `test_extractor_mocked.py` for all patterns
- **Real API Tests**: See `test_extractor.py` for integration tests
- **pytest-mock docs**: https://pytest-mock.readthedocs.io/
