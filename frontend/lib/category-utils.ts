/**
 * Utility functions for category mismatch detection and resolution.
 * Used by the Step 2.5 category mapper in the sales upload wizard.
 */

/**
 * Extract distinct, non-empty category values from sample rows.
 * Preserves original casing and deduplicates exactly.
 */
export function getReportCategories(
  sampleRows: Record<string, string>[],
  categoryColumn: string
): string[] {
  const seen = new Set<string>()
  for (const row of sampleRows) {
    const value = row[categoryColumn]
    if (value !== undefined && value !== '') {
      seen.add(value)
    }
  }
  return Array.from(seen)
}

/**
 * Returns true if any report category does not appear exactly in the contract
 * categories list (case-sensitive comparison).
 */
export function hasCategoryMismatch(
  reportCategories: string[],
  contractCategories: string[]
): boolean {
  if (reportCategories.length === 0) return false
  const contractSet = new Set(contractCategories)
  return reportCategories.some((cat) => !contractSet.has(cat))
}
