/**
 * Settings Page
 * Displays user account settings including the inbound email address for royalty report intake.
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Copy, Check, Mail } from 'lucide-react'
import { getInboundAddress, isUnauthorizedError } from '@/lib/api'

export default function SettingsPage() {
  const router = useRouter()
  const [inboundAddress, setInboundAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function fetchInboundAddress() {
      try {
        const data = await getInboundAddress()
        setInboundAddress(data.inbound_address)
        setLoading(false)
      } catch (err) {
        if (isUnauthorizedError(err)) {
          router.push('/login')
          return
        }
        setError('Failed to load settings. Please try again.')
        setLoading(false)
      }
    }

    fetchInboundAddress()
  }, [router])

  const handleCopy = async () => {
    if (!inboundAddress) return
    await navigator.clipboard.writeText(inboundAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="animate-pulse">
          <div className="bg-gray-200 rounded-xl h-8 w-32 mb-8"></div>
          <div className="bg-gray-200 rounded-xl h-40"></div>
        </div>
        <p className="text-center text-gray-600 mt-8">Loading settings...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="card bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-600 mt-1">Manage your account settings</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Mail className="h-5 w-5 text-primary-600 flex-shrink-0" />
          <h2 className="text-lg font-semibold text-gray-900">Inbound Email Address</h2>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Forward licensee royalty reports to this address. Attachments will be matched to your
          contracts automatically.
        </p>

        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <span className="flex-1 text-sm font-mono text-gray-800 break-all">
            {inboundAddress}
          </span>
          <button
            onClick={handleCopy}
            className="btn-secondary flex items-center gap-2 flex-shrink-0"
            aria-label={copied ? 'Copied!' : 'Copy email address'}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
