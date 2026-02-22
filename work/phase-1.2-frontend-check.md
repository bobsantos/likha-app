# Phase 1.2 — Frontend Discrepancy Display: Current State

## 1. Fields already in SalesPeriod type (`frontend/types/index.ts`, lines 91–104)

Core fields (always present):
- `net_sales: number`
- `royalty_calculated: number`
- `minimum_applied: boolean`

Phase 1 discrepancy fields (optional/nullable):
- `licensee_reported_royalty?: number | null`
- `discrepancy_amount?: number | null`
- `has_discrepancy?: boolean`

All three discrepancy fields are already typed. They are marked optional (`?`) meaning the frontend
gracefully handles periods that pre-date spreadsheet upload.

## 2. Current table vs what's missing

The sales periods table in `frontend/app/(app)/contracts/[id]/page.tsx` (lines 386–429) renders
four columns:

| Column            | Source field          | Status   |
|-------------------|-----------------------|----------|
| Period            | period_start/end      | Present  |
| Net Sales         | net_sales             | Present  |
| Calculated Royalty| royalty_calculated    | Present  |
| MG Applied        | minimum_applied       | Present  |

Missing columns (no UI for them at all):
- **Licensee Reported Royalty** — `licensee_reported_royalty` is fetched but never rendered
- **Discrepancy Amount** — `discrepancy_amount` is fetched but never rendered
- **Discrepancy Flag** — `has_discrepancy` is fetched but never surfaced (no badge/icon/row highlight)

The summary stats sidebar (lines 335–345) only shows total calculated royalties and period count.
There is no aggregate discrepancy summary (e.g. total under-reported amount, count of flagged periods).

## 3. API call — does it already return discrepancy fields?

`getSalesPeriods` in `frontend/lib/api.ts` (lines 163–175) calls:

```
GET /api/sales/contract/{contractId}
```

It returns `response.json()` with no field filtering — whatever the backend sends comes through
directly. Whether `licensee_reported_royalty`, `discrepancy_amount`, and `has_discrepancy` are
present in the JSON payload depends entirely on the backend/database, not on the frontend API
client. No frontend changes are needed to the API call itself.

## Summary

- Types: ready, no changes needed
- API client: ready, no changes needed
- UI: three discrepancy columns are completely absent from the table
- Work needed: add three columns to the table and optionally a row-level warning highlight or badge
  when `has_discrepancy` is true; consider adding a discrepancy summary stat card in the sidebar
