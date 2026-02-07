import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Likha - Royalty Tracking',
  description: 'AI-powered licensing contract extraction and royalty tracking',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
