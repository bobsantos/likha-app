# Mocking Guide: Anthropic API in Tests

## Overview

This guide explains how to mock the Anthropic API in tests to **avoid API costs** during development and CI/CD. Real API calls should only be used for integration tests or when explicitly needed.

## Why Mock?

1. **Cost Savings**: Every API call costs money (~$0.02-0.05 per extraction)
2. **Speed**: Mocked tests run instantly vs waiting for API responses
3. **Reliability**: Tests don't fail due to API rate limits or network issues
4. **Determinism**: Same input always produces same output in tests
5. **Offline Development**: Work without internet connection

## Setup

### Install pytest-mock

Already included in `requirements.txt`:

```bash
pip install pytest-mock
```

### Import Required Modules

```python
from unittest.mock import Mock, MagicMock
import json
```

## Basic Pattern

Here's the standard pattern for mocking the Anthropic API:

```python
def test_extract_with_mock(mocker):
    """Basic mocking example."""
    import json

    # 1. Create mock response data (matching ExtractedTerms schema)
    response_data = {
        "licensor_name": "Test Licensor",
        "licensee_name": "Test Licensee",
        "royalty_rate": "8%",
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
        "extraction_notes": ["All terms clear"]
    }

    # 2. Create mock response object (mimics Anthropic API response)
    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    # 3. Create mock client and configure it
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    # 4. Patch the Anthropic client constructor
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    # 5. Call your function - it will use the mock
    from app.services.extractor import extract_terms_with_claude
    extracted, token_usage = extract_terms_with_claude("test contract text")

    # 6. Assert results
    assert extracted.licensor_name == "Test Licensor"
    assert token_usage['total_tokens'] == 1500
```

## Understanding the Mock Structure

### Anthropic API Response Structure

The real Anthropic API returns an object like this:

```python
response = client.messages.create(...)
response.content[0].text  # The actual text response (JSON string)
response.usage.input_tokens   # Input token count
response.usage.output_tokens  # Output token count
```

### Mock Equivalent

```python
mock_response = Mock()
mock_response.content = [Mock(text='{"licensor_name": "Test"...}')]
mock_response.usage = Mock(input_tokens=1000, output_tokens=500)
```

## Common Test Scenarios

### 1. Testing Flat Rate Extraction

```python
def test_flat_rate_extraction(mocker):
    response_data = {
        "licensor_name": "Brand Co",
        "licensee_name": "Manufacturer Inc",
        "royalty_rate": "8% of Net Sales",  # FLAT RATE STRING
        # ... other fields
        "confidence_score": 0.95,
        "extraction_notes": []
    }

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("contract text")

    # Verify flat rate was extracted correctly
    assert isinstance(extracted.royalty_rate, str)
    assert "8%" in extracted.royalty_rate
```

### 2. Testing Tiered Rate Extraction

```python
def test_tiered_rate_extraction(mocker):
    response_data = {
        "licensor_name": "Brand Co",
        "licensee_name": "Manufacturer Inc",
        "royalty_rate": [  # TIERED RATE ARRAY
            {"threshold": "$0-$2M", "rate": "6%"},
            {"threshold": "$2M-$5M", "rate": "8%"},
            {"threshold": "$5M+", "rate": "10%"}
        ],
        # ... other fields
        "confidence_score": 0.92,
        "extraction_notes": ["Tiered structure in Section 3"]
    }

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=1200, output_tokens=600)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("contract text")

    # Verify tiered structure
    assert isinstance(extracted.royalty_rate, list)
    assert len(extracted.royalty_rate) == 3
    assert extracted.royalty_rate[0]['rate'] == "6%"
```

### 3. Testing Category-Specific Rates

```python
def test_category_rate_extraction(mocker):
    response_data = {
        "licensor_name": "Brand Co",
        "licensee_name": "Manufacturer Inc",
        "royalty_rate": {  # CATEGORY RATE DICT
            "apparel": "10%",
            "accessories": "8%",
            "home goods": "7%"
        },
        "product_categories": ["Apparel", "Accessories", "Home Goods"],
        # ... other fields
        "confidence_score": 0.88,
        "extraction_notes": ["Rates per category in Exhibit A"]
    }

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=1100, output_tokens=550)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("contract text")

    # Verify category structure
    assert isinstance(extracted.royalty_rate, dict)
    assert extracted.royalty_rate['apparel'] == "10%"
```

### 4. Testing Partial Extraction (Missing Fields)

```python
def test_partial_extraction(mocker):
    response_data = {
        "licensor_name": "Known Co",
        "licensee_name": "Known Inc",
        "royalty_rate": "5%",
        "royalty_base": None,  # MISSING
        "territories": None,    # MISSING
        "product_categories": None,  # MISSING
        "contract_start_date": None,
        "contract_end_date": None,
        "minimum_guarantee": None,
        "advance_payment": None,
        "payment_terms": None,
        "reporting_frequency": None,
        "exclusivity": None,
        "confidence_score": 0.6,  # LOW CONFIDENCE
        "extraction_notes": ["Many fields unclear or missing"]
    }

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(response_data))]
    mock_response.usage = Mock(input_tokens=500, output_tokens=200)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("incomplete contract")

    # Verify partial extraction
    assert extracted.licensor_name == "Known Co"
    assert extracted.territories is None
    assert extracted.confidence_score == 0.6
    assert len(extracted.extraction_notes) > 0
```

### 5. Testing Markdown Code Fence Handling

Claude sometimes wraps JSON in markdown code fences. Test this:

```python
def test_markdown_code_fence(mocker):
    # Response wrapped in markdown
    response_text = '''```json
{
    "licensor_name": "Test Corp",
    "licensee_name": "Test Inc",
    "royalty_rate": "8%",
    "royalty_base": "net sales",
    "territories": null,
    "product_categories": null,
    "contract_start_date": null,
    "contract_end_date": null,
    "minimum_guarantee": null,
    "advance_payment": null,
    "payment_terms": null,
    "reporting_frequency": null,
    "exclusivity": null,
    "confidence_score": 0.8,
    "extraction_notes": []
}
```'''

    mock_response = Mock()
    mock_response.content = [Mock(text=response_text)]
    mock_response.usage = Mock(input_tokens=800, output_tokens=300)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    extracted, _ = extract_terms_with_claude("contract text")

    # Should parse correctly despite markdown fence
    assert extracted.licensor_name == "Test Corp"
```

## Advanced Patterns

### Pattern 1: Reusable Mock Fixtures

Create a pytest fixture for common scenarios:

```python
# In conftest.py or at top of test file
@pytest.fixture
def mock_anthropic_flat_rate(mocker):
    """Fixture for flat rate contract extraction."""
    response_data = {
        "licensor_name": "Test Licensor",
        "licensee_name": "Test Licensee",
        "royalty_rate": "8%",
        # ... complete schema
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

# Use in tests:
def test_something(mock_anthropic_flat_rate):
    extracted, _ = extract_terms_with_claude("test")
    assert extracted.royalty_rate == "8%"
```

### Pattern 2: Factory Function for Dynamic Mocks

```python
def create_mock_extraction(royalty_rate, confidence=0.9, **overrides):
    """Factory function to create custom mock extractions."""
    default_data = {
        "licensor_name": "Test Licensor",
        "licensee_name": "Test Licensee",
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": ["United States"],
        "product_categories": ["Apparel"],
        "contract_start_date": "2024-01-01",
        "contract_end_date": "2026-12-31",
        "minimum_guarantee": None,
        "advance_payment": None,
        "payment_terms": "quarterly",
        "reporting_frequency": "quarterly",
        "exclusivity": "exclusive",
        "confidence_score": confidence,
        "extraction_notes": []
    }

    # Override with custom values
    default_data.update(overrides)

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(default_data))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    return mock_response

# Use in tests:
def test_multiple_scenarios(mocker):
    for rate in ["5%", "8%", "10%"]:
        mock_response = create_mock_extraction(rate)
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        extracted, _ = extract_terms_with_claude(f"contract with {rate}")
        assert extracted.royalty_rate == rate
```

### Pattern 3: Verify API Call Parameters

Always verify that your code calls the API correctly:

```python
def test_api_call_parameters(mocker):
    # Setup mock
    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps({...}))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    # Call function
    contract_text = "Test contract"
    extract_terms_with_claude(contract_text)

    # VERIFY THE CALL
    mock_client.messages.create.assert_called_once()

    # Check call arguments
    call_args = mock_client.messages.create.call_args
    assert call_args[1]['model'] == 'claude-sonnet-4-5-20250929'
    assert call_args[1]['max_tokens'] == 4096
    assert contract_text in call_args[1]['messages'][0]['content']
```

### Pattern 4: Test Error Handling

```python
def test_api_error_handling(mocker):
    """Test that API errors are handled gracefully."""
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = Exception("API rate limit exceeded")
    mocker.patch('anthropic.Anthropic', return_value=mock_client)

    with pytest.raises(Exception, match="rate limit"):
        extract_terms_with_claude("test")
```

## Running Tests

### Run All Tests (Including Mocked)

```bash
pytest backend/tests/
```

### Run Only Mocked Tests (No API Calls)

```bash
pytest backend/tests/test_extractor_mocked.py
```

### Run Only Real API Tests (When Needed)

```bash
# Requires ANTHROPIC_API_KEY
pytest backend/tests/test_extractor.py -k "TestClaudeExtraction"
```

### Skip API Tests in CI

In your CI configuration, you can skip real API tests:

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: pytest -m "not extraction"
  # This skips tests marked with @pytest.mark.extraction
```

## Cost Comparison

### Without Mocking
- 100 test runs × $0.03 per extraction = **$3.00**
- Slow (network latency)
- Requires internet
- Can hit rate limits

### With Mocking
- 100 test runs × $0.00 = **$0.00**
- Fast (no network)
- Works offline
- No rate limits

## Best Practices

1. **Mock by Default**: Only use real API for integration tests
2. **Verify Calls**: Always check that API is called with correct parameters
3. **Test Edge Cases**: Null fields, low confidence, extraction notes
4. **Use Fixtures**: Reuse common mock scenarios
5. **Test All Rate Types**: Flat, tiered, category-specific
6. **Document Mocks**: Explain what each mock represents
7. **Keep Mocks Updated**: When API response format changes, update mocks

## When to Use Real API

Use real API calls (non-mocked) only for:

1. **Integration tests** - Verify end-to-end flow works
2. **Regression testing** - Validate against known sample contracts
3. **Manual testing** - When developing new extraction features
4. **Production validation** - One-time checks before deployment

Mark these tests appropriately:

```python
@pytest.mark.integration
@pytest.mark.extraction
@pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="API key required")
def test_real_contract_extraction():
    # Uses real API
    pass
```

## Troubleshooting

### Mock Not Being Used

If your tests still make real API calls:

1. Check the patch path: `'anthropic.Anthropic'` not `'app.services.extractor.anthropic'`
2. Ensure mocker fixture is passed to test function
3. Verify patch happens before function call

### Import Errors

```python
# Good
from app.services.extractor import extract_terms_with_claude

# Bad (won't find the mock)
import app.services.extractor
app.services.extractor.extract_terms_with_claude(...)
```

### JSON Serialization Errors

Ensure all mock data matches the ExtractedTerms schema:

```python
# Required fields must be present (even if null)
response_data = {
    "licensor_name": None,  # Can be null
    "licensee_name": None,
    # ... all fields from ExtractedTerms
    "confidence_score": 0.8,  # Required, not null
    "extraction_notes": []     # Required, not null
}
```

## Example: Complete Test Suite

See `/Users/bobsantos/likha/dev/likha-app/backend/tests/test_extractor_mocked.py` for a comprehensive example suite including:

- Flat rate extraction
- Tiered rate extraction
- Category-specific extraction
- Partial extraction (missing fields)
- Markdown code fence handling
- Error handling
- Token usage tracking
- Reusable fixtures
- Factory patterns

## Summary

**Mocking the Anthropic API is essential for cost-effective testing.** Use the patterns in this guide to:

1. Avoid API costs during development
2. Speed up test execution
3. Enable offline development
4. Test edge cases reliably
5. Prevent rate limiting issues

Reserve real API calls for integration tests and manual validation only.
