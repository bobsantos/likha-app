"""
Unit tests for contract extraction with MOCKED Anthropic API.
All tests use mocked API calls to avoid costs and API key requirements.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch
from app.services.extractor import (
    extract_text_from_pdf,
    extract_terms_with_claude,
    extract_contract,
)
from app.models.contract import ExtractedTerms


# Path to sample contracts from the spike
SAMPLE_CONTRACTS_DIR = Path(__file__).parent.parent.parent.parent / "likha-contract-extraction-spike" / "sample_contracts"


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


# Fixtures for sample contracts
@pytest.fixture
def sample_contract_simple():
    """Path to simple flat-rate contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_simple.pdf"


@pytest.fixture
def sample_contract_tiered():
    """Path to tiered-rate contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_tiered.pdf"


@pytest.fixture
def sample_contract_categories():
    """Path to category-specific contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_categories.pdf"


# Reusable mock fixture
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


class TestPdfExtraction:
    """Test PDF text extraction without AI (no mocking needed)."""

    def test_extract_text_from_simple_contract(self, sample_contract_simple):
        """Test that we can extract text from a simple contract PDF."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))

        # Basic checks
        assert text is not None
        assert len(text) > 100
        assert "license" in text.lower() or "agreement" in text.lower()

    def test_extract_text_from_tiered_contract(self, sample_contract_tiered):
        """Test extraction from tiered rate contract."""
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))

        assert text is not None
        assert len(text) > 100

    def test_extract_text_from_categories_contract(self, sample_contract_categories):
        """Test extraction from category-specific contract."""
        if not sample_contract_categories.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_categories))

        assert text is not None
        assert len(text) > 100

    def test_extract_text_handles_structured_content(self, sample_contract_tiered):
        """Test that structured content extraction works (tiered rates, lists, etc)."""
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))

        # Check for structured content indicators (tables or numbered lists)
        has_structure = (
            "[Table on page" in text or
            "|" in text or
            "(a)" in text or
            "(b)" in text
        )
        assert has_structure

    def test_extract_text_nonexistent_file(self):
        """Test that nonexistent file raises appropriate error."""
        with pytest.raises(Exception):
            extract_text_from_pdf("/nonexistent/path/contract.pdf")

    def test_empty_pdf_raises_error(self, tmp_path):
        """Test that an empty or corrupt PDF raises an error."""
        # Create an empty file
        empty_pdf = tmp_path / "empty.pdf"
        empty_pdf.write_text("")

        with pytest.raises(Exception):
            extract_text_from_pdf(str(empty_pdf))


class TestClaudeExtractionMocked:
    """Test Claude API extraction with mocked responses (no API costs)."""

    def test_extract_terms_with_mock_flat_rate(self, mocker):
        """Test extraction with mocked flat rate response."""
        import json

        # Create a mock response object that mimics the Anthropic API response structure
        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
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

        # Verify token usage
        assert token_usage['input_tokens'] == 1200
        assert token_usage['output_tokens'] == 600
        assert token_usage['total_tokens'] == 1800

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
        import asyncio

        # Create a temporary PDF file path
        pdf_path = tmp_path / "test.pdf"

        # Mock the PDF extraction
        mock_pdf_text = "This is extracted PDF text from a licensing agreement."
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
        extracted, token_usage = asyncio.run(extract_contract(str(pdf_path)))

        # Verify results
        assert isinstance(extracted, ExtractedTerms)
        assert extracted.licensor_name == "Test Licensor Inc"
        assert token_usage['total_tokens'] == 1500

    def test_minimal_text_extraction(self, mocker):
        """Test extraction with minimal contract-like text."""
        import json

        minimal_mock = {
            "licensor_name": "XYZ Corp",
            "licensee_name": "ABC Inc",
            "royalty_rate": "8% of net sales",
            "royalty_base": "net sales",
            "territories": ["United States"],
            "product_categories": None,
            "contract_start_date": "2024-01-01",
            "contract_end_date": "2026-12-31",
            "minimum_guarantee": None,
            "advance_payment": None,
            "payment_terms": None,
            "reporting_frequency": None,
            "exclusivity": None,
            "confidence_score": 0.75,
            "extraction_notes": ["Minimal contract with basic terms only"]
        }

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(minimal_mock))]
        mock_response.usage = Mock(input_tokens=400, output_tokens=250)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        minimal_text = """
        LICENSING AGREEMENT

        This agreement is between XYZ Corp (Licensor) and ABC Inc (Licensee).

        Royalty Rate: 8% of net sales
        Territory: United States
        Term: January 1, 2024 to December 31, 2026
        """

        extracted, token_usage = extract_terms_with_claude(minimal_text)

        # Should extract the basic terms
        assert isinstance(extracted, ExtractedTerms)
        assert extracted.licensor_name == "XYZ Corp"
        assert extracted.licensee_name == "ABC Inc"
        assert extracted.royalty_rate == "8% of net sales"

    def test_ambiguous_contract_has_notes(self, mocker):
        """Test that ambiguous terms result in extraction_notes and lower confidence."""
        import json

        ambiguous_mock = {
            "licensor_name": None,
            "licensee_name": None,
            "royalty_rate": None,
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
            "confidence_score": 0.3,
            "extraction_notes": [
                "Unable to identify licensor or licensee clearly",
                "No royalty rate specified",
                "Contract terms are too vague to extract reliably"
            ]
        }

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(ambiguous_mock))]
        mock_response.usage = Mock(input_tokens=300, output_tokens=200)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        ambiguous_text = """
        AGREEMENT

        Party A and Party B agree to terms.
        Payment will be determined based on various factors.
        """

        extracted, _ = extract_terms_with_claude(ambiguous_text)

        # Should have notes about ambiguities
        assert extracted.extraction_notes is not None
        assert len(extracted.extraction_notes) > 0

        # Confidence should be low
        assert extracted.confidence_score < 0.5


class TestTokenUsageTracking:
    """Test that token usage is properly tracked."""

    def test_token_usage_structure(self, mocker):
        """Test that token usage dict has expected structure."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1234, output_tokens=567)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        text = "Sample contract text"
        _, token_usage = extract_terms_with_claude(text)

        # Check structure
        assert "input_tokens" in token_usage
        assert "output_tokens" in token_usage
        assert "total_tokens" in token_usage

        # Check values
        assert token_usage["input_tokens"] == 1234
        assert token_usage["output_tokens"] == 567
        assert token_usage["total_tokens"] == 1801

        # Check math
        assert token_usage["total_tokens"] == token_usage["input_tokens"] + token_usage["output_tokens"]

    def test_cost_estimate(self, mocker):
        """
        Test that extraction cost is within expected range.
        From MVP.md: ~$0.02-0.05 per extraction
        """
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        # Simulate realistic token usage for a typical contract
        mock_response.usage = Mock(input_tokens=3000, output_tokens=800)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        text = "Sample contract text"
        _, token_usage = extract_terms_with_claude(text)

        # Rough cost estimate (as of 2026-02)
        # Claude Sonnet 4.5: ~$3 per million input tokens, ~$15 per million output tokens
        input_cost = (token_usage["input_tokens"] / 1_000_000) * 3
        output_cost = (token_usage["output_tokens"] / 1_000_000) * 15
        total_cost = input_cost + output_cost

        # Should be in expected range from MVP.md
        assert total_cost < 0.10, f"Cost ${total_cost:.4f} exceeds expected maximum"

        # Log for visibility
        print(f"\nMocked extraction cost: ${total_cost:.4f}")
        print(f"  Input tokens: {token_usage['input_tokens']} (${input_cost:.4f})")
        print(f"  Output tokens: {token_usage['output_tokens']} (${output_cost:.4f})")

    def test_different_token_costs(self, mocker):
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


class TestExtractionQuality:
    """Test that extraction_notes and confidence scores work properly."""

    def test_extraction_notes_present(self, mocker):
        """Test that extraction_notes are present and useful."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        text = "Sample contract"
        extracted, _ = extract_terms_with_claude(text)

        # Notes should be present
        assert extracted.extraction_notes is not None
        assert isinstance(extracted.extraction_notes, list)
        # For well-structured contract, should have notes
        assert len(extracted.extraction_notes) > 0

    def test_confidence_score_present(self, mocker):
        """Test that confidence_score is present and reasonable."""
        import json

        mock_response = Mock()
        mock_response.content = [Mock(text=json.dumps(MOCK_FLAT_RATE_RESPONSE))]
        mock_response.usage = Mock(input_tokens=1000, output_tokens=500)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mocker.patch('anthropic.Anthropic', return_value=mock_client)

        text = "Sample contract"
        extracted, _ = extract_terms_with_claude(text)

        # Confidence should be present
        assert extracted.confidence_score is not None

        # Should be a valid probability
        assert 0.0 <= extracted.confidence_score <= 1.0

        # For well-formatted sample contracts, should be high
        assert extracted.confidence_score >= 0.8


class TestAPICallVerification:
    """Test that the API is being called with correct parameters."""

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


class TestMockingPatterns:
    """Examples of different mocking patterns for reference."""

    def test_using_fixture(self, mock_anthropic_client):
        """Example of using the mock_anthropic_client fixture."""
        extracted, token_usage = extract_terms_with_claude("test contract")

        # Verify mock was used
        mock_anthropic_client.messages.create.assert_called_once()

        # Verify results
        assert extracted.licensor_name == "Test Licensor Inc"
        assert token_usage['total_tokens'] == 1500

    def test_pattern_inline_mock(self, mocker):
        """
        Pattern: Inline mock with mocker fixture.
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

    def test_pattern_fixture_based_mock(self, mocker):
        """
        Pattern: Use predefined response constants.
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

    def test_pattern_parametrized_mocks(self, mocker):
        """
        Pattern: Create a factory function for different scenarios.
        Best for: Testing multiple scenarios with similar structure.
        """
        import json

        def create_contract_mock(royalty_rate, confidence=0.9):
            """Factory function for creating test mocks."""
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
