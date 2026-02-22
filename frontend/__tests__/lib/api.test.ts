/**
 * Tests for API client — Phase 2: ApiError.data and confirmDraft
 */

import { ApiError, confirmDraft } from '@/lib/api'
import type { Contract, ContractStatus } from '@/types'

// Mock supabase
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// Mock global fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('stores status code', () => {
    const err = new ApiError('Not found', 404)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
  })

  it('stores optional data payload', () => {
    const data = { code: 'DUPLICATE_FILENAME', message: 'Already exists' }
    const err = new ApiError('Conflict', 409, data)
    expect(err.data).toEqual(data)
  })

  it('data is undefined when not provided', () => {
    const err = new ApiError('Server error', 500)
    expect(err.data).toBeUndefined()
  })

  it('is an instance of Error', () => {
    const err = new ApiError('Bad request', 400)
    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// confirmDraft
// ---------------------------------------------------------------------------

describe('confirmDraft', () => {
  const mockActiveContract: Contract = {
    id: 'draft-abc-123',
    user_id: 'user-1',
    status: 'active',
    filename: 'Nike_License_2024.pdf',
    licensee_name: 'Nike Inc.',
    licensor_name: 'Author Name',
    contract_start: '2024-01-01',
    contract_end: '2025-12-31',
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US', 'Canada'],
    product_categories: null,
    minimum_guarantee: null,
    mg_period: null,
    advance_payment: null,
    reporting_frequency: 'quarterly',
    pdf_url: 'https://example.com/contract.pdf',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  }

  const confirmPayload = {
    licensee_name: 'Nike Inc.',
    licensor_name: 'Author Name',
    royalty_rate: 0.15,
    royalty_base: 'net_sales' as const,
    territories: ['US', 'Canada'],
    product_categories: null,
    contract_start_date: '2024-01-01',
    contract_end_date: '2025-12-31',
    minimum_guarantee: null,
    advance_payment: null,
    reporting_frequency: 'quarterly' as const,
  }

  it('calls PUT /api/contracts/{id}/confirm', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockActiveContract,
    })

    await confirmDraft('draft-abc-123', confirmPayload)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/contracts/draft-abc-123/confirm'),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('sends JSON body with contract data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockActiveContract,
    })

    await confirmDraft('draft-abc-123', confirmPayload)

    const [, options] = mockFetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual(confirmPayload)
  })

  it('sends Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockActiveContract,
    })

    await confirmDraft('draft-abc-123', confirmPayload)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer test-token')
  })

  it('returns the confirmed contract', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockActiveContract,
    })

    const result = await confirmDraft('draft-abc-123', confirmPayload)
    expect(result).toEqual(mockActiveContract)
  })

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Already active' }),
    })

    await expect(confirmDraft('draft-abc-123', confirmPayload)).rejects.toBeInstanceOf(ApiError)
  })

  it('thrown ApiError has correct status code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    })

    try {
      await confirmDraft('draft-abc-123', confirmPayload)
    } catch (err) {
      expect(err instanceof ApiError && err.status).toBe(404)
    }
  })
})
