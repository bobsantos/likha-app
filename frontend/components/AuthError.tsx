/**
 * AuthError Component
 * Displays authentication error messages
 */

import { AlertCircle } from 'lucide-react'

interface AuthErrorProps {
  error: string | null
}

export default function AuthError({ error }: AuthErrorProps) {
  if (!error) return null

  return (
    <div className="rounded-lg bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    </div>
  )
}
