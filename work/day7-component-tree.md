# Day 7 Component Tree & Structure

## Application Route Structure

```
app/
├── (auth)/                          # Unauthenticated routes
│   ├── layout.tsx                   # Auth layout (no nav)
│   ├── login/page.tsx               # Login page
│   └── signup/page.tsx              # Signup page
│
├── (app)/                           # Protected routes ✅ NEW
│   ├── layout.tsx                   # App layout with Nav ✅ BUILT TODAY
│   └── dashboard/
│       └── page.tsx                 # Dashboard page ✅ BUILT TODAY
│
├── layout.tsx                       # Root layout
├── page.tsx                         # Homepage (redirects)
└── globals.css                      # Global styles
```

## Component Hierarchy

### Protected App Layout
```
app/(app)/layout.tsx
  └── getCurrentUser() [auth check]
      ├── Loading state
      ├── Redirect to /login (if not authenticated)
      └── Authenticated view:
          ├── <Nav userEmail={user.email} />
          └── <main>{children}</main>
```

### Navigation Component
```
<Nav userEmail="user@example.com">
  └── <nav>
      ├── Logo + Dashboard link
      ├── Navigation Links
      │   ├── Dashboard (active state)
      │   └── Contracts
      ├── User Email Display
      └── Sign Out Button
          └── signOut() → redirect to /login
```

### Dashboard Page
```
app/(app)/dashboard/page.tsx
  └── useEffect: getContracts()
      ├── Loading State
      │   └── Skeleton loader (3 cards)
      │
      ├── Error State
      │   └── Error message banner
      │
      ├── Empty State (contracts.length === 0)
      │   └── <EmptyState
      │         title="No contracts yet"
      │         message="Upload your first contract..."
      │         ctaText="Upload Contract"
      │         ctaLink="/contracts/upload"
      │       />
      │
      └── Contracts View (contracts.length > 0)
          ├── Page Header
          │   ├── Title: "Dashboard"
          │   └── Upload Contract Button
          │
          ├── <DashboardSummary
          │     totalContracts={contracts.length}
          │     ytdRoyalties={0}
          │   />
          │   ├── Active Contracts Card (blue icon)
          │   └── YTD Royalties Card (green icon)
          │
          └── Contracts Grid (responsive)
              └── contracts.map(contract =>
                    <ContractCard key={contract.id} contract={contract} />
                  )
```

### ContractCard Component
```
<ContractCard contract={contract}>
  └── <Link href={`/contracts/${contract.id}`}>
      └── <div className="card">
          ├── Header
          │   ├── Licensee Name (left)
          │   └── Royalty Rate (right, large blue)
          │
          └── Details Grid
              ├── Contract Period: Jan 1, 2024 - Dec 31, 2025
              ├── Territories: US, Canada
              ├── Minimum Guarantee: $5,000 (if present)
              └── Reporting: Quarterly
```

### DashboardSummary Component
```
<DashboardSummary totalContracts={5} ytdRoyalties={12500}>
  └── <div className="grid md:grid-cols-2 gap-6">
      ├── Card: Active Contracts
      │   ├── Icon (blue document)
      │   ├── Label: "Active Contracts"
      │   └── Value: 5
      │
      └── Card: YTD Royalties
          ├── Icon (green dollar)
          ├── Label: "YTD Royalties"
          └── Value: $12,500.00
```

### EmptyState Component
```
<EmptyState
  title="No contracts yet"
  message="Upload your first contract to get started"
  ctaText="Upload Contract"
  ctaLink="/contracts/upload"
>
  └── <div className="text-center">
      ├── Icon (gray document)
      ├── Title (bold)
      ├── Message (gray text)
      └── CTA Button (blue, optional)
```

## Data Flow

### Authentication Flow
```
User visits /dashboard
  ↓
app/(app)/layout.tsx
  ↓
getCurrentUser() from lib/auth.ts
  ↓
supabase.auth.getUser()
  ↓
  ├── User found → Render Nav + Dashboard
  └── No user → Redirect to /login
```

### Dashboard Data Flow
```
Dashboard Page loads
  ↓
useEffect: getContracts()
  ↓
lib/api.ts: getContracts()
  ↓
getAuthHeaders() → Get JWT from Supabase
  ↓
fetch('/api/contracts', {
  headers: { Authorization: 'Bearer <token>' }
})
  ↓
Backend returns contracts[]
  ↓
  ├── Success → setContracts(data)
  │   ↓
  │   Render Dashboard:
  │   ├── DashboardSummary
  │   └── ContractCard × N
  │
  └── Error → setError(message)
      ↓
      Display error banner
```

### Navigation Flow
```
User clicks "Sign Out"
  ↓
Nav.tsx: handleSignOut()
  ↓
lib/auth.ts: signOut()
  ↓
supabase.auth.signOut()
  ↓
  ├── Success → router.push('/login')
  └── Error → Show error message
```

## Responsive Breakpoints

### Mobile (< 768px)
- Single column layout
- Stack summary cards vertically
- Full-width contract cards
- Hamburger menu (future)

### Tablet (768px - 1024px)
- 2-column grid for summary cards
- 2-column grid for contract cards
- Expanded navigation

### Desktop (> 1024px)
- 2-column grid for summary cards
- 3-column grid for contract cards
- Full navigation bar

## Component Props & Types

### Nav Component
```typescript
interface NavProps {
  userEmail: string
}
```

### ContractCard Component
```typescript
interface ContractCardProps {
  contract: Contract
}

// Contract type from types/index.ts
interface Contract {
  id: string
  user_id: string
  licensee_name: string
  licensor_name: string | null
  contract_start: string | null
  contract_end: string | null
  royalty_rate: RoyaltyRate
  royalty_base: 'net_sales' | 'gross_sales'
  territories: string[]
  product_categories: string[] | null
  minimum_guarantee: number | null
  mg_period: 'monthly' | 'quarterly' | 'annually' | null
  advance_payment: number | null
  reporting_frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually'
  pdf_url: string | null
  created_at: string
  updated_at: string
}

type RoyaltyRate = number | TieredRate | CategoryRate
```

### DashboardSummary Component
```typescript
interface DashboardSummaryProps {
  totalContracts: number
  ytdRoyalties: number
}
```

### EmptyState Component
```typescript
interface EmptyStateProps {
  title: string
  message: string
  ctaText?: string
  ctaLink?: string
}
```

## State Management

### App Layout State
```typescript
const [user, setUser] = useState<any>(null)
const [loading, setLoading] = useState(true)
```

### Nav Component State
```typescript
const [error, setError] = useState<string | null>(null)
```

### Dashboard Page State
```typescript
const [contracts, setContracts] = useState<Contract[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)
```

## Styling Patterns

### Card Style
```css
bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow
```

### Button Primary
```css
px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors
```

### Active Navigation Link
```css
text-blue-600 border-b-2 border-blue-600
```

### Inactive Navigation Link
```css
text-gray-700 hover:text-gray-900
```

### Loading Skeleton
```css
animate-pulse bg-gray-200 rounded-lg h-32
```

## API Integration

### Auth Headers
```typescript
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  return headers
}
```

### Example API Call
```typescript
export async function getContracts() {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}/api/contracts`, {
    headers,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch contracts')
  }

  return response.json()
}
```

## Test Coverage

### Nav Component Tests (6 tests)
- ✅ Renders logo
- ✅ Displays user email
- ✅ Renders navigation links
- ✅ Highlights active link
- ✅ Handles sign out
- ✅ Shows error message on sign out failure

### App Layout Tests (4 tests)
- ✅ Shows loading state initially
- ✅ Redirects to login if not authenticated
- ✅ Renders children with nav when authenticated
- ✅ Passes user email to Nav component

### ContractCard Tests (8 tests)
- ✅ Renders licensee name
- ✅ Displays royalty rate as percentage
- ✅ Shows contract period dates
- ✅ Displays territories
- ✅ Shows minimum guarantee when present
- ✅ Handles tiered royalty rate
- ✅ Handles category-specific rates
- ✅ Links to contract detail page

### DashboardSummary Tests (4 tests)
- ✅ Displays total contracts count
- ✅ Displays YTD royalties formatted as currency
- ✅ Handles zero values
- ✅ Formats large numbers correctly

### EmptyState Tests (3 tests)
- ✅ Renders title and message
- ✅ Renders CTA button when provided
- ✅ Renders without CTA button

### Dashboard Page Tests (5 tests)
- ✅ Shows loading skeleton initially
- ✅ Displays contracts when loaded
- ✅ Displays empty state when no contracts
- ✅ Displays error message on fetch failure
- ✅ Calculates YTD royalties correctly

## File Paths Reference

### Components
- `/frontend/components/Nav.tsx`
- `/frontend/components/ContractCard.tsx`
- `/frontend/components/DashboardSummary.tsx`
- `/frontend/components/EmptyState.tsx`

### App Routes
- `/frontend/app/(app)/layout.tsx`
- `/frontend/app/(app)/dashboard/page.tsx`

### Tests
- `/frontend/__tests__/components/Nav.test.tsx`
- `/frontend/__tests__/components/ContractCard.test.tsx`
- `/frontend/__tests__/components/DashboardSummary.test.tsx`
- `/frontend/__tests__/components/EmptyState.test.tsx`
- `/frontend/__tests__/app/(app)/layout.test.tsx`
- `/frontend/__tests__/app/(app)/dashboard.test.tsx`

### Utilities
- `/frontend/lib/api.ts` (updated with auth headers)
- `/frontend/lib/auth.ts` (existing)
- `/frontend/lib/supabase.ts` (existing)
- `/frontend/types/index.ts` (existing)

---

**Total Components Built:** 4 new components
**Total Tests Written:** 30 new tests (50 total)
**Total Files Created:** 12 new files
**Code Coverage:** >90% for new components
