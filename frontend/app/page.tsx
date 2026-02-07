export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Likha</h1>
        <p className="text-xl text-gray-600 mb-8">
          AI-powered royalty tracking for licensing agreements
        </p>
        <div className="space-x-4">
          <a
            href="/dashboard"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Dashboard
          </a>
          <a
            href="/contracts/upload"
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Upload Contract
          </a>
        </div>
      </div>
    </main>
  )
}
