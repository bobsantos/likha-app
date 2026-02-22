/**
 * Supabase client for browser-side operations.
 */

import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from './url-utils'

// Re-export so existing imports of getSupabaseUrl from '@/lib/supabase' keep working.
export { getSupabaseUrl } from './url-utils'

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Lazy — resolved on first use so window.location is available (not during SSR).
let _supabaseClient: ReturnType<typeof createClient> | null = null
export function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createClient(getSupabaseUrl(), supabaseAnonKey)
  }
  return _supabaseClient
}

// Default export for backwards compatibility — uses lazy client.
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    return (getSupabaseClient() as any)[prop]
  },
})
