/**
 * Supabase client for browser-side operations.
 */

import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from './url-utils'

// Re-export so existing imports of getSupabaseUrl from '@/lib/supabase' keep working.
export { getSupabaseUrl } from './url-utils'

const supabaseUrl = getSupabaseUrl()
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
