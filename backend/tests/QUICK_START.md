# Quick Start: Mocked API Testing

## TL;DR

**Run tests without API costs:**

```bash
# All mocked tests (fast, free)
pytest tests/test_extractor_mocked.py tests/test_royalty_calc.py

# Result: 55 tests in 0.38s, $0.00 cost
```

## The Problem

Before mocking, every test run cost money:

```python
# ❌ OLD: This costs ~$0.03 per call
def test_extraction():
    extracted, _ = extract_terms_with_claude(contract_text)
    assert extracted.royalty_rate == "8%"
```

Running tests 20 times/day × $0.03 = **$0.60/day** per developer

## The Solution

Mock the Anthropic API response:

```python
# ✅ NEW: This costs $0.00
def test_extraction(mocker):
    import json
    from unittest.mock import Mock, MagicMock

    # Create mock response
    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps({
        "licensor_name": "Test Corp",
        "licensee_name": "Test Inc",
        "royalty_rate": "8%",
        "royalty_base": "net sales",
        "territories": ["United States"],
        "product_categories": ["Apparel"],
        "contract_start_date": "2024-01-01",
        "contract_end_date": "2026-12-31",
        "minimum_guarantee": "$50,000 USD",
        "advance_payment": None,
        "payment_terms": "quarterly",
        "reporting_frequency": "quarterly",
        "exclusivity": "exclusive",
        "confidence_score": 0.95,
        "extraction_notes": []
    }))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    # Configure mock client
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    # Now call your function - it uses the mock!
    extracted, _ = extract_terms_with_claude("contract text")
    assert extracted.royalty_rate == "8%"
```

## Minimal Example

For a quick test, use predefined constants:

```python
from unittest.mock import Mock, MagicMock
import json

# Predefined response (from test_extractor_mocked.py)
MOCK_FLAT_RATE = {
    "licensor_name": "Test Licensor Inc",
    "licensee_name": "Test Licensee Corp",
    "royalty_rate": "8% of Net Sales",
    "royalty_base": "net sales",
    "territories": ["United States"],
    "product_categories": ["Apparel"],
    "contract_start_date": "2024-01-01",
    "contract_end_date": "2026-12-31",
    "minimum_guarantee": "$50,000 USD",
    "advance_payment": "$10,000 USD",
    "payment_terms": "quarterly",
    "reporting_frequency": "quarterly",
    "exclusivity": "exclusive",
    "confidence_score": 0.95,
    "extraction_notes": []
}

def test_my_extraction(mocker):
    # Setup mock in 4 lines
    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    # Test your code
    from app.services.extractor import extract_terms_with_claude
    extracted, _ = extract_terms_with_claude("test contract")

    # Assertions
    assert extracted.licensor_name == "Test Licensor Inc"
    assert extracted.royalty_rate == "8% of Net Sales"
```

## Using Fixtures (Even Easier)

Create a reusable fixture in `conftest.py`:

```python
# conftest.py
import pytest
from unittest.mock import Mock, MagicMock
import json

@pytest.fixture
def mock_claude_api(mocker):
    """Mock Anthropic API with flat rate response."""
    response_data = {
        "licensor_name": "Test Licensor",
        "licensee_name": "Test Licensee",
        "royalty_rate": "8%",
        # ... full schema
        "confidence_score": 0.95,
        "extraction_notes": []
    }

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    return mock_client
```

Then use it in tests:

```python
# test_my_feature.py
def test_extraction(mock_claude_api):
    # That's it! Mock is already configured
    from app.services.extractor import extract_terms_with_claude
    extracted, _ = extract_terms_with_claude("test")
    assert extracted.royalty_rate == "8%"
```

## Testing Different Rate Types

### Flat Rate

```python
response_data = {
    # ...
    "royalty_rate": "8% of Net Sales",  # STRING
    # ...
}
```

### Tiered Rate

```python
response_data = {
    # ...
    "royalty_rate": [  # LIST of dicts
        {"threshold": "$0-$2M", "rate": "6%"},
        {"threshold": "$2M-$5M", "rate": "8%"},
        {"threshold": "$5M+", "rate": "10%"}
    ],
    # ...
}

# In test assertions:
assert isinstance(extracted.royalty_rate, list)
assert extracted.royalty_rate[0].rate == "6%"  # RoyaltyTier model
```

### Category-Specific Rate

```python
response_data = {
    # ...
    "royalty_rate": {  # DICT
        "apparel": "10%",
        "accessories": "8%"
    },
    "product_categories": ["Apparel", "Accessories"],
    # ...
}

# In test assertions:
assert isinstance(extracted.royalty_rate, dict)
assert extracted.royalty_rate['apparel'] == "10%"
```

## Common Commands

```bash
# Run all mocked tests (fast)
pytest tests/test_extractor_mocked.py

# Run all non-API tests
pytest tests/test_extractor_mocked.py tests/test_royalty_calc.py

# Run with verbose output
pytest tests/test_extractor_mocked.py -v

# Run a specific test
pytest tests/test_extractor_mocked.py::TestMockedClaudeExtraction::test_extract_terms_with_mock_flat_rate

# Run and show print statements
pytest tests/test_extractor_mocked.py -v -s
```

## When to Use Real API

Only use real API tests for:

1. **Integration testing** - Before deployment
2. **New contract types** - Validating extraction on new formats
3. **API validation** - After Claude API updates

```bash
# Real API tests (costs money, requires API key)
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/test_extractor.py -k "TestClaudeExtraction::test_extract_simple_contract"
```

## Cost Savings

### Before Mocking

```
20 test runs/day × 5 API calls × $0.03 = $3/day per developer
Monthly: $60/developer
Team of 10: $600/month
```

### After Mocking

```
20 test runs/day × 0 API calls × $0.00 = $0/day
Monthly: $0 (mocked tests) + $30 (occasional real API tests)
Team of 10: $30/month
Savings: $570/month (95% reduction)
```

## Troubleshooting

### "Mock not working, still calling API"

Check your patch path:

```python
# ✅ CORRECT
mocker.patch('anthropic.Anthropic', return_value=mock_client)

# ❌ WRONG
mocker.patch('app.services.extractor.anthropic', ...)
```

### "JSON serialization error"

Ensure all required fields are present:

```python
response_data = {
    # ALL fields must be present (can be null)
    "licensor_name": None,
    "licensee_name": None,
    # ...
    "confidence_score": 0.8,  # Required, float
    "extraction_notes": []     # Required, list
}
```

### "RoyaltyTier object is not subscriptable"

Tiered rates are Pydantic models, use attribute access:

```python
# ✅ CORRECT
assert extracted.royalty_rate[0].rate == "6%"

# ❌ WRONG
assert extracted.royalty_rate[0]['rate'] == "6%"
```

## Next Steps

1. **Read the full guide**: `MOCKING_GUIDE.md`
2. **See examples**: `test_extractor_mocked.py`
3. **Check strategy**: `TESTING_STRATEGY.md`
4. **Start writing mocked tests** for your features!

## Resources

- Mocking Guide: `/Users/bobsantos/likha/dev/likha-app/backend/tests/MOCKING_GUIDE.md`
- Example Tests: `/Users/bobsantos/likha/dev/likha-app/backend/tests/test_extractor_mocked.py`
- Testing Strategy: `/Users/bobsantos/likha/dev/likha-app/backend/tests/TESTING_STRATEGY.md`
- pytest-mock docs: https://pytest-mock.readthedocs.io/
