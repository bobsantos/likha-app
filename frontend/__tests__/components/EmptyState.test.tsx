/**
 * Tests for EmptyState component
 */

import { render, screen } from '@testing-library/react'
import EmptyState from '@/components/EmptyState'

describe('EmptyState Component', () => {
  it('renders title and message', () => {
    render(
      <EmptyState
        title="No contracts yet"
        message="Upload your first contract to get started"
      />
    )

    expect(screen.getByText('No contracts yet')).toBeInTheDocument()
    expect(screen.getByText('Upload your first contract to get started')).toBeInTheDocument()
  })

  it('renders CTA button when provided', () => {
    render(
      <EmptyState
        title="No contracts yet"
        message="Upload your first contract to get started"
        ctaText="Upload Contract"
        ctaLink="/contracts/upload"
      />
    )

    const button = screen.getByText('Upload Contract')
    expect(button).toBeInTheDocument()
    expect(button.closest('a')).toHaveAttribute('href', '/contracts/upload')
  })

  it('renders without CTA button', () => {
    render(
      <EmptyState
        title="No contracts yet"
        message="Upload your first contract to get started"
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
