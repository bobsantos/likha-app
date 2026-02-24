# Total Royalties Feature — Implementation Plan

**Goal**: Replace N+1 client-side royalty aggregation with two backend summary endpoints. Dashboard gets a single cross-contract YTD figure; contract detail gets an all-time total with per-year breakdown.

---

## 1. Problems Being Solved

| Location | Current behavior | Problem |
|---|---|---|
| `dashboard/page.tsx` | `Promise.all(contracts.map(c => getSalesPeriods(c.id)))` then reduce in JS | N+1 API calls; business logic on client; slow on large contract lists |
| `contracts/[id]/page.tsx` | `salesPeriods.reduce(...Number(period.royalty_calculated)...)` | `royalty_calculated` comes from DB as a string; `Number("8000.00")` works but any non-numeric DB value produces `$NaN` silently |

---

## 2. Backend Changes

### 2.1 New endpoint: `GET /api/sales/dashboard-summary`

**File**: `backend/app/routers/sales.py`

**Purpose**: Return the authenticated user's YTD royalties for the current calendar year across all their active contracts, in a single DB round-trip.

**Signature**:
```python
@router.get("/dashboard-summary", response_model=DashboardSummary)
async def get_dashboard_summary(user_id: str = Depends(get_current_user)) -> DashboardSummary:
```

**Response model** (add to `backend/app/models/sales.py`):
```python
class DashboardSummary(BaseModel):
    ytd_royalties: Decimal
    current_year: int
```

**Query strategy**:

The supabase-py client does not expose SQL aggregate functions directly. Use `.rpc()` to call a Postgres function, or do a filtered `.select()` and sum in Python. The correct tradeoff:

- Option A — Python sum after filtered fetch: fetch only `royalty_calculated` for `period_start >= YYYY-01-01` for the user's active contracts. Two queries (contracts, then sales periods with `in` filter). Fast enough for sub-1s, no SQL function needed.
- Option B — Postgres RPC: requires a new migration for the function. Marginally faster but adds migration overhead.

**Recommended: Option A** (no migration required, keeps all logic in Python where it is already tested).

```python
async def get_dashboard_summary(user_id: str = Depends(get_current_user)) -> DashboardSummary:
    current_year = datetime.now(timezone.utc).year
    ytd_start = f"{current_year}-01-01"

    # 1. Fetch the user's active contract IDs (single query)
    contracts_result = (
        supabase.table("contracts")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "active")
        .execute()
    )
    contract_ids = [row["id"] for row in (contracts_result.data or [])]

    if not contract_ids:
        return DashboardSummary(ytd_royalties=Decimal("0"), current_year=current_year)

    # 2. Fetch royalty_calculated for periods starting in current year
    #    across all active contracts (single query using `in` filter)
    periods_result = (
        supabase.table("sales_periods")
        .select("royalty_calculated")
        .in_("contract_id", contract_ids)
        .gte("period_start", ytd_start)
        .execute()
    )
    rows = periods_result.data or []

    ytd_royalties = sum(
        Decimal(str(row["royalty_calculated"])) for row in rows
    )

    return DashboardSummary(ytd_royalties=ytd_royalties, current_year=current_year)
```

**Performance notes**:
- Two queries, both indexed (contracts by `user_id`+`status`, sales_periods by `contract_id`+`period_start`).
- The `in_()` filter keeps this a single round-trip to the DB, not N+1.
- See Section 4 (Migration) for the index recommendations.

---

### 2.2 New endpoint: `GET /api/sales/contract/{contract_id}/totals`

**File**: `backend/app/routers/sales.py`

**Purpose**: Return all-time total royalties for a single contract, plus a per-calendar-year breakdown. Eliminates the client-side `reduce` and the string-coercion risk.

**Signature**:
```python
@router.get("/contract/{contract_id}/totals", response_model=ContractTotals)
async def get_contract_totals(
    contract_id: str,
    user_id: str = Depends(get_current_user),
) -> ContractTotals:
```

**Response model** (add to `backend/app/models/sales.py`):
```python
class YearlyRoyalties(BaseModel):
    year: int
    royalties: Decimal

class ContractTotals(BaseModel):
    contract_id: str
    total_royalties: Decimal          # all-time sum
    by_year: List[YearlyRoyalties]    # sorted descending by year
```

**Query strategy**:

```python
async def get_contract_totals(
    contract_id: str,
    user_id: str = Depends(get_current_user),
) -> ContractTotals:
    await verify_contract_ownership(contract_id, user_id)

    result = (
        supabase.table("sales_periods")
        .select("royalty_calculated, period_start")
        .eq("contract_id", contract_id)
        .execute()
    )
    rows = result.data or []

    total = Decimal("0")
    by_year: dict[int, Decimal] = {}

    for row in rows:
        amount = Decimal(str(row["royalty_calculated"]))
        total += amount
        # period_start is "YYYY-MM-DD"; extract year without datetime parsing overhead
        year = int(row["period_start"][:4])
        by_year[year] = by_year.get(year, Decimal("0")) + amount

    sorted_years = [
        YearlyRoyalties(year=y, royalties=v)
        for y, v in sorted(by_year.items(), reverse=True)
    ]

    return ContractTotals(
        contract_id=contract_id,
        total_royalties=total,
        by_year=sorted_years,
    )
```

**Why not enhance the existing `GET /api/sales/contract/{contract_id}` list endpoint?**

The list endpoint returns full `SalesPeriod` records for the sales period table. Embedding aggregated totals there would violate the single-responsibility principle and require the client to conditionally parse a mixed response. A dedicated `/totals` endpoint is cleaner.

---

### 2.3 Type safety for `royalty_calculated`

`royalty_calculated` is stored as `NUMERIC` in Postgres but supabase-py returns it as a Python `str` (e.g. `"8000.00"`). Both new endpoints wrap every value in `Decimal(str(...))` before returning, so the Pydantic model serializes it as a proper JSON number. The existing `SalesPeriod` model already declares `royalty_calculated: Decimal` which handles this for period list responses. No schema change needed.

The frontend must treat both `number` and `string` as possible JS types for `royalty_calculated` on the `SalesPeriod` list (see Section 3.3).

---

### 2.4 Router registration

Both endpoints are added to the existing `sales` router in `backend/app/routers/sales.py`. No new router file needed. The `/dashboard-summary` route must appear **before** any `/{period_id}` or `/contract/{contract_id}` pattern to avoid FastAPI matching `dashboard-summary` as a path parameter. The existing route ordering already puts static paths before parameterized ones, so insert the new handler near the top with the other `GET` handlers.

---

## 3. Frontend Changes

### 3.1 New API client functions in `frontend/lib/api.ts`

```typescript
// --- Types (add to frontend/types/index.ts or inline) ---

export interface DashboardSummary {
  ytd_royalties: number
  current_year: number
}

export interface YearlyRoyalties {
  year: number
  royalties: number
}

export interface ContractTotals {
  contract_id: string
  total_royalties: number
  by_year: YearlyRoyalties[]
}

// --- API functions ---

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${getResolvedApiUrl()}/api/sales/dashboard-summary`, { headers })
  if (!response.ok) {
    // Graceful fallback: caller catches and defaults to 0
    throw new ApiError('Failed to fetch dashboard summary', response.status)
  }
  return response.json()
}

export async function getContractTotals(contractId: string): Promise<ContractTotals> {
  const headers = await getAuthHeaders()
  const response = await fetch(
    `${getResolvedApiUrl()}/api/sales/contract/${contractId}/totals`,
    { headers }
  )
  if (!response.ok) {
    throw new ApiError('Failed to fetch contract totals', response.status)
  }
  return response.json()
}
```

---

### 3.2 Dashboard page (`frontend/app/(app)/dashboard/page.tsx`)

**Remove**: `import { getSalesPeriods }` and the `Promise.all(data.map(...getSalesPeriods...))` block.

**Add**: A parallel `getDashboardSummary()` call alongside `getContracts()`.

```typescript
// Before (inside fetchContracts):
const data = await getContracts()
setContracts(data)

const allPeriods = await Promise.all(data.map((contract: Contract) => getSalesPeriods(contract.id)))
const ytd = allPeriods.flat().reduce((sum, period) => {
  const year = new Date(period.period_start).getFullYear()
  if (year !== currentYear) return sum
  return sum + Number(period.royalty_calculated)
}, 0)
setYtdRoyalties(ytd)

// After:
const [data, summary] = await Promise.all([
  getContracts(),
  getDashboardSummary().catch(() => ({ ytd_royalties: 0, current_year: new Date().getFullYear() })),
])
setContracts(data)
setYtdRoyalties(summary.ytd_royalties)
```

The `.catch()` inline provides graceful fallback: if the summary endpoint fails, the dashboard still renders with `$0.00` rather than crashing. The `getContracts()` call is unaffected so the contract list still loads.

**`DashboardSummary` component** (`frontend/components/DashboardSummary.tsx`): No changes needed. It already uses `ytdRoyalties: number` and handles the `ytdRoyalties === 0` case with the "No royalties recorded" sub-text.

---

### 3.3 Contract detail page (`frontend/app/(app)/contracts/[id]/page.tsx`)

**Add** `getContractTotals` to imports.

**Add state**:
```typescript
const [contractTotals, setContractTotals] = useState<ContractTotals | null>(null)
```

**Fetch in parallel** with the existing `getContract` and `getSalesPeriods` calls:
```typescript
const [contractData, salesData, totalsData] = await Promise.all([
  getContract(contractId),
  getSalesPeriods(contractId),
  getContractTotals(contractId).catch(() => null),  // graceful fallback
])
setContract(contractData)
setSalesPeriods(salesData)
setContractTotals(totalsData)
```

**Replace** the client-side reduce block:
```typescript
// Remove these:
const totalRoyalties = salesPeriods.reduce(
  (sum, period) => sum + Number(period.royalty_calculated),
  0,
)
const royaltiesByYear = Object.entries(
  salesPeriods.reduce<Record<number, number>>((acc, period) => { ... }, {}),
).map(...).sort(...)

// Replace with:
const totalRoyalties = contractTotals?.total_royalties ?? 0
const royaltiesByYear = contractTotals?.by_year ?? []
```

**Update the render** in the "Total Royalties" card:
```tsx
<div className="card animate-fade-in">
  <h3 className="text-sm font-medium text-gray-600 mb-1">Total Royalties</h3>
  <p className="text-3xl font-bold text-gray-900 tabular-nums">
    {formatCurrency(totalRoyalties)}
  </p>
  <div className="mt-2 space-y-0.5">
    {royaltiesByYear.map(({ year, royalties }) => (
      <p key={year} className="text-xs text-gray-500 tabular-nums">
        {year}: {formatCurrency(royalties)}
      </p>
    ))}
  </div>
</div>
```

Note: `royaltiesByYear` shape changes from `{ year: number; total: number }[]` to `{ year: number; royalties: number }[]` — update the destructuring accordingly.

The fallback when `contractTotals` is `null` (endpoint failed) results in `$0.00` total and no per-year rows, which is safe and non-crashing.

---

## 4. Database Migration

No schema changes are required. The two new endpoints use existing columns (`royalty_calculated`, `period_start`, `contract_id`, `user_id`, `status`) on the existing `contracts` and `sales_periods` tables.

**Recommended performance indexes** (add as a migration for production):

File: `supabase/migrations/20260224100000_add_royalty_summary_indexes.sql`

```sql
-- Index for dashboard-summary: filter sales_periods by contract_id and period_start year
-- contract_id is already indexed (FK), but a composite index speeds up the YTD filter
CREATE INDEX IF NOT EXISTS idx_sales_periods_contract_period_start
  ON sales_periods (contract_id, period_start);

-- Index for dashboard-summary: filter contracts by user_id and status
CREATE INDEX IF NOT EXISTS idx_contracts_user_status
  ON contracts (user_id, status);
```

These indexes make the `in_()` + `gte()` query on `sales_periods` and the `eq("user_id") + eq("status")` query on `contracts` use index scans instead of sequential scans. On small datasets (< 10k rows) this is optional, but it future-proofs the feature.

If you choose not to create a migration file immediately, document this as a known gap: tests will pass (they mock Supabase) but the real DB may do sequential scans without the indexes.

---

## 5. Testing

### 5.1 Backend: new test class in `backend/tests/test_day9.py` (or a new file)

Add `TestGetDashboardSummaryEndpoint` and `TestGetContractTotalsEndpoint`.

**Dashboard summary tests**:

```python
class TestGetDashboardSummaryEndpoint:

    def _setup_mocks(self, mock_supabase, contract_ids, periods):
        # contracts query: returns list of {id: ...} rows
        mock_contracts_query = MagicMock()
        mock_contracts_query.execute.return_value = Mock(data=[{"id": cid} for cid in contract_ids])
        mock_contracts_select = MagicMock()
        mock_contracts_select.eq.return_value = mock_contracts_select
        mock_contracts_select.execute.return_value = Mock(data=[{"id": cid} for cid in contract_ids])
        # ... (chain eq.eq.execute pattern)

        # periods query: returns list of {royalty_calculated, period_start} rows
        # ... (chain in_.gte.execute pattern)
        ...

    async def test_returns_zero_when_no_active_contracts(self): ...
    async def test_returns_zero_when_no_ytd_periods(self): ...
    async def test_sums_ytd_royalties_across_contracts(self): ...
    async def test_excludes_prior_year_periods(self): ...
    async def test_current_year_in_response_matches_today(self): ...
```

**Key edge cases**:
- No active contracts: returns `{ ytd_royalties: 0, current_year: <year> }`, does not crash on empty `in_()`.
- Periods with `period_start` in a prior year: excluded from the sum.
- `royalty_calculated` as string in mock data: `Decimal(str(...))` coercion verified.

**Contract totals tests**:

```python
class TestGetContractTotalsEndpoint:

    async def test_empty_periods_returns_zero_total(self): ...
    async def test_single_period_correct_total_and_year(self): ...
    async def test_multiple_periods_same_year_grouped(self): ...
    async def test_multiple_years_sorted_descending(self): ...
    async def test_royalty_calculated_string_coerced_to_decimal(self): ...
    async def test_ownership_check_called(self): ...
```

**Key edge case**: periods with `period_start = "2025-12-31"` and `period_start = "2026-01-01"` must end up in separate year buckets.

---

### 5.2 Frontend tests

The existing Jest test suite (no test files found outside `node_modules`) does not yet cover `dashboard/page.tsx` or `contracts/[id]/page.tsx`. When frontend tests are added:

- Mock `getDashboardSummary` to return a known `DashboardSummary` object; assert the YTD card renders the correct formatted currency.
- Mock `getContractTotals` to return a `ContractTotals` with `by_year`; assert the per-year rows render.
- Test the error path: when `getDashboardSummary` rejects, `ytdRoyalties` defaults to `0` and no crash occurs.
- Test the `$NaN` regression: if a `royalty_calculated` string is malformed and `getContractTotals` is the source of truth (which already applies `Decimal(str(...))` on the backend), the frontend never sees a raw DB string, so the bug cannot recur at the display layer.

---

## 6. Implementation Order

1. **Backend models** — add `DashboardSummary`, `YearlyRoyalties`, `ContractTotals` to `backend/app/models/sales.py`.
2. **Backend endpoints** — add `get_dashboard_summary` and `get_contract_totals` to `backend/app/routers/sales.py`. Ensure route ordering: static paths (`/dashboard-summary`) before parameterized paths (`/{period_id}`).
3. **Backend tests** — write and run `pytest backend/tests/ -x -q` to confirm green.
4. **API client** — add `getDashboardSummary` and `getContractTotals` to `frontend/lib/api.ts`.
5. **Dashboard page** — replace N+1 fetch with parallel `Promise.all([getContracts(), getDashboardSummary()])`.
6. **Contract detail page** — add `getContractTotals` call, replace client-side reduce, update render.
7. **Migration file** — create `supabase/migrations/20260224100000_add_royalty_summary_indexes.sql` with the two composite indexes.
8. **Manual QA** — verify dashboard card shows correct YTD and contract detail shows correct all-time total + per-year breakdown.

---

## 7. Out of Scope

- The existing `GET /api/sales/summary/{contract_id}` (contract-year YTD with minimum guarantee / advance tracking) is untouched. It serves the YTD summary card on the contract detail page and is already correct.
- Dashboard "Active Contracts" card count is unaffected; it already comes from `getContracts()` without N+1.
- No changes to `SalesPeriod` model or the period list endpoint.
