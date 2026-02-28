/**
 * Tests for CategoryMapper component
 * TDD: written before the implementation
 */

import { render, screen, fireEvent } from '@testing-library/react'
import CategoryMapper from '@/components/sales-upload/category-mapper'
import type { CategoryMapping } from '@/types'

const contractCategories = [
  { name: 'Apparel', rate: 0.10 },
  { name: 'Accessories', rate: 0.12 },
  { name: 'Footwear', rate: 0.08 },
]

const defaultProps = {
  reportCategories: ['Tops & Bottoms', 'Hard Accessories', 'Footwear'],
  contractCategories,
  suggestedMapping: {
    'Tops & Bottoms': 'Apparel',
    'Hard Accessories': 'Accessories',
    'Footwear': 'Footwear',
  } as CategoryMapping,
  mappingSources: {
    'Tops & Bottoms': 'ai',
    'Hard Accessories': 'ai',
    'Footwear': 'exact',
  } as Record<string, 'saved' | 'exact' | 'ai' | 'none'>,
  licenseeName: 'Meridian Goods LLC',
  onConfirm: jest.fn(),
  onBack: jest.fn(),
}

describe('CategoryMapper component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the heading "Map Category Names"', () => {
    render(<CategoryMapper {...defaultProps} />)
    expect(screen.getByRole('heading', { name: /map category names/i })).toBeInTheDocument()
  })

  it('renders one row per report category', () => {
    render(<CategoryMapper {...defaultProps} />)
    expect(screen.getByText('Tops & Bottoms')).toBeInTheDocument()
    expect(screen.getByText('Hard Accessories')).toBeInTheDocument()
    expect(screen.getByText('Footwear')).toBeInTheDocument()
  })

  it('shows exact match row as plain text with no dropdown (source: exact)', () => {
    render(<CategoryMapper {...defaultProps} />)
    // "Footwear" is exact match — should show "(exact match)" text and no dropdown for it
    expect(screen.getByText(/exact match/i)).toBeInTheDocument()
    // Dropdowns only for non-exact-match rows (2 out of 3)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('pre-fills AI-suggested rows with the suggested mapping value', () => {
    render(<CategoryMapper {...defaultProps} />)
    const dropdowns = screen.getAllByRole('combobox')
    // Tops & Bottoms -> Apparel, Hard Accessories -> Accessories
    const values = dropdowns.map((d) => (d as HTMLSelectElement).value)
    expect(values).toContain('Apparel')
    expect(values).toContain('Accessories')
  })

  it('shows "AI" badge for AI-suggested rows', () => {
    render(<CategoryMapper {...defaultProps} />)
    const aiBadges = screen.getAllByText('AI')
    // Two AI-suggested rows
    expect(aiBadges).toHaveLength(2)
  })

  it('shows "Auto" badge for saved-alias rows', () => {
    const props = {
      ...defaultProps,
      mappingSources: {
        'Tops & Bottoms': 'saved' as const,
        'Hard Accessories': 'ai' as const,
        'Footwear': 'exact' as const,
      },
    }
    render(<CategoryMapper {...props} />)
    expect(screen.getByText('Auto')).toBeInTheDocument()
  })

  it('shows amber AlertCircle for unmapped rows (source: none)', () => {
    const props = {
      ...defaultProps,
      suggestedMapping: {
        'Tops & Bottoms': '',
        'Hard Accessories': 'Accessories',
        'Footwear': 'Footwear',
      } as CategoryMapping,
      mappingSources: {
        'Tops & Bottoms': 'none' as const,
        'Hard Accessories': 'ai' as const,
        'Footwear': 'exact' as const,
      },
    }
    render(<CategoryMapper {...props} />)
    // Unmapped warning banner appears
    expect(screen.getByText(/all categories must be mapped before you can continue/i)).toBeInTheDocument()
  })

  it('Continue button is disabled when any category is unmapped', () => {
    const props = {
      ...defaultProps,
      suggestedMapping: {
        'Tops & Bottoms': '',
        'Hard Accessories': 'Accessories',
        'Footwear': 'Footwear',
      } as CategoryMapping,
      mappingSources: {
        'Tops & Bottoms': 'none' as const,
        'Hard Accessories': 'ai' as const,
        'Footwear': 'exact' as const,
      },
    }
    render(<CategoryMapper {...props} />)
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
  })

  it('Continue button is enabled when all categories are mapped', () => {
    render(<CategoryMapper {...defaultProps} />)
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
  })

  it('dropdown options include each contract category with rate', () => {
    render(<CategoryMapper {...defaultProps} />)
    const dropdowns = screen.getAllByRole('combobox')
    // First dropdown should contain Apparel, Accessories, Footwear options
    expect(dropdowns[0]).toContainHTML('Apparel')
    expect(dropdowns[0]).toContainHTML('Accessories')
    expect(dropdowns[0]).toContainHTML('Footwear')
  })

  it('dropdown options include "Exclude from calculation" option', () => {
    render(<CategoryMapper {...defaultProps} />)
    const dropdowns = screen.getAllByRole('combobox')
    expect(dropdowns[0]).toContainHTML('Exclude from calculation')
  })

  it('shows contract category rates in dropdown options', () => {
    render(<CategoryMapper {...defaultProps} />)
    // Rate display e.g. "Apparel (10%)"
    const dropdowns = screen.getAllByRole('combobox')
    expect(dropdowns[0]).toContainHTML('10%')
    expect(dropdowns[0]).toContainHTML('12%')
    expect(dropdowns[0]).toContainHTML('8%')
  })

  it('calls onConfirm with correct categoryMapping when Continue clicked', () => {
    const onConfirm = jest.fn()
    render(<CategoryMapper {...defaultProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryMapping: expect.objectContaining({
          'Tops & Bottoms': 'Apparel',
          'Hard Accessories': 'Accessories',
          'Footwear': 'Footwear',
        }),
      })
    )
  })

  it('calls onConfirm with saveAliases boolean', () => {
    const onConfirm = jest.fn()
    render(<CategoryMapper {...defaultProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        saveAliases: expect.any(Boolean),
      })
    )
  })

  it('calls onBack when Back button is clicked', () => {
    const onBack = jest.fn()
    render(<CategoryMapper {...defaultProps} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('save checkbox is rendered and checked by default', () => {
    render(<CategoryMapper {...defaultProps} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
    expect(checkbox).toBeChecked()
  })

  it('save checkbox label references the licensee name', () => {
    render(<CategoryMapper {...defaultProps} />)
    expect(screen.getByText(/Meridian Goods LLC/)).toBeInTheDocument()
  })

  it('unchecking save checkbox passes saveAliases: false to onConfirm', () => {
    const onConfirm = jest.fn()
    render(<CategoryMapper {...defaultProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ saveAliases: false })
    )
  })

  it('info banner shows count summary (matched / AI suggested / needs attention)', () => {
    render(<CategoryMapper {...defaultProps} />)
    // 1 exact match, 2 AI, 0 unmapped
    expect(screen.getByText(/matched automatically/i)).toBeInTheDocument()
    expect(screen.getByText(/suggested by AI/i)).toBeInTheDocument()
  })

  it('allows changing a dropdown and reflects in onConfirm payload', () => {
    const onConfirm = jest.fn()
    render(<CategoryMapper {...defaultProps} onConfirm={onConfirm} />)
    // Change "Tops & Bottoms" from Apparel to Accessories
    const dropdowns = screen.getAllByRole('combobox')
    fireEvent.change(dropdowns[0], { target: { value: 'Accessories' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryMapping: expect.objectContaining({
          'Tops & Bottoms': 'Accessories',
        }),
      })
    )
  })

  it('info banner shows needs attention count when there are unmapped categories', () => {
    const props = {
      ...defaultProps,
      suggestedMapping: {
        'Tops & Bottoms': '',
        'Hard Accessories': '',
        'Footwear': 'Footwear',
      } as CategoryMapping,
      mappingSources: {
        'Tops & Bottoms': 'none' as const,
        'Hard Accessories': 'none' as const,
        'Footwear': 'exact' as const,
      },
    }
    render(<CategoryMapper {...props} />)
    expect(screen.getByText(/needs your attention/i)).toBeInTheDocument()
  })
})
