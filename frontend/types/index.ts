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
  licensee_email: string | null         // optional contact email for auto-matching inbound reports
  agreement_number: string | null       // optional reference number for matching reports
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
  category_breakdown: CategorySales | null   // backend field name
  royalty_calculated: number                 // backend field name
  minimum_applied: boolean
  licensee_reported_royalty?: number | null   // Phase 1
  discrepancy_amount?: number | null           // Phase 1
  has_discrepancy?: boolean                    // Phase 1
  source_file_path?: string | null             // storage path for the uploaded sales report spreadsheet
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
  licensee_email: string | null
  agreement_number: string | null
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

// --- Phase 1.1: Spreadsheet Upload ---

export type LikhaField =
  | 'net_sales'
  | 'gross_sales'
  | 'returns'
  | 'product_category'
  | 'licensee_reported_royalty'
  | 'territory'
  | 'report_period'
  | 'licensee_name'
  | 'royalty_rate'
  | 'metadata'
  | 'ignore'

export type MappingSource = 'saved' | 'suggested' | 'ai' | 'none'

export interface ColumnMapping {
  [detectedColumnName: string]: LikhaField
}

export interface CategoryMapping {
  [reportCategory: string]: string  // report_cat -> contract_cat (empty string means "Exclude")
}

export interface CategoryResolution {
  required: boolean
  contract_categories: string[]
  report_categories: string[]
  suggested_category_mapping: CategoryMapping
  category_mapping_sources: Record<string, 'saved' | 'exact' | 'ai' | 'none'>
}

export interface UploadPreviewResponse {
  upload_id: string
  filename: string
  sheet_name: string
  total_rows: number
  data_rows: number
  detected_columns: string[]
  sample_rows: Record<string, string>[]
  suggested_mapping: ColumnMapping
  mapping_source: MappingSource
  mapping_sources?: Record<string, 'keyword' | 'ai' | 'none'>
  period_start: string
  period_end: string
  category_resolution?: CategoryResolution | null
}

export interface UploadConfirmRequest {
  upload_id: string
  column_mapping: ColumnMapping
  period_start: string
  period_end: string
  save_mapping: boolean
  category_mapping?: CategoryMapping
  override_duplicate?: boolean
}

export interface SavedMappingResponse {
  licensee_name: string
  column_mapping: ColumnMapping | null
  updated_at: string | null
}

export interface UploadWarning {
  field: string
  extracted_value: string
  contract_value: string
  message: string
}

export interface ConfirmSalesUploadResponse extends SalesPeriod {
  upload_warnings: UploadWarning[]
}

// --- Total Royalties Summary Types ---

export interface DashboardSummary {
  ytd_royalties: number
  current_year: number
}

export interface YearlyRoyalties {
  year: number
  royalties: number
}

export interface ContractTotals {
  contract_id: string
  total_royalties: number
  by_year: YearlyRoyalties[]
}

// --- Phase 2: Email Intake / Inbox ---

export interface InboundAddressResponse {
  inbound_address: string
}

export interface InboundReport {
  id: string
  user_id: string
  contract_id: string | null
  sender_email: string
  subject: string | null
  received_at: string
  attachment_filename: string | null
  attachment_path: string | null
  match_confidence: 'high' | 'medium' | 'none'
  status: 'pending' | 'confirmed' | 'rejected' | 'processed'
  contract_name: string | null
  // New fields from email intake matching ADR
  candidate_contract_ids: string[] | null
  suggested_period_start: string | null
  suggested_period_end: string | null
  sales_period_id: string | null
}

export interface ConfirmReportRequest {
  contract_id?: string
  open_wizard: boolean
}

export interface ConfirmReportResponse {
  redirect_url: string | null
}

// --- Period overlap check ---

/** One existing sales_period record returned by GET /api/upload/{contract_id}/period-check */
export interface OverlapRecord {
  id: string
  period_start: string           // ISO date string
  period_end: string             // ISO date string
  net_sales: number
  royalty_calculated: number
  created_at: string             // ISO datetime string
}

export interface FrequencyWarning {
  expected_frequency: string
  entered_days: number
  expected_range: [number, number]
  message: string
}

export interface PeriodCheckResponse {
  has_overlap: boolean
  overlapping_periods: OverlapRecord[]
  // Gap 3 fields:
  out_of_range: boolean
  contract_start_date: string | null
  contract_end_date: string | null
  frequency_warning: FrequencyWarning | null
  suggested_end_date: string | null
}
