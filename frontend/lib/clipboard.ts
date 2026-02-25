/**
 * Clipboard utilities.
 *
 * `navigator.clipboard` is only available in secure contexts (HTTPS) and some
 * browsers restrict it further (e.g. cross-origin iframes).  This module
 * provides a robust `copyToClipboard` helper that tries the modern Clipboard
 * API first and falls back to the legacy `document.execCommand('copy')`
 * approach so copy buttons work in all environments including non-HTTPS
 * local development.
 */

/**
 * Copy `text` to the user's clipboard.
 *
 * Tries `navigator.clipboard.writeText()` first.  If that is unavailable or
 * throws (e.g. in a non-HTTPS context), falls back to creating a temporary
 * off-screen textarea and using `document.execCommand('copy')`.
 *
 * @returns `true` when the copy succeeded, `false` when both strategies fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Strategy 1: modern async Clipboard API (requires HTTPS or localhost).
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy strategy below.
    }
  }

  // Strategy 2: legacy execCommand fallback (synchronous, works in HTTP).
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      // Position off-screen so it is not visible.
      textarea.style.position = 'fixed'
      textarea.style.top = '-9999px'
      textarea.style.left = '-9999px'
      textarea.style.opacity = '0'
      textarea.setAttribute('aria-hidden', 'true')
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }

  return false
}
