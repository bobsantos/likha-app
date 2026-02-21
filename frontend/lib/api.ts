/**
 * API client for backend endpoints.
 */

import { supabase } from './supabase'
import { getApiUrl } from './url-utils'
import type { Contract } from '@/types'

// Re-export so existing imports of getApiUrl from '@/lib/api' keep working.
export { getApiUrl } from './url-utils'

const API_URL = getApiUrl()

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

  const response = await fetch(`${API_URL}/api/contracts/extract`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      typeof body?.detail === 'string' ? body.detail : 'Failed to upload contract',
      response.status,
      body
    )
  }

  return response.json()
}

export async function createContract(data: any) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}/api/contracts`, {
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

  const response = await fetch(`${API_URL}/api/contracts/${contractId}/confirm`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      typeof body?.detail === 'string' ? body.detail : 'Failed to confirm contract',
      response.status,
      body
    )
  }

  return response.json()
}

export async function getContracts(options?: { include_drafts?: boolean }) {
  const headers = await getAuthHeaders()

  const url = new URL(`${API_URL}/api/contracts`)
  if (options?.include_drafts) {
    url.searchParams.set('include_drafts', 'true')
  }

  const response = await fetch(url.toString(), {
    headers,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch contracts')
  }

  return response.json()
}

export async function getContract(id: string) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}/api/contracts/${id}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch contract')
  }

  return response.json()
}

export async function createSalesPeriod(data: any) {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}/api/sales`, {
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

  const response = await fetch(`${API_URL}/api/sales/contract/${contractId}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch sales periods')
  }

  return response.json()
}
