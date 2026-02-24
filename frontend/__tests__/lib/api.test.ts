/**
 * Tests for API client — Phase 2: ApiError.data and confirmDraft
 */

import { ApiError, confirmDraft, getContracts, getContract, isUnauthorizedError, downloadReportTemplate } from '@/lib/api'
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
// isUnauthorizedError
// ---------------------------------------------------------------------------

describe('isUnauthorizedError', () => {
  it('returns true for ApiError with status 401', () => {
    const err = new ApiError('Unauthorized', 401)
    expect(isUnauthorizedError(err)).toBe(true)
  })

  it('returns false for ApiError with status 404', () => {
    const err = new ApiError('Not found', 404)
    expect(isUnauthorizedError(err)).toBe(false)
  })

  it('returns false for ApiError with status 500', () => {
    const err = new ApiError('Server error', 500)
    expect(isUnauthorizedError(err)).toBe(false)
  })

  it('returns false for plain Error', () => {
    const err = new Error('Network error')
    expect(isUnauthorizedError(err)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isUnauthorizedError('some string')).toBe(false)
    expect(isUnauthorizedError(null)).toBe(false)
    expect(isUnauthorizedError(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getContracts — should throw ApiError with status code
// ---------------------------------------------------------------------------

describe('getContracts', () => {
  it('throws ApiError with status 401 when backend returns 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Not authenticated' }),
    })

    await expect(getContracts()).rejects.toBeInstanceOf(ApiError)

    try {
      await getContracts()
    } catch (err) {
      // reset mock and try again — need two calls total
    }
  })

  it('thrown ApiError from getContracts has status 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Not authenticated' }),
    })

    let caught: unknown
    try {
      await getContracts()
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(401)
  })

  it('thrown ApiError from getContracts has status 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Internal server error' }),
    })

    let caught: unknown
    try {
      await getContracts()
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(500)
  })

  it('returns data on success', async () => {
    const mockContracts = [{ id: 'c1', licensee_name: 'Acme' }]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockContracts,
    })

    const result = await getContracts()
    expect(result).toEqual(mockContracts)
  })
})

// ---------------------------------------------------------------------------
// getContract — should throw ApiError with status code
// ---------------------------------------------------------------------------

describe('getContract', () => {
  it('thrown ApiError from getContract has status 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Not authenticated' }),
    })

    let caught: unknown
    try {
      await getContract('some-id')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(401)
  })

  it('thrown ApiError from getContract has status 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    })

    let caught: unknown
    try {
      await getContract('some-id')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(404)
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

// ---------------------------------------------------------------------------
// downloadReportTemplate
// ---------------------------------------------------------------------------

describe('downloadReportTemplate', () => {
  // Stub URL.createObjectURL and URL.revokeObjectURL since jsdom doesn't support them
  const mockCreateObjectURL = jest.fn().mockReturnValue('blob:mock-url')
  const mockRevokeObjectURL = jest.fn()

  beforeEach(() => {
    URL.createObjectURL = mockCreateObjectURL
    URL.revokeObjectURL = mockRevokeObjectURL
    mockCreateObjectURL.mockClear()
    mockRevokeObjectURL.mockClear()
  })

  it('calls GET /api/contracts/{id}/report-template', async () => {
    const mockBlob = new Blob(['xlsx-content'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => h === 'content-disposition' ? 'attachment; filename="royalty_report_template_acme.xlsx"' : null },
      blob: async () => mockBlob,
    })

    await downloadReportTemplate('contract-abc')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/contracts/contract-abc/report-template'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('sends Authorization header with Bearer token', async () => {
    const mockBlob = new Blob(['xlsx'])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      blob: async () => mockBlob,
    })

    await downloadReportTemplate('contract-abc')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer test-token')
  })

  it('creates an object URL from the response blob', async () => {
    const mockBlob = new Blob(['xlsx'])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      blob: async () => mockBlob,
    })

    await downloadReportTemplate('contract-abc')

    expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob)
  })

  it('revokes the object URL after triggering download', async () => {
    const mockBlob = new Blob(['xlsx'])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      blob: async () => mockBlob,
    })

    await downloadReportTemplate('contract-abc')

    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('throws ApiError with status 404 when contract not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Contract not found' }),
    })

    let caught: unknown
    try {
      await downloadReportTemplate('missing-id')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(404)
  })

  it('throws ApiError with status 409 when contract is a draft', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Contract is not active' }),
    })

    let caught: unknown
    try {
      await downloadReportTemplate('draft-id')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })

  it('uses filename from Content-Disposition header when present', async () => {
    const mockBlob = new Blob(['xlsx'])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) =>
          h === 'content-disposition'
            ? 'attachment; filename="royalty_report_template_acme_corp.xlsx"'
            : null,
      },
      blob: async () => mockBlob,
    })

    // Spy on anchor element click to capture the download filename
    const clickSpy = jest.fn()
    const mockAnchor = { href: '', download: '', click: clickSpy, remove: jest.fn() }
    jest.spyOn(document, 'createElement').mockReturnValueOnce(mockAnchor as unknown as HTMLElement)
    jest.spyOn(document.body, 'appendChild').mockImplementationOnce(() => mockAnchor as unknown as Node)

    await downloadReportTemplate('contract-abc')

    expect(mockAnchor.download).toBe('royalty_report_template_acme_corp.xlsx')

    jest.restoreAllMocks()
  })

  it('falls back to a default filename when Content-Disposition is absent', async () => {
    const mockBlob = new Blob(['xlsx'])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      blob: async () => mockBlob,
    })

    const clickSpy = jest.fn()
    const mockAnchor = { href: '', download: '', click: clickSpy, remove: jest.fn() }
    jest.spyOn(document, 'createElement').mockReturnValueOnce(mockAnchor as unknown as HTMLElement)
    jest.spyOn(document.body, 'appendChild').mockImplementationOnce(() => mockAnchor as unknown as Node)

    await downloadReportTemplate('contract-abc')

    expect(mockAnchor.download).toBe('royalty_report_template.xlsx')

    jest.restoreAllMocks()
  })
})
