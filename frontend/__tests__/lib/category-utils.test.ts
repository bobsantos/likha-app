/**
 * Tests for category-utils.ts
 * TDD: written before the implementation
 */

import { getReportCategories, hasCategoryMismatch } from '@/lib/category-utils'

describe('getReportCategories', () => {
  it('returns distinct category values from sample rows', () => {
    const sampleRows = [
      { Category: 'Apparel', Sales: '1000' },
      { Category: 'Footwear', Sales: '2000' },
      { Category: 'Apparel', Sales: '500' },
      { Category: 'Accessories', Sales: '300' },
    ]
    const result = getReportCategories(sampleRows, 'Category')
    expect(result).toHaveLength(3)
    expect(result).toContain('Apparel')
    expect(result).toContain('Footwear')
    expect(result).toContain('Accessories')
  })

  it('returns empty array when no rows provided', () => {
    const result = getReportCategories([], 'Category')
    expect(result).toEqual([])
  })

  it('returns empty array when category column does not exist in rows', () => {
    const sampleRows = [
      { Sales: '1000', Territory: 'US' },
      { Sales: '2000', Territory: 'CA' },
    ]
    const result = getReportCategories(sampleRows, 'NonExistentColumn')
    expect(result).toEqual([])
  })

  it('skips empty string values', () => {
    const sampleRows = [
      { Category: 'Apparel', Sales: '1000' },
      { Category: '', Sales: '500' },
      { Category: 'Footwear', Sales: '2000' },
    ]
    const result = getReportCategories(sampleRows, 'Category')
    expect(result).toHaveLength(2)
    expect(result).not.toContain('')
  })

  it('handles rows where the category column is missing (undefined)', () => {
    const sampleRows = [
      { Category: 'Apparel', Sales: '1000' },
      { Sales: '500' }, // no Category key
      { Category: 'Footwear', Sales: '2000' },
    ]
    const result = getReportCategories(sampleRows, 'Category')
    expect(result).toHaveLength(2)
    expect(result).toContain('Apparel')
    expect(result).toContain('Footwear')
  })

  it('preserves original casing of category values', () => {
    const sampleRows = [
      { Category: 'Tops & Bottoms', Sales: '1000' },
      { Category: 'Hard Accessories', Sales: '2000' },
    ]
    const result = getReportCategories(sampleRows, 'Category')
    expect(result).toContain('Tops & Bottoms')
    expect(result).toContain('Hard Accessories')
  })

  it('deduplicates case-sensitively (preserves distinct casing)', () => {
    const sampleRows = [
      { Category: 'Apparel', Sales: '1000' },
      { Category: 'apparel', Sales: '500' },
    ]
    // Both appear since they differ in casing
    const result = getReportCategories(sampleRows, 'Category')
    expect(result).toHaveLength(2)
  })
})

describe('hasCategoryMismatch', () => {
  it('returns false when all report categories exactly match contract categories', () => {
    const reportCategories = ['Apparel', 'Footwear', 'Accessories']
    const contractCategories = ['Apparel', 'Footwear', 'Accessories']
    expect(hasCategoryMismatch(reportCategories, contractCategories)).toBe(false)
  })

  it('returns true when one report category does not match any contract category', () => {
    const reportCategories = ['Tops & Bottoms', 'Footwear', 'Accessories']
    const contractCategories = ['Apparel', 'Footwear', 'Accessories']
    expect(hasCategoryMismatch(reportCategories, contractCategories)).toBe(true)
  })

  it('returns true when all report categories differ from contract categories', () => {
    const reportCategories = ['Tops & Bottoms', 'Hard Accessories']
    const contractCategories = ['Apparel', 'Accessories']
    expect(hasCategoryMismatch(reportCategories, contractCategories)).toBe(true)
  })

  it('returns false when report categories is empty', () => {
    const result = hasCategoryMismatch([], ['Apparel', 'Footwear'])
    expect(result).toBe(false)
  })

  it('returns true when contract categories is empty and report categories is not', () => {
    const result = hasCategoryMismatch(['Apparel'], [])
    expect(result).toBe(true)
  })

  it('is case-sensitive in matching', () => {
    // 'apparel' vs 'Apparel' — no match
    const reportCategories = ['apparel']
    const contractCategories = ['Apparel']
    expect(hasCategoryMismatch(reportCategories, contractCategories)).toBe(true)
  })

  it('returns false for a subset match (all report categories found in contract)', () => {
    const reportCategories = ['Apparel', 'Footwear']
    const contractCategories = ['Apparel', 'Footwear', 'Accessories']
    expect(hasCategoryMismatch(reportCategories, contractCategories)).toBe(false)
  })
})
