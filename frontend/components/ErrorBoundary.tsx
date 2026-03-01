/**
 * ErrorBoundary — React class component that catches render errors.
 *
 * Shows a friendly, non-alarming fallback UI (amber, not red) with:
 * - "Try again" button to reset the boundary
 * - "Go to Dashboard" link as an escape hatch
 *
 * Errors are logged to console but never exposed as raw stack traces.
 */

'use client'

import React from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console — never expose stack traces to the user
    console.error('[ErrorBoundary] Caught an error:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-amber-500" aria-hidden="true" />
              </div>
            </div>

            <h1 className="text-xl font-semibold text-gray-900 mb-3">
              Something went wrong
            </h1>

            <p className="text-gray-600 mb-8 leading-relaxed">
              An unexpected error occurred. Your data is safe — this is a display issue
              only. Try refreshing the page or going back to the dashboard.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Try again
              </button>

              <Link
                href="/dashboard"
                className="btn-secondary inline-flex items-center justify-center gap-2"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
