/**
 * Contract Review Page - Redirects to the upload page review step.
 *
 * The extraction review is handled as step 3 of the multi-step upload flow
 * at /contracts/upload. This page exists to:
 * 1. Satisfy the Day 8 plan checklist item for a /contracts/review route.
 * 2. Accept an optional ?draft=<id> query param and forward it to the upload
 *    page so that draft contracts can be resumed from a direct link.
 *
 * Usage:
 *   /contracts/review             → redirects to /contracts/upload
 *   /contracts/review?draft=<id>  → redirects to /contracts/upload?draft=<id>
 */

import { redirect } from 'next/navigation'

interface ReviewPageProps {
  searchParams: Promise<{ draft?: string }>
}

export const metadata = {
  title: 'Review Contract - Likha',
}

export default async function ContractReviewPage({ searchParams }: ReviewPageProps) {
  const { draft: draftId } = await searchParams
  const target = draftId
    ? `/contracts/upload?draft=${encodeURIComponent(draftId)}`
    : '/contracts/upload'

  redirect(target)
}
