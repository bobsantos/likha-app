/**
 * Homepage
 * Redirects authenticated users to dashboard, unauthenticated to login
 */

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    async function checkAuth() {
      const { user } = await getCurrentUser()

      if (user) {
        router.push('/dashboard')
      } else {
        router.push('/login')
      }
    }

    checkAuth()
  }, [router])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Likha</h1>
        <p className="text-xl text-gray-600">
          Loading...
        </p>
      </div>
    </main>
  )
}
