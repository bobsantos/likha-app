/**
 * TypeScript type definitions for Likha app
 */

// Auth types
export interface User {
  id: string
  email: string
  created_at?: string
}

export interface AuthError {
  message: string
  status?: number
}

// Contract status — draft is persisted at extraction time, active after user confirms
export type ContractStatus = 'draft' | 'active'

// Contract types
//
// Field names match the backend Contract Pydantic model exactly.
// Dates are contract_start_date / contract_end_date (NOT contract_start / contract_end).
// licensor_name is not a top-level DB column — it lives inside extracted_terms.
export interface Contract {
  id: string
  user_id: string
  status: ContractStatus
  filename: string | null
  licensee_name: string | null          // nullable for drafts (not yet reviewed)
  contract_start_date: string | null    // ISO date string, e.g. "2024-01-01"
  contract_end_date: string | null      // ISO date string, e.g. "2025-12-31"
  royalty_rate: RoyaltyRate | null      // nullable for drafts
  royalty_base: 'net_sales' | 'gross_sales' | null  // nullable for drafts
  territories: string[] | null
  product_categories: string[] | null
  minimum_guarantee: number | null
  minimum_guarantee_period: 'monthly' | 'quarterly' | 'annually' | null
  advance_payment: number | null
  reporting_frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually' | null  // nullable for drafts
  pdf_url: string | null
  extracted_terms: Record<string, unknown> | null   // raw extraction JSON, includes licensor_name
  storage_path: string | null
  created_at: string
  updated_at: string
  // Present on draft contracts returned by GET /contracts/{id}.
  // Backend runs normalize_extracted_terms on the stored extracted_terms so the
  // frontend can bind these values directly to form inputs without any parsing.
  form_values?: FormValues | null
}

// Royalty rate can be flat, tiered, or category-specific
export type RoyaltyRate = number | TieredRate | CategoryRate

export interface TieredRate {
  type: 'tiered'
  tiers: {
    min: number
    max: number | null
    rate: number
  }[]
}

export interface CategoryRate {
  type: 'category'
  rates: {
    [category: string]: number
  }
}

// Extracted terms from PDF (field names match backend ExtractedTerms model)
export interface ExtractedTerms {
  licensor_name: string | null
  licensee_name: string | null
  contract_start_date: string | null
  contract_end_date: string | null
  royalty_rate: string | object | null
  royalty_base: string | null
  territories: string[] | null
  product_categories: string[] | null
  minimum_guarantee: string | null
  advance_payment: string | null
  payment_terms: string | null
  reporting_frequency: string | null
  exclusivity: string | null
  confidence_score: number | null
  extraction_notes: string[] | null
}

// Sales period types
export interface SalesPeriod {
  id: string
  contract_id: string
  period_start: string
  period_end: string
  net_sales: number
  category_sales: CategorySales | null
  calculated_royalty: number
  minimum_applied: boolean
  created_at: string
}

export interface CategorySales {
  [category: string]: number
}

// API response types
export interface ApiResponse<T> {
  data?: T
  error?: string
}

export interface FormValues {
  licensee_name: string
  licensor_name: string
  royalty_rate: number | object | string
  royalty_base: 'net_sales' | 'gross_sales'
  minimum_guarantee: number | null
  advance_payment: number | null
  contract_start_date: string
  contract_end_date: string
  reporting_frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually'
  territories: string[]
}

export interface ExtractionResponse {
  contract_id: string   // draft contract ID created by backend at extraction time
  extracted_terms: ExtractedTerms
  form_values: FormValues
  token_usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  filename: string
  storage_path: string
  pdf_url: string
}

export interface DuplicateContractInfo {
  id: string
  filename: string
  licensee_name?: string   // present for active contracts, absent for drafts
  created_at: string
  status: ContractStatus
}
