/**
 * Tests for Gap 3: Contract date range and reporting frequency validation
 * TDD: written before the implementation
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { getContract, getSavedMapping, checkPeriodOverlap } from '@/lib/api'
import type { Contract, PeriodCheckResponse } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API — keep ApiError as the real class so tests can instantiate it
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getContract: jest.fn(),
  getSavedMapping: jest.fn(),
  uploadSalesReport: jest.fn(),
  confirmSalesUpload: jest.fn(),
  checkPeriodOverlap: jest.fn(),
}))

const mockContract: Contract = {
  id: 'contract-1',
  user_id: 'user-1',
  status: 'active',
  filename: 'sunrise-apparel.pdf',
  licensee_name: 'Sunrise Apparel Co.',
  contract_start_date: '2024-01-01',
  contract_end_date: '2025-12-31',
  royalty_rate: 0.08,
  royalty_base: 'net_sales',
  territories: ['US'],
  product_categories: null,
  minimum_guarantee: null,
  minimum_guarantee_period: null,
  advance_payment: null,
  reporting_frequency: 'quarterly',
  pdf_url: null,
  extracted_terms: null,
  storage_path: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const baseOverlapResponse: PeriodCheckResponse = {
  has_overlap: false,
  overlapping_periods: [],
  out_of_range: false,
  contract_start_date: '2024-01-01',
  contract_end_date: '2025-12-31',
  frequency_warning: null,
  suggested_end_date: null,
}

describe('Sales Upload Wizard — Gap 3: Contract date range and frequency validation', () => {
  const mockPush = jest.fn()
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSavedMapping = getSavedMapping as jest.MockedFunction<typeof getSavedMapping>
  const mockCheckPeriodOverlap = checkPeriodOverlap as jest.MockedFunction<typeof checkPeriodOverlap>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('contract-1'),
    })
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSavedMapping.mockResolvedValue({
      licensee_name: 'Sunrise Apparel Co.',
      column_mapping: null,
      updated_at: null,
    })
    // Default: no issues
    mockCheckPeriodOverlap.mockResolvedValue(baseOverlapResponse)
  })

  /** Helper: render and wait for Step 1 to be ready */
  async function renderAndWaitForStep1() {
    render(<SalesUploadPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })
  }

  /** Helper: fill in dates and advance the debounce */
  async function fillDatesAndWait(start: string, end: string) {
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: start } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: end } })
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
  }

  // --- Contract date range warning ---

  it('shows contract-range warning when period is outside contract dates', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows contract start and end dates in the contract-range warning body', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        // Body should mention the contract date range
        expect(screen.getByText(/jan 1, 2024/i)).toBeInTheDocument()
        expect(screen.getByText(/dec 31, 2025/i)).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('contract-range card has Continue anyway and Change dates buttons', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /continue anyway/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /change dates/i })).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('Continue anyway on range card dismisses it and enables drop zone', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /continue anyway/i })).toBeInTheDocument()
      })

      // There may be multiple "Continue anyway" buttons if multiple warnings appear —
      // click the first one (contract-range card is rendered first)
      const continueButtons = screen.getAllByRole('button', { name: /continue anyway/i })
      fireEvent.click(continueButtons[0])

      await waitFor(() => {
        expect(
          screen.queryByText(/reporting period falls outside contract dates/i)
        ).not.toBeInTheDocument()
      })

      // Drop zone should be enabled now
      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).not.toContain('pointer-events-none')
    } finally {
      jest.useRealTimers()
    }
  })

  it('Change dates on range card clears date fields and dismisses card', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /change dates/i })).toBeInTheDocument()
      })

      const changeDatesButtons = screen.getAllByRole('button', { name: /change dates/i })
      fireEvent.click(changeDatesButtons[0])

      await waitFor(() => {
        expect(
          screen.queryByText(/reporting period falls outside contract dates/i)
        ).not.toBeInTheDocument()
        expect((screen.getByLabelText(/period start/i) as HTMLInputElement).value).toBe('')
        expect((screen.getByLabelText(/period end/i) as HTMLInputElement).value).toBe('')
      })
    } finally {
      jest.useRealTimers()
    }
  })

  // --- Frequency mismatch warning ---

  it('shows frequency mismatch warning when frequency_warning is set', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        // The frequency-mismatch card heading should appear
        expect(
          screen.getByText(/this contract requires quarterly reporting/i)
        ).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows the frequency_warning.message in the card body', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(
          screen.getByText(/59 days entered; quarterly periods are typically 45–135 days/i)
        ).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('Continue anyway on frequency card dismisses it', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByText(/59 days entered/i)).toBeInTheDocument()
      })

      const continueButtons = screen.getAllByRole('button', { name: /continue anyway/i })
      fireEvent.click(continueButtons[0])

      await waitFor(() => {
        expect(screen.queryByText(/59 days entered/i)).not.toBeInTheDocument()
      })

      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).not.toContain('pointer-events-none')
    } finally {
      jest.useRealTimers()
    }
  })

  // --- Suggested end date ---

  it('shows suggested end date when available', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: '2025-03-31',
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByText(/did you mean/i)).toBeInTheDocument()
        expect(screen.getByText(/mar 31, 2025/i)).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows Use these dates button when suggested_end_date is available', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: '2025-03-31',
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /use these dates/i })).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('Use these dates updates period end to suggested value', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: '2025-03-31',
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /use these dates/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /use these dates/i }))

      await waitFor(() => {
        expect((screen.getByLabelText(/period end/i) as HTMLInputElement).value).toBe('2025-03-31')
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not show Did you mean row when suggested_end_date is null', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: null,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-15', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByText(/59 days entered/i)).toBeInTheDocument()
      })

      expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /use these dates/i })).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  // --- Drop zone gating ---

  it('drop zone is disabled when any warning is unacknowledged', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
      })

      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).toContain('pointer-events-none')
      expect(dropZone.className).toContain('opacity-50')
    } finally {
      jest.useRealTimers()
    }
  })

  it('drop zone is disabled while frequency warning is unacknowledged', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-02-28')

      await waitFor(() => {
        expect(screen.getByText(/59 days entered/i)).toBeInTheDocument()
      })

      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).toContain('pointer-events-none')
      expect(dropZone.className).toContain('opacity-50')
    } finally {
      jest.useRealTimers()
    }
  })

  // --- All three warnings coexist ---

  it('all three warnings can coexist — overlap, range, frequency', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
      out_of_range: true,
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: null,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-02-28')

      await waitFor(() => {
        // Contract-range card
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
        // Frequency card
        expect(screen.getByText(/59 days entered/i)).toBeInTheDocument()
        // Overlap card
        expect(screen.getByText(/a sales record already exists for this period/i)).toBeInTheDocument()
      })

      // Multiple role="alert" cards are rendered
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBeGreaterThanOrEqual(3)

      // Drop zone is disabled
      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).toContain('pointer-events-none')
    } finally {
      jest.useRealTimers()
    }
  })

  it('all warnings must be acknowledged before drop zone is enabled', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
      out_of_range: true,
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
      frequency_warning: {
        expected_frequency: 'quarterly',
        entered_days: 59,
        expected_range: [45, 135] as [number, number],
        message: '59 days entered; quarterly periods are typically 45–135 days.',
      },
      suggested_end_date: null,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-02-28')

      await waitFor(() => {
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
      })

      // Acknowledge contract-range card
      let continueButtons = screen.getAllByRole('button', { name: /continue anyway/i })
      fireEvent.click(continueButtons[0])

      // Drop zone is still disabled (frequency and overlap still unacknowledged)
      await waitFor(() => {
        expect(
          screen.queryByText(/reporting period falls outside contract dates/i)
        ).not.toBeInTheDocument()
      })

      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).toContain('pointer-events-none')

      // Acknowledge frequency card
      continueButtons = screen.getAllByRole('button', { name: /continue anyway/i })
      fireEvent.click(continueButtons[0])

      await waitFor(() => {
        expect(screen.queryByText(/59 days entered/i)).not.toBeInTheDocument()
      })

      // Still disabled because overlap is pending
      expect(screen.getByTestId('drop-zone').className).toContain('pointer-events-none')

      // Acknowledge overlap card
      fireEvent.click(screen.getByRole('button', { name: /replace existing record/i }))

      await waitFor(() => {
        expect(
          screen.queryByText(/a sales record already exists for this period/i)
        ).not.toBeInTheDocument()
        expect(screen.getByTestId('drop-zone').className).not.toContain('pointer-events-none')
      })
    } finally {
      jest.useRealTimers()
    }
  })

  // --- Acknowledgment resets on date change ---

  it('acknowledgment flags reset when dates change', async () => {
    jest.useFakeTimers()
    // Default: all calls return out_of_range: true
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: true,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2026-01-01', '2026-03-31')

      await waitFor(() => {
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
      })

      // Acknowledge the range warning
      const continueButtons = screen.getAllByRole('button', { name: /continue anyway/i })
      fireEvent.click(continueButtons[0])

      await waitFor(() => {
        expect(
          screen.queryByText(/reporting period falls outside contract dates/i)
        ).not.toBeInTheDocument()
      })

      // Change the end date — mock still returns out_of_range: true
      fireEvent.change(screen.getByLabelText(/period end/i), {
        target: { value: '2026-06-30' },
      })

      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      // The warning must reappear (acknowledgment was reset on date change)
      await waitFor(() => {
        expect(
          screen.getByText(/reporting period falls outside contract dates/i)
        ).toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  // --- No false positives when all checks pass ---

  it('does not show any warning cards when all checks pass', async () => {
    jest.useFakeTimers()
    // Reset to clear any stale Once queues from previous tests
    mockCheckPeriodOverlap.mockReset()
    mockCheckPeriodOverlap.mockResolvedValue({
      ...baseOverlapResponse,
      out_of_range: false,
      frequency_warning: null,
    })

    try {
      await renderAndWaitForStep1()
      await fillDatesAndWait('2025-01-01', '2025-03-31')

      await waitFor(() => {
        // No warning text should appear
        expect(
          screen.queryByText(/reporting period falls outside contract dates/i)
        ).not.toBeInTheDocument()
        expect(screen.queryByText(/days entered/i)).not.toBeInTheDocument()
        expect(
          screen.queryByText(/a sales record already exists/i)
        ).not.toBeInTheDocument()
      })

      // Drop zone should be enabled
      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).not.toContain('pointer-events-none')
    } finally {
      jest.useRealTimers()
    }
  })
})
