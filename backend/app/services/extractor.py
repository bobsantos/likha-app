"""
Contract extraction service.
Ports the extraction logic from the spike to a reusable service.
"""

import os
from typing import Tuple
import pdfplumber
import anthropic
from app.models.contract import ExtractedTerms

# Model configuration
MODEL = "claude-sonnet-4-5-20250929"
MAX_TOKENS = 4096

EXTRACTION_PROMPT = """\
You are a licensing contract analyst. Analyze the following licensing agreement and extract the key terms into structured JSON.

Extract these fields:
- licensor_name: The entity granting the license
- licensee_name: The entity receiving the license
- royalty_rate: The royalty percentage or rate structure. Capture the exact structure — flat rate, tiered rates, or category-specific rates. Include all tiers if applicable.
- royalty_base: What royalties are calculated on. Use the defined term the contract uses
  as the royalty base (e.g. "Net Sales", "Gross Sales", "FOB price").
  IMPORTANT: If the contract defines "Net Sales" as "gross invoiced sales less returns,
  credits, or allowances", the royalty base is "Net Sales" — not "Gross Sales".
  A definition that explains how net sales are derived from gross figures is still a
  net sales base. Look for the term being defined (e.g. "'Net Sales' means..."),
  not words inside the definition body.
- territories: List of regions or countries where the license applies
- product_categories: List of licensed product types/categories
- contract_start_date: When the agreement begins (ISO format if possible)
- contract_end_date: When the agreement ends (ISO format if possible)
- minimum_guarantee: Minimum guaranteed payment amount and currency
- advance_payment: Any advance/upfront payment amount and currency
- payment_terms: When and how royalties are due (e.g., "within 30 days of quarter end")
- reporting_frequency: How often royalty reports are due (e.g., monthly, quarterly)
- exclusivity: Whether the license is exclusive or non-exclusive

Rules:
- If a field is not found or not mentioned in the contract, set it to null.
- For royalty_rate, preserve the full structure. Examples:
  - Flat: "8% of net sales"
  - Tiered: [{"threshold": "$0-$1M", "rate": "5%"}, {"threshold": "$1M+", "rate": "7%"}]
  - Category-specific: {"apparel": "10%", "accessories": "8%"}
- For dates, use ISO 8601 format (YYYY-MM-DD) when the exact date is clear.
- For monetary values, include the currency (e.g., "$50,000 USD").
- territories should be a list of strings.
- product_categories should be a list of strings.

Also provide:
- confidence_score: A float from 0.0 to 1.0 indicating your overall confidence in the extraction accuracy.
- extraction_notes: A list of strings noting any ambiguities, assumptions, or areas of uncertainty.

Respond with ONLY valid JSON matching this schema:
{
  "licensor_name": string | null,
  "licensee_name": string | null,
  "royalty_rate": string | object | array | null,
  "royalty_base": string | null,
  "territories": [string] | null,
  "product_categories": [string] | null,
  "contract_start_date": string | null,
  "contract_end_date": string | null,
  "minimum_guarantee": string | null,
  "advance_payment": string | null,
  "payment_terms": string | null,
  "reporting_frequency": string | null,
  "exclusivity": string | null,
  "confidence_score": float,
  "extraction_notes": [string]
}

CONTRACT TEXT:
{contract_text}
"""


def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Extract text from a PDF using pdfplumber.
    Handles tables and complex layouts.
    Does NOT support scanned PDFs (no OCR).
    """
    text_parts = []

    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text()
            if page_text:
                text_parts.append(f"--- Page {i} ---\n{page_text}")

            # Extract tables
            tables = page.extract_tables()
            for table in tables:
                if table:
                    rows = []
                    for row in table:
                        cells = [str(cell).strip() if cell else "" for cell in row]
                        rows.append(" | ".join(cells))
                    if rows:
                        text_parts.append(f"[Table on page {i}]\n" + "\n".join(rows))

    full_text = "\n\n".join(text_parts)

    if not full_text.strip():
        raise ValueError(
            f"No text extracted from PDF. "
            "The PDF may be scanned/image-based (OCR not supported)."
        )

    return full_text


def extract_terms_with_claude(
    contract_text: str,
    api_key: str = None
) -> Tuple[ExtractedTerms, dict]:
    """
    Send contract text to Claude for extraction.

    Returns:
        (ExtractedTerms, token_usage)
    """
    if api_key is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = EXTRACTION_PROMPT.replace("{contract_text}", contract_text)

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = response.content[0].text

    # Parse JSON (handle markdown code fences)
    json_text = raw_text.strip()
    if json_text.startswith("```"):
        lines = json_text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        json_text = "\n".join(lines)

    # Parse into Pydantic model
    import json
    extracted_dict = json.loads(json_text)
    extracted = ExtractedTerms(**extracted_dict)

    token_usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
    }

    return extracted, token_usage


async def extract_contract(pdf_path: str) -> Tuple[ExtractedTerms, dict]:
    """
    Full extraction pipeline: PDF -> text -> Claude -> structured terms.

    Returns:
        (ExtractedTerms, token_usage)
    """
    # Step 1: Extract text from PDF
    contract_text = extract_text_from_pdf(pdf_path)

    # Step 2: Send to Claude
    extracted, token_usage = extract_terms_with_claude(contract_text)

    return extracted, token_usage
