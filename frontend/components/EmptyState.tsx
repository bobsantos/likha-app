/**
 * EmptyState component - Display when no data is available
 */

import Link from 'next/link'
import { FileText, Upload, Sparkles, BarChart3 } from 'lucide-react'

interface EmptyStateProps {
  title: string
  message: string
  ctaText?: string
  ctaLink?: string
}

export default function EmptyState({
  title,
  message,
  ctaText,
  ctaLink,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-100 to-primary-50 rounded-2xl mb-6">
        <FileText className="w-10 h-10 text-primary-600" />
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-8 max-w-md mx-auto">{message}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 max-w-3xl mx-auto">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-50 rounded-xl mb-3">
            <Upload className="w-6 h-6 text-primary-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">Upload PDF</p>
          <p className="text-xs text-gray-600">Upload your licensing contract</p>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-50 rounded-xl mb-3">
            <Sparkles className="w-6 h-6 text-primary-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">AI Extraction</p>
          <p className="text-xs text-gray-600">AI extracts key terms automatically</p>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-50 rounded-xl mb-3">
            <BarChart3 className="w-6 h-6 text-primary-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">Track Royalties</p>
          <p className="text-xs text-gray-600">Monitor earnings and compliance</p>
        </div>
      </div>

      {ctaText && ctaLink && (
        <Link
          href={ctaLink}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          {ctaText}
        </Link>
      )}
    </div>
  )
}
