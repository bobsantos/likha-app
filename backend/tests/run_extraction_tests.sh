#!/bin/bash
# Script to run extraction tests with sample contracts
# Usage: ./run_extraction_tests.sh [--with-api]

set -e

cd "$(dirname "$0")/.."

echo "==================================="
echo "Likha Backend Extraction Tests"
echo "==================================="
echo ""

# Check if sample contracts exist
SAMPLE_DIR="../likha-contract-extraction-spike/sample_contracts"
if [ ! -d "$SAMPLE_DIR" ]; then
    echo "❌ Sample contracts not found at: $SAMPLE_DIR"
    echo "Please ensure the spike directory is present."
    exit 1
fi

echo "✅ Found sample contracts:"
ls -1 "$SAMPLE_DIR"/*.pdf | xargs -n 1 basename
echo ""

# Check for API key
if [ -z "$ANTHROPIC_API_KEY" ] && [ "$1" != "--with-api" ]; then
    echo "⚠️  ANTHROPIC_API_KEY not set"
    echo "Running PDF extraction tests only (no Claude API calls)"
    echo ""
    echo "To run full extraction tests with Claude API:"
    echo "  export ANTHROPIC_API_KEY=sk-ant-your-key"
    echo "  ./run_extraction_tests.sh --with-api"
    echo ""

    pytest tests/test_extractor.py::TestPdfExtraction -v
elif [ -n "$ANTHROPIC_API_KEY" ] || [ "$1" == "--with-api" ]; then
    echo "✅ ANTHROPIC_API_KEY is set"
    echo "Running full extraction tests (including Claude API)"
    echo ""
    echo "⚠️  Warning: This will make API calls (~$0.02-0.05 per contract)"
    echo ""

    pytest tests/test_extractor.py -v -s
else
    pytest tests/test_extractor.py::TestPdfExtraction -v
fi

echo ""
echo "==================================="
echo "Test Summary"
echo "==================================="
pytest tests/test_extractor.py --collect-only -q
