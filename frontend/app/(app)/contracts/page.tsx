/**
 * Contracts List Page - Display all contracts
 */

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Upload, Loader2, AlertCircle } from 'lucide-react'
import { getContracts } from '@/lib/api'
import type { Contract } from '@/types'
import ContractCard from '@/components/ContractCard'
import EmptyState from '@/components/EmptyState'

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContracts = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getContracts({ include_drafts: true })
      setContracts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContracts()
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="mt-2 text-gray-600">Manage your licensing contracts</p>
          </div>
          <Link href="/contracts/upload" className="btn-primary flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Contract
          </Link>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-64" />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="card border border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">Error loading contracts</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
              <button
                onClick={fetchContracts}
                className="mt-3 text-sm font-medium text-red-600 hover:text-red-700 underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && contracts.length === 0 && (
        <EmptyState
          title="No contracts yet"
          message="Upload your first licensing contract to get started with royalty tracking."
          ctaText="Upload Contract"
          ctaLink="/contracts/upload"
        />
      )}

      {/* Draft / Needs Review Section */}
      {!loading && !error && contracts.some((c) => c.status === 'draft') && (
        <div className="mb-10 animate-fade-in">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="badge-warning">Needs Review</span>
            <span>Drafts waiting for your review</span>
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {contracts
              .filter((c) => c.status === 'draft')
              .map((contract) => (
                <div key={contract.id} className="animate-fade-in">
                  <ContractCard contract={contract} />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Active Contracts Grid */}
      {!loading && !error && contracts.some((c) => c.status === 'active') && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 animate-fade-in">
          {contracts
            .filter((c) => c.status === 'active')
            .map((contract) => (
              <div key={contract.id} className="animate-fade-in">
                <ContractCard contract={contract} />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
