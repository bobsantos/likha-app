/**
 * Utilities for resolving service base URLs at runtime.
 *
 * When the Next.js app is opened from a mobile device on the LAN the browser
 * JS receives NEXT_PUBLIC_* env vars that were baked in at build time with
 * "localhost" as the host.  "localhost" in the phone's browser refers to the
 * phone itself, not the Mac running Docker, so all API / Supabase calls fail.
 *
 * These helpers detect that situation and swap "localhost" with the actual
 * hostname the browser used to load the page so that cross-device access works
 * without any docker-compose.yml changes.
 */

/**
 * Port mapping: frontend port → backend port.
 * Only used when rewriting a localhost API URL for LAN access.
 */
export const FRONTEND_TO_BACKEND_PORT: Record<string, string> = {
  '3001': '8001',
  '3000': '8000',
}

export interface BrowserLocation {
  hostname: string
  port: string
}

/**
 * Return the browser's current hostname and port.
 * Falls back to { hostname: 'localhost', port: '' } when called server-side.
 */
export function getBrowserLocation(): BrowserLocation {
  if (typeof window === 'undefined') {
    return { hostname: 'localhost', port: '' }
  }
  return {
    hostname: window.location.hostname,
    port: window.location.port,
  }
}

/**
 * Return the API base URL.
 *
 * In development (when NEXT_PUBLIC_API_URL contains "localhost") and the code
 * is executing inside a browser on a remote device, replace "localhost" with
 * the browser's actual hostname and remap the port to the backend port.
 *
 * In production, or when the URL does not contain "localhost", the env var is
 * returned unchanged.
 *
 * @param location - override for testing; defaults to getBrowserLocation()
 */
export function getApiUrl(location?: BrowserLocation): string {
  const configured = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  if (typeof window === 'undefined' && !location) {
    // Server-side rendering: localhost is fine (same machine as the backend).
    return configured
  }

  if (!configured.includes('localhost')) {
    // Production or an already-resolved URL — use as-is.
    return configured
  }

  const { hostname: browserHostname, port: browserPort } =
    location ?? getBrowserLocation()

  if (browserHostname === 'localhost' || browserHostname === '127.0.0.1') {
    // Desktop browser: localhost resolves correctly, no substitution needed.
    return configured
  }

  // Mobile / remote browser: swap "localhost" for the LAN hostname and remap
  // the port so the backend port is used instead of the frontend port.
  try {
    const url = new URL(configured)
    url.hostname = browserHostname
    const mappedPort = FRONTEND_TO_BACKEND_PORT[browserPort]
    if (mappedPort) {
      url.port = mappedPort
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return configured
  }
}

/**
 * Return the Supabase base URL.
 *
 * Same logic as getApiUrl but Supabase always listens on its own fixed port
 * (54321) so no port remapping table is needed — only the hostname is swapped.
 *
 * @param location - override for testing; defaults to getBrowserLocation()
 */
export function getSupabaseUrl(location?: BrowserLocation): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (typeof window === 'undefined' && !location) {
    return configured
  }

  if (!configured.includes('localhost')) {
    return configured
  }

  const { hostname: browserHostname } = location ?? getBrowserLocation()

  if (browserHostname === 'localhost' || browserHostname === '127.0.0.1') {
    return configured
  }

  try {
    const url = new URL(configured)
    url.hostname = browserHostname
    return url.toString().replace(/\/$/, '')
  } catch {
    return configured
  }
}
