#!/bin/bash
# Script to run extraction tests (all mocked - no API costs!)
# Usage: ./run_extraction_tests.sh

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

echo "✅ All tests use MOCKED API calls (no ANTHROPIC_API_KEY needed)"
echo "✅ No API costs incurred"
echo "✅ Fast execution (~0.8s for all tests)"
echo ""

pytest tests/test_extractor.py -v

echo ""
echo "==================================="
echo "Test Summary"
echo "==================================="
pytest tests/test_extractor.py --collect-only -q
