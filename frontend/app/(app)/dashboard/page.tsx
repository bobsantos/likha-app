/**
 * Dashboard Page
 * Displays all contracts and summary metrics
 */

'use client'

import { useEffect, useState } from 'react'
import { getContracts } from '@/lib/api'
import ContractCard from '@/components/ContractCard'
import DashboardSummary from '@/components/DashboardSummary'
import EmptyState from '@/components/EmptyState'
import type { Contract } from '@/types'

export default function DashboardPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchContracts() {
      try {
        setLoading(true)
        setError(null)
        const data = await getContracts()
        setContracts(data)
      } catch (err) {
        setError('Failed to load contracts. Please try again.')
        console.error('Error fetching contracts:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchContracts()
  }, [])

  // Calculate YTD royalties (placeholder - will be replaced with actual data)
  const ytdRoyalties = 0 // TODO: Fetch from sales periods in future

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-200 rounded-lg h-32"></div>
            <div className="bg-gray-200 rounded-lg h-32"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-gray-200 rounded-lg h-48"></div>
            <div className="bg-gray-200 rounded-lg h-48"></div>
            <div className="bg-gray-200 rounded-lg h-48"></div>
          </div>
        </div>
        <p className="text-center text-gray-600 mt-8">Loading contracts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <a
          href="/contracts/upload"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Upload Contract
        </a>
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
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {contracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
