/**
 * Tests for dynamic base-URL helpers: getApiUrl and getSupabaseUrl.
 *
 * Both helpers accept an optional `location` parameter (dependency injection)
 * that lets tests pass in a fake { hostname, port } without touching
 * window.location.
 *
 * Scenarios:
 *   - Desktop browser on localhost       → env var returned unchanged
 *   - Desktop browser on 127.0.0.1      → env var returned unchanged
 *   - Mobile / LAN IP, port 3001        → hostname and port swapped to backend
 *   - Mobile / LAN IP, port 3000        → hostname and port swapped to backend
 *   - Unknown frontend port             → only hostname is swapped
 *   - Production URL (no "localhost")   → env var returned unchanged
 *   - Env var not set                   → falls back to default
 */

import { getApiUrl, getSupabaseUrl } from '@/lib/url-utils'

// ---------------------------------------------------------------------------
// getApiUrl
// ---------------------------------------------------------------------------

describe('getApiUrl', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = originalEnv
  })

  it('returns configured URL unchanged when browser hostname is localhost', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8001'
    expect(getApiUrl({ hostname: 'localhost', port: '3001' })).toBe('http://localhost:8001')
  })

  it('returns configured URL unchanged when browser hostname is 127.0.0.1', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8001'
    expect(getApiUrl({ hostname: '127.0.0.1', port: '3001' })).toBe('http://localhost:8001')
  })

  it('replaces localhost hostname with LAN IP when browser is on a LAN IP', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8001'
    expect(getApiUrl({ hostname: '192.168.1.191', port: '3001' })).toBe('http://192.168.1.191:8001')
  })

  it('maps frontend port 3001 to backend port 8001', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8001'
    expect(getApiUrl({ hostname: '10.0.0.5', port: '3001' })).toBe('http://10.0.0.5:8001')
  })

  it('maps frontend port 3000 to backend port 8000', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000'
    expect(getApiUrl({ hostname: '10.0.0.5', port: '3000' })).toBe('http://10.0.0.5:8000')
  })

  it('keeps configured backend port when frontend port is not in the mapping table', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:9000'
    // Port 4000 is not in FRONTEND_TO_BACKEND_PORT, so the configured port (9000) is kept.
    expect(getApiUrl({ hostname: '192.168.1.191', port: '4000' })).toBe('http://192.168.1.191:9000')
  })

  it('returns production URL unchanged regardless of browser hostname', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com'
    expect(getApiUrl({ hostname: '192.168.1.191', port: '3001' })).toBe('https://api.example.com')
  })

  it('falls back to http://localhost:8000 when env var is not set', () => {
    delete process.env.NEXT_PUBLIC_API_URL
    expect(getApiUrl({ hostname: 'localhost', port: '3000' })).toBe('http://localhost:8000')
  })
})

// ---------------------------------------------------------------------------
// getSupabaseUrl
// ---------------------------------------------------------------------------

describe('getSupabaseUrl', () => {
  const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv
  })

  it('returns configured URL unchanged when browser hostname is localhost', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    expect(getSupabaseUrl({ hostname: 'localhost', port: '3001' })).toBe('http://localhost:54321')
  })

  it('returns configured URL unchanged when browser hostname is 127.0.0.1', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    expect(getSupabaseUrl({ hostname: '127.0.0.1', port: '3001' })).toBe('http://localhost:54321')
  })

  it('replaces localhost hostname with LAN IP, keeping Supabase port 54321', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    expect(getSupabaseUrl({ hostname: '192.168.1.191', port: '3001' })).toBe('http://192.168.1.191:54321')
  })

  it('keeps Supabase port 54321 regardless of the frontend port', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    expect(getSupabaseUrl({ hostname: '10.0.0.5', port: '3000' })).toBe('http://10.0.0.5:54321')
  })

  it('returns production URL unchanged regardless of browser hostname', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co'
    expect(getSupabaseUrl({ hostname: '192.168.1.191', port: '3001' })).toBe('https://abcdefgh.supabase.co')
  })
})
