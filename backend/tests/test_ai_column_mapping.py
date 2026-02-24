"""
AI-assisted column mapping tests (Phase 2, Task 2).

These tests verify the claude_suggest() function and its integration into
suggest_mapping(). The Anthropic client is mocked — no real API calls are made.

TDD: tests were written before the implementation.
"""

import json
import os
import pytest
from unittest.mock import MagicMock, patch

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_claude_response(content: str) -> MagicMock:
    """Build a mock Anthropic message response with the given text content."""
    response = MagicMock()
    response.content = [MagicMock()]
    response.content[0].text = content
    return response


def _make_contract_context(
    licensee_name: str = "Acme Corp",
    royalty_base: str = "net_sales",
    has_categories: bool = False,
    categories: list = None,
) -> dict:
    return {
        "licensee_name": licensee_name,
        "royalty_base": royalty_base,
        "has_categories": has_categories,
        "categories": categories or [],
    }


# ---------------------------------------------------------------------------
# claude_suggest() — prompt format
# ---------------------------------------------------------------------------

class TestClaudeSuggestPromptFormat:
    """claude_suggest() builds the correct prompt payload."""

    def test_sends_column_names_and_samples(self):
        """The prompt must include column names and sample values."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [
            {"name": "Rev", "samples": ["12000", "8500", "22000"]},
        ]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps({"Rev": "net_sales"})
            )

            claude_suggest(columns, contract_context)

            assert mock_client.messages.create.called
            call_kwargs = mock_client.messages.create.call_args
            # The user message content must contain the column name and samples
            user_content = call_kwargs[1]["messages"][0]["content"]
            assert "Rev" in user_content
            assert "12000" in user_content

    def test_sends_valid_fields_list(self):
        """The prompt must tell Claude which field names are valid."""
        from app.services.spreadsheet_parser import claude_suggest, VALID_FIELDS

        columns = [{"name": "Amount", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps({"Amount": "net_sales"})
            )

            claude_suggest(columns, contract_context)

            call_kwargs = mock_client.messages.create.call_args
            user_content = call_kwargs[1]["messages"][0]["content"]
            # At minimum the core fields should appear in the prompt
            assert "net_sales" in user_content
            assert "ignore" in user_content

    def test_sends_contract_context(self):
        """The prompt must include contract context (licensee name, royalty base)."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Sales", "samples": ["500"]}]
        contract_context = _make_contract_context(
            licensee_name="Sunrise Apparel",
            royalty_base="gross_sales",
            has_categories=True,
            categories=["Apparel", "Accessories"],
        )

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps({"Sales": "gross_sales"})
            )

            claude_suggest(columns, contract_context)

            call_kwargs = mock_client.messages.create.call_args
            user_content = call_kwargs[1]["messages"][0]["content"]
            assert "Sunrise Apparel" in user_content

    def test_uses_non_streaming_call(self):
        """claude_suggest() must NOT use streaming (stream=True)."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps({"Rev": "net_sales"})
            )

            claude_suggest(columns, contract_context)

            call_kwargs = mock_client.messages.create.call_args
            # stream kwarg must not be True
            assert call_kwargs[1].get("stream") is not True


# ---------------------------------------------------------------------------
# claude_suggest() — response parsing
# ---------------------------------------------------------------------------

class TestClaudeSuggestResponseParsing:
    """claude_suggest() parses Claude's JSON response correctly."""

    def test_returns_mapping_for_valid_fields(self):
        """Valid field names in the Claude response are returned as-is."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [
            {"name": "Rev", "samples": ["12000"]},
            {"name": "Sku Group", "samples": ["Tops", "Hats"]},
        ]
        contract_context = _make_contract_context()

        ai_response = {"Rev": "net_sales", "Sku Group": "product_category"}

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps(ai_response)
            )

            result = claude_suggest(columns, contract_context)

        assert result == {"Rev": "net_sales", "Sku Group": "product_category"}

    def test_discards_invalid_field_names(self):
        """Field values that are not in VALID_FIELDS are silently discarded."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [
            {"name": "Rev", "samples": ["12000"]},
            {"name": "Misc", "samples": ["foo"]},
        ]
        contract_context = _make_contract_context()

        # Claude returns an invalid field name for "Misc"
        ai_response = {"Rev": "net_sales", "Misc": "bad_field_name"}

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                json.dumps(ai_response)
            )

            result = claude_suggest(columns, contract_context)

        assert "Rev" in result
        assert result["Rev"] == "net_sales"
        # "Misc" was discarded because "bad_field_name" is not valid
        assert "Misc" not in result

    def test_handles_markdown_fenced_json(self):
        """Claude sometimes wraps JSON in markdown code fences — strip them."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Revenue", "samples": ["5000"]}]
        contract_context = _make_contract_context()

        fenced = "```json\n{\"Revenue\": \"net_sales\"}\n```"

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(fenced)

            result = claude_suggest(columns, contract_context)

        assert result == {"Revenue": "net_sales"}

    def test_returns_empty_dict_on_invalid_json(self):
        """If Claude returns non-parseable text, return an empty dict (silent fallback)."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.return_value = _make_claude_response(
                "I cannot determine the column mapping."
            )

            result = claude_suggest(columns, contract_context)

        assert result == {}


# ---------------------------------------------------------------------------
# claude_suggest() — fallback behaviour
# ---------------------------------------------------------------------------

class TestClaudeSuggestFallback:
    """claude_suggest() falls back silently on errors and timeouts."""

    def test_returns_empty_dict_on_timeout(self):
        """A timeout exception from the Anthropic client returns an empty dict."""
        import httpx
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.side_effect = httpx.TimeoutException(
                "Request timed out"
            )

            result = claude_suggest(columns, contract_context)

        assert result == {}

    def test_returns_empty_dict_on_api_error(self):
        """Any exception from the Anthropic client returns an empty dict."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            mock_client = MagicMock()
            MockAnthropic.return_value = mock_client
            mock_client.messages.create.side_effect = Exception("API rate limit exceeded")

            result = claude_suggest(columns, contract_context)

        assert result == {}

    def test_returns_empty_dict_when_anthropic_not_available(self):
        """If the anthropic package itself raises ImportError, return empty dict."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.side_effect = Exception("Anthropic unavailable")

            result = claude_suggest(columns, contract_context)

        assert result == {}

    def test_returns_empty_dict_when_no_api_key(self):
        """When ANTHROPIC_API_KEY is not set, return empty dict (no crash)."""
        from app.services.spreadsheet_parser import claude_suggest

        columns = [{"name": "Rev", "samples": ["100"]}]
        contract_context = _make_contract_context()

        with patch.dict(os.environ, {}, clear=True):
            # Remove only ANTHROPIC_API_KEY
            env_without_key = {
                k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"
            }
            with patch.dict(os.environ, env_without_key, clear=True):
                with patch("anthropic.Anthropic") as MockAnthropic:
                    mock_client = MagicMock()
                    MockAnthropic.return_value = mock_client
                    mock_client.messages.create.side_effect = Exception("No API key")

                    result = claude_suggest(columns, contract_context)

        assert result == {}


# ---------------------------------------------------------------------------
# suggest_mapping() + AI integration
# ---------------------------------------------------------------------------

class TestSuggestMappingAiIntegration:
    """suggest_mapping() calls claude_suggest() for unresolved columns."""

    def test_unresolved_columns_get_ai_suggestions(self):
        """Columns that keyword matching mapped to 'ignore' are passed to Claude."""
        from app.services.spreadsheet_parser import suggest_mapping

        # "Rev" and "Sku Group" won't match any keyword synonym
        column_names = ["Net Sales", "Rev", "Sku Group"]
        contract_context = _make_contract_context()

        ai_mapping = {"Rev": "net_sales", "Sku Group": "product_category"}

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value=ai_mapping,
        ) as mock_claude:
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        # Claude should only have been called with the unresolved columns
        assert mock_claude.called
        call_args = mock_claude.call_args[0]
        sent_column_names = [c["name"] for c in call_args[0]]
        assert "Net Sales" not in sent_column_names  # already resolved by keyword
        assert "Rev" in sent_column_names
        assert "Sku Group" in sent_column_names

    def test_already_resolved_columns_not_sent_to_claude(self):
        """Columns that keyword matching already resolved are NOT sent to Claude."""
        from app.services.spreadsheet_parser import suggest_mapping

        # All of these should match keyword synonyms
        column_names = ["Net Sales", "Product Category", "Royalty Due"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        # Claude should have been called with an empty list (nothing unresolved)
        if mock_claude.called:
            call_args = mock_claude.call_args[0]
            sent_columns = call_args[0]
            assert sent_columns == []

    def test_ai_suggestions_merged_into_result(self):
        """AI suggestions for unresolved columns are present in the final result."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev", "Sku Group"]
        contract_context = _make_contract_context()

        ai_mapping = {"Rev": "gross_sales", "Sku Group": "product_category"}

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value=ai_mapping,
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        assert result["Net Sales"] == "net_sales"   # from keyword matching
        assert result["Rev"] == "gross_sales"         # from AI
        assert result["Sku Group"] == "product_category"  # from AI

    def test_saved_mapping_columns_not_sent_to_claude(self):
        """Columns that the saved mapping already covers are NOT sent to Claude."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev", "Sku Group", "Unknown Col"]
        saved_mapping = {"Rev": "net_sales", "Sku Group": "product_category"}
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Unknown Col": "territory"},
        ) as mock_claude:
            result = suggest_mapping(
                column_names,
                saved_mapping=saved_mapping,
                contract_context=contract_context,
            )

        # Rev and Sku Group resolved from saved_mapping — not sent to Claude
        if mock_claude.called:
            call_args = mock_claude.call_args[0]
            sent_column_names = [c["name"] for c in call_args[0]]
            assert "Rev" not in sent_column_names
            assert "Sku Group" not in sent_column_names

        assert result["Rev"] == "net_sales"
        assert result["Sku Group"] == "product_category"
        assert result["Unknown Col"] == "territory"

    def test_ai_fallback_does_not_break_result(self):
        """When Claude fails silently, the keyword-matched columns are still returned."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={},  # Claude returned nothing
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        assert result["Net Sales"] == "net_sales"
        assert result["Rev"] == "ignore"  # unresolved, AI gave nothing

    def test_no_contract_context_skips_ai(self):
        """When no contract_context is provided, claude_suggest() is NOT called."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev"]

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
        ) as mock_claude:
            result = suggest_mapping(column_names, saved_mapping=None)

        assert not mock_claude.called
        assert result["Net Sales"] == "net_sales"
        assert result["Rev"] == "ignore"


# ---------------------------------------------------------------------------
# mapping_source = "ai"
# ---------------------------------------------------------------------------

class TestMappingSourceAi:
    """The upload endpoint sets mapping_source='ai' when AI contributes suggestions."""

    def test_mapping_source_is_ai_when_ai_resolves_columns(self):
        """
        When keyword matching produced at least one 'ignore' that AI later resolved,
        the suggest_mapping result should show that AI contributed.

        This test verifies the suggest_mapping integration returns AI-resolved results,
        which the router then uses to decide the mapping_source value.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev", "Sku Group"]  # neither matches keyword synonyms
        contract_context = _make_contract_context()

        ai_mapping = {"Rev": "net_sales", "Sku Group": "product_category"}

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value=ai_mapping,
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        # After AI, no column should remain as 'ignore' for those two
        assert result["Rev"] == "net_sales"
        assert result["Sku Group"] == "product_category"

    def test_mapping_source_not_ai_when_all_keyword_resolved(self):
        """
        When keyword matching resolves everything, AI is not called and
        mapping_source should not be 'ai'.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Product Category"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={},
        ) as mock_claude:
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
            )

        # All columns resolved by keyword; AI received nothing meaningful to do
        assert result["Net Sales"] == "net_sales"
        assert result["Product Category"] == "product_category"

    def test_suggest_mapping_returns_ai_source_flag(self):
        """
        suggest_mapping() with contract_context returns a 3-tuple
        (mapping_dict, mapping_source, col_sources) where mapping_source is
        'ai' when AI resolved at least one previously-ignored column.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev", "Sku Group"]
        contract_context = _make_contract_context()

        ai_mapping = {"Rev": "net_sales", "Sku Group": "product_category"}

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value=ai_mapping,
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        mapping, source, col_sources = result
        assert source == "ai"
        assert mapping["Rev"] == "net_sales"

    def test_suggest_mapping_returns_suggested_source_flag_when_keyword_resolves(self):
        """
        suggest_mapping() returns mapping_source='suggested' when keyword matching
        resolved all columns (AI was not needed).
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Category"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={},
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        mapping, source, col_sources = result
        assert source == "suggested"

    def test_suggest_mapping_returns_none_source_when_all_ignore(self):
        """
        suggest_mapping() returns mapping_source='none' when both keyword matching
        and AI failed to resolve any column.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["XYZ_COL_1", "ABC_COL_2"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={},  # AI also gave nothing
        ):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        mapping, source, col_sources = result
        assert source == "none"
        assert all(v == "ignore" for v in mapping.values())


# ---------------------------------------------------------------------------
# suggest_mapping() backward compatibility
# ---------------------------------------------------------------------------

class TestSuggestMappingBackwardCompatibility:
    """Existing callers of suggest_mapping() without contract_context still work."""

    def test_returns_dict_without_return_source(self):
        """Without return_source=True, the function returns a plain dict (not a tuple)."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Category"]
        result = suggest_mapping(column_names, saved_mapping=None)

        assert isinstance(result, dict)
        assert result["Net Sales"] == "net_sales"

    def test_saved_mapping_still_applied_without_contract_context(self):
        """Saved mapping works as before when no contract_context is passed."""
        from app.services.spreadsheet_parser import suggest_mapping

        saved = {"Revenue": "net_sales", "Cat": "product_category"}
        result = suggest_mapping(["Revenue", "Cat", "New Col"], saved_mapping=saved)

        assert result["Revenue"] == "net_sales"
        assert result["Cat"] == "product_category"
        assert result["New Col"] == "ignore"


# ---------------------------------------------------------------------------
# suggest_mapping() — sample_rows passed to claude_suggest
# ---------------------------------------------------------------------------

class TestSuggestMappingSampleValues:
    """suggest_mapping() extracts per-column samples from sample_rows and passes
    them to claude_suggest() instead of the previous hardcoded empty list."""

    def test_sample_values_extracted_per_column(self):
        """
        When sample_rows are provided, claude_suggest receives the actual cell
        values for each unresolved column.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        # "Rev" and "Merch Desc" will not match any keyword synonym
        column_names = ["Net Sales", "Rev", "Merch Desc"]
        sample_rows = [
            {"Net Sales": "12000", "Rev": "8500", "Merch Desc": "T-Shirt"},
            {"Net Sales": "9000", "Rev": "7200", "Merch Desc": "Hat"},
        ]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales", "Merch Desc": "ignore"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                sample_rows=sample_rows,
            )

        assert mock_claude.called
        sent_columns = mock_claude.call_args[0][0]
        # Find what samples were sent for "Rev"
        rev_col = next(c for c in sent_columns if c["name"] == "Rev")
        assert "8500" in rev_col["samples"]
        assert "7200" in rev_col["samples"]
        # Samples for "Merch Desc"
        merch_col = next(c for c in sent_columns if c["name"] == "Merch Desc")
        assert "T-Shirt" in merch_col["samples"]

    def test_already_resolved_columns_not_in_sample_payload(self):
        """
        Columns resolved by keyword matching are not sent to claude_suggest,
        so their samples don't appear in the payload.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev"]
        sample_rows = [{"Net Sales": "12000", "Rev": "8500"}]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                sample_rows=sample_rows,
            )

        assert mock_claude.called
        sent_columns = mock_claude.call_args[0][0]
        sent_names = [c["name"] for c in sent_columns]
        # "Net Sales" was resolved by keyword — must not appear
        assert "Net Sales" not in sent_names
        assert "Rev" in sent_names

    def test_none_sample_rows_sends_empty_samples(self):
        """
        When sample_rows is not provided (defaults to None), claude_suggest
        still receives the unresolved columns but with samples=[].
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                # no sample_rows argument
            )

        assert mock_claude.called
        sent_columns = mock_claude.call_args[0][0]
        rev_col = next(c for c in sent_columns if c["name"] == "Rev")
        assert rev_col["samples"] == []

    def test_empty_sample_rows_sends_empty_samples(self):
        """
        When sample_rows=[] (empty list), claude_suggest receives samples=[]
        per column rather than raising an error.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                sample_rows=[],
            )

        assert mock_claude.called
        sent_columns = mock_claude.call_args[0][0]
        rev_col = next(c for c in sent_columns if c["name"] == "Rev")
        assert rev_col["samples"] == []

    def test_none_cell_values_excluded_from_samples(self):
        """
        None values in sample_rows are excluded from the samples list sent
        to claude_suggest — only non-empty string values are included.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]
        sample_rows = [
            {"Rev": "8500"},
            {"Rev": None},
            {"Rev": ""},
            {"Rev": "7200"},
        ]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                sample_rows=sample_rows,
            )

        sent_columns = mock_claude.call_args[0][0]
        rev_col = next(c for c in sent_columns if c["name"] == "Rev")
        # None and "" should be excluded
        assert None not in rev_col["samples"]
        assert "" not in rev_col["samples"]
        assert "8500" in rev_col["samples"]
        assert "7200" in rev_col["samples"]

    def test_samples_capped_at_five_values(self):
        """
        Only the first 5 non-empty values per column are sent to claude_suggest,
        even when sample_rows has more.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]
        sample_rows = [{"Rev": str(i * 100)} for i in range(1, 8)]  # 7 rows
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ) as mock_claude:
            suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                sample_rows=sample_rows,
            )

        sent_columns = mock_claude.call_args[0][0]
        rev_col = next(c for c in sent_columns if c["name"] == "Rev")
        assert len(rev_col["samples"]) <= 5


# ---------------------------------------------------------------------------
# suggest_mapping() — per-column mapping_sources
# ---------------------------------------------------------------------------

class TestMappingSources:
    """suggest_mapping(return_source=True) returns a 3-tuple
    (mapping, source_str, col_sources) where col_sources maps each column
    name to its source: 'saved', 'keyword', 'ai', or 'none'."""

    def test_returns_three_tuple_when_return_source_true(self):
        """return_source=True now returns a 3-tuple (mapping, source, col_sources)."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales"]
        contract_context = _make_contract_context()

        with patch("app.services.spreadsheet_parser.claude_suggest", return_value={}):
            result = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert isinstance(result, tuple)
        assert len(result) == 3
        mapping, source, col_sources = result
        assert isinstance(mapping, dict)
        assert isinstance(source, str)
        assert isinstance(col_sources, dict)

    def test_keyword_resolved_column_gets_keyword_source(self):
        """A column resolved by keyword matching gets source='keyword'."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales"]
        contract_context = _make_contract_context()

        with patch("app.services.spreadsheet_parser.claude_suggest", return_value={}):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert col_sources["Net Sales"] == "keyword"

    def test_ai_resolved_column_gets_ai_source(self):
        """A column resolved by AI (was 'ignore' after keyword pass) gets source='ai'."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]  # does not match any keyword synonym
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert col_sources["Rev"] == "ai"

    def test_unresolved_column_gets_none_source(self):
        """A column that neither keyword nor AI resolved gets source='none'."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["XYZ_MYSTERY_COL"]
        contract_context = _make_contract_context()

        with patch("app.services.spreadsheet_parser.claude_suggest", return_value={}):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert col_sources["XYZ_MYSTERY_COL"] == "none"

    def test_saved_mapping_column_gets_saved_source(self):
        """A column resolved from the saved mapping gets source='saved'."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Revenue"]
        saved_mapping = {"Revenue": "net_sales"}
        contract_context = _make_contract_context()

        with patch("app.services.spreadsheet_parser.claude_suggest", return_value={}):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=saved_mapping,
                contract_context=contract_context,
                return_source=True,
            )

        assert col_sources["Revenue"] == "saved"

    def test_mixed_sources_per_column(self):
        """
        With a mix of columns, each gets the correct individual source label:
        - "Net Sales" keyword-resolved → 'keyword'
        - "Rev" AI-resolved → 'ai'
        - "XYZ" neither resolved → 'none'
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev", "XYZ"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},  # AI only resolves "Rev"
        ):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert col_sources["Net Sales"] == "keyword"
        assert col_sources["Rev"] == "ai"
        assert col_sources["XYZ"] == "none"

    def test_col_sources_covers_all_columns(self):
        """col_sources has an entry for every column in column_names."""
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Net Sales", "Rev", "Category", "Junk Col"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ):
            _, _, col_sources = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert set(col_sources.keys()) == set(column_names)

    def test_overall_source_str_still_correct_with_new_return(self):
        """
        The second element (overall source_str) is still correct now that
        the function returns a 3-tuple instead of a 2-tuple.
        AI resolved at least one column → source_str == 'ai'.
        """
        from app.services.spreadsheet_parser import suggest_mapping

        column_names = ["Rev"]
        contract_context = _make_contract_context()

        with patch(
            "app.services.spreadsheet_parser.claude_suggest",
            return_value={"Rev": "net_sales"},
        ):
            _, source, _ = suggest_mapping(
                column_names,
                saved_mapping=None,
                contract_context=contract_context,
                return_source=True,
            )

        assert source == "ai"
