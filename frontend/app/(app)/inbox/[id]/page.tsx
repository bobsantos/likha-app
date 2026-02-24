/**
 * Inbox Review Page - View and action a single inbound report
 */

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  ArrowLeft,
  AlertCircle,
  Mail,
  FileSpreadsheet,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import {
  getInboundReports,
  getContracts,
  confirmReport,
  rejectReport,
  isUnauthorizedError,
} from '@/lib/api'
import type { InboundReport, Contract } from '@/types'

function StatusBadge({ status }: { status: InboundReport['status'] }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
        Pending Review
      </span>
    )
  }
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
        <CheckCircle className="w-3.5 h-3.5" />
        Confirmed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
      <XCircle className="w-3.5 h-3.5" />
      Rejected
    </span>
  )
}

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, yyyy h:mm a')
  } catch {
    return 'N/A'
  }
}

export default function InboxReviewPage() {
  const params = useParams()
  const router = useRouter()
  const reportId = params.id as string

  const [report, setReport] = useState<InboundReport | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [reports, contractList] = await Promise.all([
        getInboundReports(),
        getContracts().catch(() => [] as Contract[]),
      ])

      const found = reports.find((r) => r.id === reportId)
      if (!found) {
        setError('Report not found.')
        setLoading(false)
        return
      }

      setReport(found)
      setContracts(contractList.filter((c) => c.status === 'active'))
      setLoading(false)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        router.push('/login')
        return
      }
      setError('Failed to load report. Please try again.')
      console.error('Error fetching report:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  const handleConfirm = async () => {
    if (!report || confirming) return
    setActionError(null)
    setConfirming(true)
    try {
      // Only pass contractId when the user explicitly selected one from the dropdown
      const contractId = selectedContractId || undefined
      await confirmReport(report.id, contractId)
      router.push('/inbox')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to confirm report.')
      setConfirming(false)
    }
  }

  const handleReject = async () => {
    if (!report || rejecting) return
    setActionError(null)
    setRejecting(true)
    try {
      await rejectReport(report.id)
      router.push('/inbox')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject report.')
      setRejecting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="skeleton h-6 w-32 mb-6" />
        <div className="skeleton h-64" />
        <p className="text-center text-gray-600 mt-6">Loading report...</p>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/inbox"
          aria-label="Back to Inbox"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Inbox
        </Link>
        <div className="card border border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">Error loading report</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Report not found'}</p>
              <button
                onClick={fetchData}
                className="mt-3 text-sm font-medium text-red-600 hover:text-red-700 underline inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isSettled = report.status !== 'pending'

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <Link
        href="/inbox"
        aria-label="Back to Inbox"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Inbox
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Report</h1>
          <p className="text-sm text-gray-600 mt-1">
            Confirm or reject this inbound royalty report
          </p>
        </div>
        <StatusBadge status={report.status} />
      </div>

      {/* Report Details Card */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Report Details</h2>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-600">Sender</p>
              <p className="font-medium text-gray-900">{report.sender_email}</p>
            </div>
          </div>

          {report.subject && (
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-600">Subject</p>
                <p className="font-medium text-gray-900">{report.subject}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-600">Received</p>
              <p className="font-medium text-gray-900">{formatDate(report.received_at)}</p>
            </div>
          </div>

          {report.attachment_filename && (
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-600">Attachment</p>
                <p className="font-medium text-gray-900">{report.attachment_filename}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract Matching Card */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Contract Match</h2>

        {report.contract_name ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm text-green-700 font-medium">Matched contract</p>
              <p className="text-green-900 font-semibold">{report.contract_name}</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700">
                No contract matched automatically. Select a contract below.
              </p>
            </div>
            <label htmlFor="contract-select" className="block text-sm font-medium text-gray-700 mb-1">
              Select Contract
            </label>
            <select
              id="contract-select"
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              disabled={isSettled}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">-- Select a contract --</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.licensee_name ?? contract.filename ?? 'Untitled'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleConfirm}
          disabled={isSettled || confirming || rejecting}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle className="w-4 h-4" />
          {confirming ? 'Confirming...' : 'Confirm & Process'}
        </button>

        <button
          onClick={handleReject}
          disabled={isSettled || confirming || rejecting}
          className="btn-secondary inline-flex items-center gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <XCircle className="w-4 h-4" />
          {rejecting ? 'Rejecting...' : 'Reject'}
        </button>
      </div>

      {isSettled && (
        <p className="mt-3 text-sm text-gray-500">
          This report has already been {report.status}. No further actions are available.
        </p>
      )}
    </div>
  )
}
