/**
 * Dashboard Page
 * Displays all contracts and summary metrics
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, AlertCircle, RefreshCw } from 'lucide-react'
import { getContracts, getDashboardSummary, isUnauthorizedError } from '@/lib/api'
import ContractCard from '@/components/ContractCard'
import DashboardSummary from '@/components/DashboardSummary'
import EmptyState from '@/components/EmptyState'
import type { Contract } from '@/types'

export default function DashboardPage() {
  const router = useRouter()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ytdRoyalties, setYtdRoyalties] = useState(0)
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())

  const fetchContracts = async () => {
    setLoading(true)
    setError(null)

    try {
      const [data, summary] = await Promise.all([
        getContracts(),
        getDashboardSummary().catch(() => ({
          ytd_royalties: 0,
          current_year: new Date().getFullYear(),
        })),
      ])

      setContracts(data)
      setYtdRoyalties(summary.ytd_royalties)
      setCurrentYear(summary.current_year)
      setLoading(false)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        router.push('/login')
        // Keep loading=true so no error panel flashes before navigation
        return
      }
      setError('Failed to load contracts. Please try again.')
      console.error('Error fetching contracts:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContracts()
  }, [])

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-200 rounded-xl h-32"></div>
            <div className="bg-gray-200 rounded-xl h-32"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-gray-200 rounded-xl h-48"></div>
            <div className="bg-gray-200 rounded-xl h-48"></div>
            <div className="bg-gray-200 rounded-xl h-48"></div>
          </div>
        </div>
        <p className="text-center text-gray-600 mt-8">Loading contracts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="card bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-600">{error}</p>
              <button
                onClick={fetchContracts}
                className="mt-3 btn-secondary inline-flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">Manage your licensing contracts and track royalties</p>
        </div>
        <Link
          href="/contracts/upload"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          Upload Contract
        </Link>
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          message="Upload your first contract to start tracking royalties"
          ctaText="Upload Contract"
          ctaLink="/contracts/upload"
        />
      ) : (
        <>
          <DashboardSummary
            totalContracts={contracts.length}
            ytdRoyalties={ytdRoyalties}
            currentYear={currentYear}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {contracts.map((contract, index) => (
              <div
                key={contract.id}
                className="animate-fade-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <ContractCard contract={contract} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
