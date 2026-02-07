"""
Unit tests for contract extraction with MOCKED Anthropic API.
These tests avoid real API calls and associated costs.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, MagicMock
from app.services.extractor import (
    extract_text_from_pdf,
    extract_terms_with_claude,
    extract_contract,
)
from app.models.contract import ExtractedTerms


# Sample mock responses for different contract types
MOCK_FLAT_RATE_RESPONSE = {
    "licensor_name": "Test Licensor Inc",
    "licensee_name": "Test Licensee Corp",
    "royalty_rate": "8% of Net Sales",
    "royalty_base": "net sales",
    "territories": ["United States", "Canada"],
    "product_categories": ["Apparel", "Accessories"],
    "contract_start_date": "2024-01-01",
    "contract_end_date": "2026-12-31",
    "minimum_guarantee": "$50,000 USD",
    "advance_payment": "$10,000 USD",
    "payment_terms": "within 30 days of quarter end",
    "reporting_frequency": "quarterly",
    "exclusivity": "exclusive",
    "confidence_score": 0.95,
    "extraction_notes": ["All key terms clearly stated in contract"]
}

MOCK_TIERED_RATE_RESPONSE = {
    "licensor_name": "Brand Owner LLC",
    "licensee_name": "Manufacturer Inc",
    "royalty_rate": [
        {"threshold": "$0-$2,000,000", "rate": "6%"},
        {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
        {"threshold": "$5,000,000+", "rate": "10%"}
    ],
    "royalty_base": "net sales",
    "territories": ["Worldwide"],
    "product_categories": ["Home Goods"],
    "contract_start_date": "2024-01-01",
    "contract_end_date": "2027-12-31",
    "minimum_guarantee": "$100,000 USD",
    "advance_payment": None,
    "payment_terms": "within 45 days of quarter end",
    "reporting_frequency": "quarterly",
    "exclusivity": "exclusive",
    "confidence_score": 0.92,
    "extraction_notes": ["Tiered rate structure clearly defined in Section 3"]
}

MOCK_CATEGORY_RATE_RESPONSE = {
    "licensor_name": "Lifestyle Brand Co",
    "licensee_name": "Multi-Category Licensee",
    "royalty_rate": {
        "home textiles": "10%",
        "dinnerware": "7%",
        "fragrance": "12%"
    },
    "royalty_base": "net sales",
    "territories": ["United States"],
    "product_categories": ["Home Textiles", "Dinnerware", "Fragrance"],
    "contract_start_date": "2024-01-01",
    "contract_end_date": "2026-12-31",
    "minimum_guarantee": "$75,000 USD",
    "advance_payment": "$15,000 USD",
    "payment_terms": "within 30 days of quarter end",
    "reporting_frequency": "quarterly",
    "exclusivity": "non-exclusive",
    "confidence_score": 0.88,
    "extraction_notes": ["Different rates per category as outlined in Exhibit A"]
}


class TestMockedClaudeExtraction:
    """Test Claude API extraction with mocked responses (no API costs)."""

    def test_extract_terms_with_mock_flat_rate(self, mocker):
        """Test extraction with mocked flat rate response."""
        # Create a mock response object that mimics the Anthropic API response structure
        mock_response = Mock()
        mock_response.content = [Mock(text='{"licensor_name": "Test Licensor Inc", "licensee_name": "Test Licensee Corp", "royalty_rate": "8% of Net Sales", "royalty_base": "net sales", "territories": ["United States", "Canada"], "product_categories": ["Apparel", "Accessories"], "contract_start_date": "2024-01-01", "contract_end_date": "2026-12-31", "minimum_guarantee": "$50,000 USD", "advance_payment": "$10,000 USD", "payment_terms": "within 30 days of quarter end", "reporting_frequency": "quarterly", "exclusivity": "exclusive", "confidence_score": 0.95, "extraction_notes": ["All key terms clearly stated in contract"]}')]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        # Mock the Anthropic client
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response

        # Patch the Anthropic client constructor
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Test the extraction
        contract_text = "Sample contract text with 8% royalty rate..."
        extracted, token_usage = extract_terms_with_claude(contract_text)

        # Verify the client was called correctly
        mock_client.messages.create.assert_called_once()
        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs['model'] == 'claude-sonnet-4-5-20250929'
        assert call_kwargs['max_tokens'] == 4096

        # Verify extraction results
        assert isinstance(extracted, ExtractedTerms)
        assert extracted.licensor_name == "Test Licensor Inc"
        assert extracted.licensee_name == "Test Licensee Corp"
        assert extracted.royalty_rate == "8% of Net Sales"
        assert extracted.confidence_score == 0.95

        # Verify token usage
        assert token_usage['input_tokens'] == 1000
        assert token_usage['output_tokens'] == 500
        assert token_usage['total_tokens'] == 1500

    def test_extract_terms_with_mock_tiered_rate(self, mocker):
        """Test extraction with mocked tiered rate response."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_TIERED_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1200, output_tokens=600)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        contract_text = "Sample tiered contract..."
        extracted, token_usage = extract_terms_with_claude(contract_text)

        # Verify tiered structure
        assert isinstance(extracted.royalty_rate, list)
        assert len(extracted.royalty_rate) == 3
        # RoyaltyTier is a Pydantic model, use attribute access
        assert extracted.royalty_rate[0].rate == "6%"
        assert extracted.royalty_rate[0].threshold == "$0-$2,000,000"
        assert extracted.confidence_score == 0.92

    def test_extract_terms_with_mock_category_rate(self, mocker):
        """Test extraction with mocked category-specific rate response."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_CATEGORY_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1100, output_tokens=550)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        contract_text = "Sample category-specific contract..."
        extracted, token_usage = extract_terms_with_claude(contract_text)

        # Verify category structure
        assert isinstance(extracted.royalty_rate, dict)
        assert extracted.royalty_rate['home textiles'] == "10%"
        assert extracted.royalty_rate['dinnerware'] == "7%"
        assert extracted.confidence_score == 0.88

    def test_extract_terms_handles_markdown_code_fence(self, mocker):
        """Test that extraction handles Claude's markdown code fence formatting."""
        mock_response_text = """```json
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
    "confidence_score": 0.7,
    "extraction_notes": ["Minimal information available"]
}
```"""

        mock_response = Mock()
        mock_response.content = [Mock(text=mock_response_text)]
        mock_response.usage = Mock(input_tokens=800, output_tokens=300)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        contract_text = "Minimal contract text..."
        extracted, token_usage = extract_terms_with_claude(contract_text)

        # Should successfully parse despite markdown fence
        assert isinstance(extracted, ExtractedTerms)
        assert extracted.licensor_name == "Test Corp"
        assert extracted.royalty_rate == "8%"

    def test_extract_terms_with_null_fields(self, mocker):
        """Test extraction when some fields are null."""
        import json

        minimal_response = {
            "licensor_name": "Known Licensor",
            "licensee_name": "Known Licensee",
            "royalty_rate": "5%",
            "royalty_base": None,
            "territories": None,
            "product_categories": None,
            "contract_start_date": None,
            "contract_end_date": None,
            "minimum_guarantee": None,
            "advance_payment": None,
            "payment_terms": None,
            "reporting_frequency": None,
            "exclusivity": None,
            "confidence_score": 0.6,
            "extraction_notes": ["Many fields unclear or missing from document"]
        }

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(minimal_response))]
        mock_response.usage = Mock(input_tokens=500, output_tokens=200)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        contract_text = "Incomplete contract..."
        extracted, token_usage = extract_terms_with_claude(contract_text)

        # Should handle null fields gracefully
        assert extracted.licensor_name == "Known Licensor"
        assert extracted.royalty_rate == "5%"
        assert extracted.territories is None
        assert extracted.minimum_guarantee is None

    def test_extract_contract_full_pipeline_mocked(self, mocker, tmp_path):
        """Test the full async extract_contract pipeline with mocked API."""
        import json

        # Create a temporary PDF file (content doesn't matter for this test)
        pdf_path = tmp_path / "test.pdf"

        # We need a real PDF for pdfplumber, so let's create a simple one
        # For this test, we'll mock extract_text_from_pdf instead
        mock_pdf_text = "This is extracted PDF text from a licensing agreement."

        # Mock the PDF extraction
        mocker.patch(
            'app.services.extractor.extract_text_from_pdf',
            return_value=mock_pdf_text
        )

        # Mock the Claude API
        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Test the full pipeline
        import asyncio
        extracted, token_usage = asyncio.run(extract_contract(str(pdf_path)))

        # Verify results
        assert isinstance(extracted, ExtractedTerms)
        assert extracted.licensor_name == "Test Licensor Inc"
        assert token_usage['total_tokens'] == 1500


class TestMockingHelpers:
    """Test helper functions for creating mock responses."""

    def test_create_mock_anthropic_response(self):
        """Helper function to create mock Anthropic responses."""
        def create_mock_response(response_dict, input_tokens=1000, output_tokens=500):
            """
            Helper to create a mock Anthropic API response.

            Args:
                response_dict: Dictionary matching ExtractedTerms schema
                input_tokens: Simulated input token count
                output_tokens: Simulated output token count

            Returns:
                Mock object mimicking anthropic.types.Message
            """
            import json

            mock_response = Mock()
            mock_response.content = [Mock(text=json.dumps(response_dict))]
            mock_response.usage = Mock(
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )
            return mock_response

        # Test the helper
        test_dict = {"licensor_name": "Test", "confidence_score": 0.9}
        mock = create_mock_response(test_dict, 100, 50)

        assert mock.usage.input_tokens == 100
        assert mock.usage.output_tokens == 50
        import json
        assert json.loads(mock.content[0].text)['licensor_name'] == "Test"


class TestMockingPatterns:
    """Documentation and examples of different mocking patterns."""

    def test_pattern_1_inline_mock(self, mocker):
        """
        Pattern 1: Inline mock with mocker fixture.
        Best for: Simple tests with one-off mock responses.
        """
        import json

        # Create mock response inline
        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps({
            "licensor_name": "Quick Test",
            "licensee_name": "Quick Licensee",
            "royalty_rate": "5%",
            "royalty_base": None,
            "territories": None,
            "product_categories": None,
            "contract_start_date": None,
            "contract_end_date": None,
            "minimum_guarantee": None,
            "advance_payment": None,
            "payment_terms": None,
            "reporting_frequency": None,
            "exclusivity": None,
            "confidence_score": 0.8,
            "extraction_notes": []
        }))]
        mock_response.usage = Mock(input_tokens=500, output_tokens=250)

        # Setup mock
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Test
        extracted, _ = extract_terms_with_claude("test text")
        assert extracted.licensor_name == "Quick Test"

    def test_pattern_2_fixture_based_mock(self, mocker):
        """
        Pattern 2: Use predefined response constants.
        Best for: Reusable test scenarios across multiple tests.
        """
        import json

        # Use predefined constant
        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Test
        extracted, _ = extract_terms_with_claude("test text")
        assert extracted.confidence_score == 0.95

    def test_pattern_3_parametrized_mocks(self, mocker):
        """
        Pattern 3: Create a factory function for different scenarios.
        Best for: Testing multiple scenarios with similar structure.
        """
        def create_contract_mock(royalty_rate, confidence=0.9):
            """Factory function for creating test mocks."""
            import json
            response_dict = MOCK_FLAT_RATE_RESPONSE.copy()
            response_dict['royalty_rate'] = royalty_rate
            response_dict['confidence_score'] = confidence

            mock_response = Mock()
            mock_response.content = [Mock(text=json.dumps(response_dict))]
            mock_response.usage = Mock(input_tokens=1000, output_tokens=500)
            return mock_response

        # Test with different royalty rates
        for rate in ["5%", "8%", "10%"]:
            mock_client = MagicMock()
            mock_client.messages.create.return_value = create_contract_mock(rate)
            mocker.patch('anthropic.Anthropic', return_value=mock_client)

            extracted, _ = extract_terms_with_claude(f"contract with {rate} rate")
            assert extracted.royalty_rate == rate


class TestMockingBestPractices:
    """Examples of best practices for mocking the Anthropic API."""

    def test_verify_api_call_parameters(self, mocker):
        """Always verify that the API is being called with correct parameters."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Call the function
        contract_text = "Test contract text"
        extract_terms_with_claude(contract_text)

        # Verify the API was called with correct parameters
        mock_client.messages.create.assert_called_once()
        call_args = mock_client.messages.create.call_args

        # Check model
        assert call_args[1]['model'] == 'claude-sonnet-4-5-20250929'

        # Check max_tokens
        assert call_args[1]['max_tokens'] == 4096

        # Check that contract text is in the prompt
        assert contract_text in call_args[1]['messages'][0]['content']

    def test_simulate_api_error(self, mocker):
        """Test error handling by simulating API failures."""
        # Simulate an API error
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API Error: Rate limit exceeded")
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        # Verify error handling
        with pytest.raises(Exception, match="API Error"):
            extract_terms_with_claude("test text")

    def test_mock_different_token_costs(self, mocker):
        """Test with different token usage scenarios to verify cost tracking."""
        import json

        test_cases = [
            (500, 200, 700),    # Small contract
            (2000, 800, 2800),  # Medium contract
            (4000, 1500, 5500)  # Large contract
        ]

        for input_tok, output_tok, expected_total in test_cases:
            mock_response = Mock()
            mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
            mock_response.usage = Mock(input_tokens=input_tok, output_tokens=output_tok)

            mock_client = MagicMock()
            mock_client.messages.create.return_value = mock_response
            mocker.patch('anthropic.Anthropic', return_value=mock_client)

            _, token_usage = extract_terms_with_claude("test text")

            assert token_usage['input_tokens'] == input_tok
            assert token_usage['output_tokens'] == output_tok
            assert token_usage['total_tokens'] == expected_total


# Pytest fixtures for reusable mocks
@pytest.fixture
def mock_anthropic_client(mocker):
    """
    Fixture that provides a pre-configured mock Anthropic client.
    Usage: def test_something(mock_anthropic_client):
    """
    import json

    mock_response = Mock()
    mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
    mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    mocker.patch('anthropic.Anthropic', return_value=mock_client)
    return mock_client


def test_using_fixture(mock_anthropic_client):
    """Example of using the mock_anthropic_client fixture."""
    extracted, token_usage = extract_terms_with_claude("test contract")

    # Verify mock was used
    mock_anthropic_client.messages.create.assert_called_once()

    # Verify results
    assert extracted.licensor_name == "Test Licensor Inc"
    assert token_usage['total_tokens'] == 1500
