/**
 * AuthError Component
 * Displays authentication error messages
 */

interface AuthErrorProps {
  error: string | null
}

export default function AuthError({ error }: AuthErrorProps) {
  if (!error) return null

  return (
    <div className="rounded-lg bg-red-50 p-4">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  )
}
