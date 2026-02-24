/**
 * API client for backend endpoints.
 */

import { supabase } from './supabase'
import { getApiUrl } from './url-utils'
import type { Contract, UploadPreviewResponse, UploadConfirmRequest, SalesPeriod, SavedMappingResponse, ConfirmSalesUploadResponse, DashboardSummary, ContractTotals, InboundReport, InboundAddressResponse, PeriodCheckResponse } from '@/types'

// Re-export so existing imports of getApiUrl from '@/lib/api' keep working.
export { getApiUrl } from './url-utils'

// ---------------------------------------------------------------------------
// Simple in-memory TTL cache for read-only endpoints.
// Cache keys are endpoint URL strings; values are { data, expiresAt }.
// A 30-second TTL avoids redundant fetches when navigating between pages.
// ---------------------------------------------------------------------------
const TTL_MS = 30_000

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const _cache = new Map<string, CacheEntry<unknown>>()

function cacheGet<T>(key: string): T | undefined {
  const entry = _cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key)
    return undefined
  }
  return entry.data
}

function cacheSet<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + TTL_MS })
}

/** Invalidate all cached entries (call after any mutating operation). */
export function invalidateCache(): void {
  _cache.clear()
}

// Lazy — resolved on first use so window.location is available (not during SSR).
let _apiUrl: string | null = null
function getResolvedApiUrl(): string {
  if (!_apiUrl) _apiUrl = getApiUrl()
  return _apiUrl
}

export class ApiError extends Error {
  status: number
  data?: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

/**
 * Extract a human-readable message from a FastAPI error response body.
 * Handles both `{ detail: "string" }` and `{ detail: { detail: "string", error_code: "..." } }`.
 */
function extractErrorMessage(body: Record<string, unknown> | null, fallback: string): string {
  if (!body?.detail) return fallback
  if (typeof body.detail === 'string') return body.detail
  if (typeof body.detail === 'object' && body.detail !== null) {
    const inner = (body.detail as Record<string, unknown>).detail
    if (typeof inner === 'string') return inner
  }
  return fallback
}

/**
 * Returns true when the error is an ApiError with a 401 Unauthorized status.
 * Use this in page-level catch blocks to redirect to login instead of showing
 * an error panel.
 */
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

/**
 * Get auth headers with JWT token
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  return headers
}

export async function uploadContract(file: File) {
  const { data: { session } } = await supabase.auth.getSession()

  const formData = new FormData()
  formData.append('file', file)

  const headers: HeadersInit = {}
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  const response = await fetch(`${getResolvedApiUrl()}/api/contracts/extract`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to upload contract'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function createContract(data: any) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/contracts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail || 'Failed to create contract', response.status)
  }

  return response.json()
}

export async function confirmDraft(contractId: string, data: any): Promise<Contract> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/contracts/${contractId}/confirm`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to confirm contract'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function getContracts(options?: { include_drafts?: boolean }) {
  const headers = await getAuthHeaders()

  const url = new URL(`${getResolvedApiUrl()}/api/contracts`)
  if (options?.include_drafts) {
    url.searchParams.set('include_drafts', 'true')
  }

  const cacheKey = url.toString()
  const cached = cacheGet<Contract[]>(cacheKey)
  if (cached) return cached

  const response = await fetch(cacheKey, { headers })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to fetch contracts'),
      response.status,
      body
    )
  }

  const data = await response.json()
  cacheSet(cacheKey, data)
  return data
}

export async function getContract(id: string) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/contracts/${id}`, {
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to fetch contract'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function createSalesPeriod(data: any) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error('Failed to create sales period')
  }

  return response.json()
}

export async function getSalesPeriods(contractId: string) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/sales/contract/${contractId}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch sales periods')
  }

  return response.json()
}

export async function uploadSalesReport(
  contractId: string,
  file: File,
  periodStart: string,
  periodEnd: string
): Promise<UploadPreviewResponse> {
  const { data: { session } } = await supabase.auth.getSession()

  const formData = new FormData()
  formData.append('file', file)
  formData.append('period_start', periodStart)
  formData.append('period_end', periodEnd)

  const headers: HeadersInit = {}
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  const response = await fetch(`${getResolvedApiUrl()}/api/sales/upload/${contractId}`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to upload sales report'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function confirmSalesUpload(
  contractId: string,
  data: UploadConfirmRequest
): Promise<ConfirmSalesUploadResponse> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/sales/upload/${contractId}/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to confirm sales upload'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function getSavedMapping(contractId: string): Promise<SavedMappingResponse> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/sales/upload/mapping/${contractId}`, {
    headers,
  })

  if (!response.ok) {
    throw new ApiError('Failed to fetch saved mapping', response.status)
  }

  return response.json()
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const headers = await getAuthHeaders()
  const cacheKey = `${getResolvedApiUrl()}/api/sales/dashboard-summary`
  const cached = cacheGet<DashboardSummary>(cacheKey)
  if (cached) return cached

  const response = await fetch(cacheKey, { headers })
  if (!response.ok) {
    throw new ApiError('Failed to fetch dashboard summary', response.status)
  }
  const data: DashboardSummary = await response.json()
  cacheSet(cacheKey, data)
  return data
}

export async function getContractTotals(contractId: string): Promise<ContractTotals> {
  const headers = await getAuthHeaders()
  const cacheKey = `${getResolvedApiUrl()}/api/sales/contract/${contractId}/totals`
  const cached = cacheGet<ContractTotals>(cacheKey)
  if (cached) return cached

  const response = await fetch(cacheKey, { headers })
  if (!response.ok) {
    throw new ApiError('Failed to fetch contract totals', response.status)
  }
  const data: ContractTotals = await response.json()
  cacheSet(cacheKey, data)
  return data
}

/**
 * Download the royalty report template xlsx for a contract.
 * Fetches the binary file with auth headers, then triggers a browser download
 * using a temporary object URL.  Only works for active contracts — the backend
 * returns 409 for drafts and 404 if the contract is not found.
 */
export async function downloadReportTemplate(contractId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()

  const headers: HeadersInit = {}
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  const response = await fetch(
    `${getResolvedApiUrl()}/api/contracts/${contractId}/report-template`,
    { method: 'GET', headers }
  )

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to download report template'),
      response.status,
      body
    )
  }

  const blob = await response.blob()

  // Derive filename from Content-Disposition, falling back to a sensible default
  const disposition = response.headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  const filename = filenameMatch ? filenameMatch[1] : 'royalty_report_template.xlsx'

  // Trigger browser download via a temporary <a> element
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

// --- Phase 2: Email Intake / Inbox ---

export async function getInboundReports(): Promise<InboundReport[]> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/email-intake/reports`, {
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to fetch inbound reports'),
      response.status,
      body
    )
  }

  return response.json()
}

export async function confirmReport(reportId: string, contractId?: string): Promise<void> {
  const headers = await getAuthHeaders()

  const body: { contract_id?: string } = {}
  if (contractId) {
    body.contract_id = contractId
  }

  const response = await fetch(`${getResolvedApiUrl()}/api/email-intake/${reportId}/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null)
    throw new ApiError(
      typeof responseBody?.detail === 'string' ? responseBody.detail : 'Failed to confirm report',
      response.status,
      responseBody
    )
  }
}

export async function rejectReport(reportId: string): Promise<void> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/email-intake/${reportId}/reject`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to reject report'),
      response.status,
      body
    )
  }
}

/**
 * Check whether any existing sales_periods for the given contract overlap the
 * requested date range.  Called from the Step 1 date fields with a 400 ms
 * debounce.  Errors are expected to be swallowed by the caller — the confirm-
 * time 409 is the safety net.
 */
export async function checkPeriodOverlap(
  contractId: string,
  start: string,
  end: string
): Promise<PeriodCheckResponse> {
  const headers = await getAuthHeaders()

  const url = new URL(`${getResolvedApiUrl()}/api/sales/upload/${contractId}/period-check`)
  url.searchParams.set('start', start)
  url.searchParams.set('end', end)

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to check period overlap'),
      response.status,
      body
    )
  }

  return response.json()
}

/**
 * Get a short-lived signed download URL for the source spreadsheet attached to
 * a sales period.  The backend generates the URL from the stored
 * source_file_path so the caller never needs to construct storage paths.
 */
export async function getSalesReportDownloadUrl(
  contractId: string,
  periodId: string
): Promise<string> {
  const headers = await getAuthHeaders()

  const response = await fetch(
    `${getResolvedApiUrl()}/api/sales/upload/${contractId}/periods/${periodId}/source-file`,
    { headers }
  )

  if (!response.ok) {
    throw new ApiError('Failed to get download URL', response.status)
  }

  const data = await response.json()
  return data.download_url as string
}

/**
 * Get the user's unique inbound email address for forwarding royalty reports.
 */
export async function getInboundAddress(): Promise<InboundAddressResponse> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${getResolvedApiUrl()}/api/email-intake/inbound-address`, {
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      extractErrorMessage(body, 'Failed to fetch inbound address'),
      response.status,
      body
    )
  }

  return response.json()
}
