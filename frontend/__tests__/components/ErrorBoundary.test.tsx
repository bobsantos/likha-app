/**
 * Tests for ErrorBoundary component
 */

import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'

// A component that throws an error on demand
function BrokenComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render error')
  }
  return <div>Normal content</div>
}

// Suppress console.error for expected error boundary output
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('shows fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Your data is safe/i)).toBeInTheDocument()
    expect(screen.getByText(/display issue only/i)).toBeInTheDocument()
  })

  it('does not expose the raw error stack trace to the user', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    // Stack trace should not appear in the DOM
    expect(screen.queryByText(/at BrokenComponent/i)).not.toBeInTheDocument()
  })

  it('renders "Try again" button that resets the boundary', () => {
    // We render a safe child — the error boundary has a "Try again" button
    // and clicking it resets hasError to false.
    // We verify the button exists and clicking it does not crash.
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    const tryAgainBtn = screen.getByRole('button', { name: /try again/i })
    expect(tryAgainBtn).toBeInTheDocument()

    // Click "Try again" — this resets the boundary to hasError: false.
    // Without any new error, the boundary should re-render its children
    // (BrokenComponent is still passed as children, but after reset it
    // will throw again since shouldThrow is still true — this is expected behavior).
    fireEvent.click(tryAgainBtn)

    // The boundary reset was called — the button click should not crash the test
    // The children will immediately throw again (same props), which is the expected
    // behavior of error boundaries: they reset and catch the next error.
    // The fallback UI should still be showing after re-throw.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders "Go to Dashboard" link pointing to /dashboard', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    const dashboardLink = screen.getByRole('link', { name: /go to dashboard/i })
    expect(dashboardLink).toBeInTheDocument()
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
  })

  it('logs the error to console', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(console.error).toHaveBeenCalled()
  })
})
