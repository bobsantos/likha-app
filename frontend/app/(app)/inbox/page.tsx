/**
 * Inbox Page - List of inbound email reports
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { AlertCircle, RefreshCw, Mail, AlertTriangle, CheckCircle } from 'lucide-react'
import { getInboundReports, isUnauthorizedError } from '@/lib/api'
import type { InboundReport } from '@/types'

function StatusBadge({ status }: { status: InboundReport['status'] }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        Pending
      </span>
    )
  }
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        Confirmed
      </span>
    )
  }
  if (status === 'processed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        Processed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      Rejected
    </span>
  )
}

function MatchedContract({ report }: { report: InboundReport }) {
  if (report.contract_name) {
    return <span className="text-sm text-gray-900">{report.contract_name}</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600">
      <AlertTriangle className="w-3.5 h-3.5" />
      Unmatched
    </span>
  )
}

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, yyyy')
  } catch {
    return 'N/A'
  }
}

export default function InboxPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const confirmedReportId = searchParams.get('confirmed')
  const [reports, setReports] = useState<InboundReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReports = async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await getInboundReports()
      setReports(data)
      setLoading(false)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        router.push('/login')
        return
      }
      setError('Failed to load inbox. Please try again.')
      console.error('Error fetching inbound reports:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="animate-pulse">
          <div className="bg-gray-200 rounded-xl h-8 w-40 mb-6" />
          <div className="bg-gray-200 rounded-xl h-64" />
        </div>
        <p className="text-center text-gray-600 mt-8">Loading inbox...</p>
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
                onClick={fetchReports}
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
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-600 mt-1">
            Review inbound royalty reports from licensees
          </p>
        </div>
      </div>

      {confirmedReportId && (
        <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 flex-1">
            Report confirmed.{' '}
            <Link
              href={`/inbox/${confirmedReportId}`}
              className="font-medium underline underline-offset-2 hover:text-green-900"
            >
              Process now
            </Link>
          </p>
        </div>
      )}

      {reports.length === 0 ? (
        <div className="card text-center py-16">
          <Mail className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No reports received yet</h3>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            Forward licensee emails to your inbound address to get started.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Inbox">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">
                    Sender
                  </th>
                  <th
                    data-testid="inbox-col-subject"
                    className="hidden sm:table-cell text-left py-3 px-4 text-sm font-semibold text-gray-900"
                  >
                    Subject
                  </th>
                  <th
                    data-testid="inbox-col-received"
                    className="hidden sm:table-cell text-left py-3 px-4 text-sm font-semibold text-gray-900"
                  >
                    Received
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">
                    Matched Contract
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reports.map((report) => (
                  <tr
                    key={report.id}
                    aria-label={`${report.sender_email} ${report.subject ?? ''}`}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <Link
                        href={`/inbox/${report.id}`}
                        className="block text-sm font-medium text-gray-900 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded"
                      >
                        {report.sender_email}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell py-3 px-4">
                      <Link href={`/inbox/${report.id}`} className="block">
                        <span className="text-sm text-gray-700">
                          {report.subject ?? <span className="text-gray-400 italic">No subject</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell py-3 px-4">
                      <span className="text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(report.received_at)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <MatchedContract report={report} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={report.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
