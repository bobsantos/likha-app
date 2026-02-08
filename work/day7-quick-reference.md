# Day 7 Frontend - Quick Reference Card

## Commands

```bash
# Development
npm run dev              # Start dev server (http://localhost:3000)

# Testing
npm test                 # Run all tests
npm test -- --watch      # Watch mode
npm test -- Nav.test     # Run specific test
npm test -- --coverage   # With coverage

# Code Quality
npm run lint             # Run ESLint
npm run build            # Production build
```

## Routes

```
/                        → Redirects to /dashboard or /login
/login                   → Login page (auth route)
/signup                  → Signup page (auth route)
/dashboard               → Dashboard page (protected)
/contracts               → Contracts list (TODO: Day 8)
/contracts/upload        → Upload contract (TODO: Day 8)
/contracts/[id]          → Contract detail (TODO: Day 9)
```

## Components Built Today

### Nav
```tsx
import Nav from '@/components/Nav'

<Nav userEmail="user@example.com" />
```

### ContractCard
```tsx
import ContractCard from '@/components/ContractCard'

<ContractCard contract={contract} />
```

### DashboardSummary
```tsx
import DashboardSummary from '@/components/DashboardSummary'

<DashboardSummary
  totalContracts={5}
  ytdRoyalties={12500}
/>
```

### EmptyState
```tsx
import EmptyState from '@/components/EmptyState'

<EmptyState
  title="No contracts yet"
  message="Upload your first contract to get started"
  ctaText="Upload Contract"
  ctaLink="/contracts/upload"
/>
```

## Layout Structure

```tsx
// Protected routes use (app) layout
app/(app)/layout.tsx
  └── Checks auth
      ├── Not authenticated → redirect to /login
      └── Authenticated:
          ├── <Nav userEmail={user.email} />
          └── {children}
```

## API Integration

```typescript
import { getContracts } from '@/lib/api'

// All API calls automatically include JWT token
const contracts = await getContracts()
```

## Testing Pattern

```typescript
// 1. Import dependencies
import { render, screen } from '@testing-library/react'
import Component from '@/components/Component'

// 2. Mock dependencies
jest.mock('@/lib/api')

// 3. Write tests
describe('Component', () => {
  it('renders correctly', () => {
    render(<Component />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

## Responsive Breakpoints

```css
Mobile:  < 768px   (sm:)
Tablet:  768-1024  (md:)
Desktop: > 1024    (lg:)
```

## Color Palette

```css
Primary:   #2563eb (blue-600)
Success:   #059669 (green-600)
Error:     #dc2626 (red-600)
Gray:      #6b7280 (gray-500)
Background: #f9fafb (gray-50)
```

## Key Files

```
Components:     frontend/components/
App Routes:     frontend/app/(app)/
Tests:          frontend/__tests__/
Types:          frontend/types/index.ts
API Client:     frontend/lib/api.ts
Auth Helpers:   frontend/lib/auth.ts
```

## Test Coverage

```
✅ 50 tests passing
✅ 7 test suites
✅ >90% coverage on new components
✅ Zero linting errors
```

## Next Day (Day 8)

```
Frontend:
- Contract upload with drag-and-drop
- File validation
- Extraction review form

Backend:
- Enhanced CORS
- Response model improvements
```

## Common Issues & Solutions

### Tests failing?
```bash
npm test -- --clearCache
npm install
```

### Linting errors?
```bash
npm run lint -- --fix
```

### Type errors?
```bash
npm run build
# Check output for specific errors
```

### Auth not working?
- Check `.env.local` has Supabase credentials
- Verify backend is running on port 8000
- Check browser console for errors

## Quick Stats

```
Files Created:    13
Lines of Code:    ~1,200
Tests Written:    30 (50 total)
Coverage:         >90%
Time:             ~4 hours
Methodology:      TDD (Red-Green-Refactor)
```

## TDD Workflow Used

```
1. RED:    Write failing test
2. GREEN:  Write minimal code to pass
3. REFACTOR: Improve code quality
4. REPEAT: For each feature
```

## Git Workflow

```bash
# Check current changes
git status

# Stage files
git add frontend/components/Nav.tsx
git add frontend/__tests__/components/Nav.test.tsx

# Commit
git commit -m "Add Day 7: Dashboard with navigation and contract cards"

# Push
git push origin frontend-core
```

## Documentation

```
day7-summary.md          - Task completion summary
day7-component-tree.md   - Component architecture
day7-ui-mockup.md        - Visual design mockups
day7-final-report.md     - Comprehensive report
day7-file-paths.txt      - All file paths
day7-quick-reference.md  - This file
```

---

**Status:** ✅ Complete | **Quality:** Production-Ready | **Tests:** 50/50 Passing
