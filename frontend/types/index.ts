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

// Contract types
export interface Contract {
  id: string
  user_id: string
  licensee_name: string
  licensor_name: string | null
  contract_start: string | null
  contract_end: string | null
  royalty_rate: RoyaltyRate
  royalty_base: 'net_sales' | 'gross_sales'
  territories: string[]
  product_categories: string[] | null
  minimum_guarantee: number | null
  mg_period: 'monthly' | 'quarterly' | 'annually' | null
  advance_payment: number | null
  reporting_frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually'
  pdf_url: string | null
  created_at: string
  updated_at: string
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
