# Phase 1.2 Backend Check — Discrepancy Fields

**Date:** 2026-02-23

## Summary

No backend changes are required. All three fields are already present and working.

---

## 1. GET endpoint returns discrepancy fields

**Endpoint:** `GET /api/sales/contract/{contract_id}`
**File:** `backend/app/routers/sales.py`, line 80–95

The endpoint returns `List[SalesPeriod]`. The `SalesPeriod` model (in
`backend/app/models/sales.py`) has two `@computed_field` properties:

- `discrepancy_amount` — `royalty_calculated - licensee_reported_royalty`; `None` if
  `licensee_reported_royalty` is not set.
- `has_discrepancy` — `True` if `licensee_reported_royalty` is set and differs from
  `royalty_calculated`.

These are Pydantic v2 computed fields, so FastAPI serialises them automatically in
the JSON response alongside the stored columns. No extra query or model change is
needed.

## 2. confirm endpoint saves licensee_reported_royalty

**Endpoint:** `POST /api/sales/upload/{contract_id}/confirm`
**File:** `backend/app/routers/sales_upload.py`, lines 360–370

```python
insert_data: dict[str, Any] = {
    "contract_id": contract_id,
    "period_start": str(period_start),
    "period_end": str(period_end),
    "net_sales": str(mapped.net_sales),
    "category_breakdown": category_breakdown_for_db,
    "royalty_calculated": str(royalty),
    "minimum_applied": minimum_applied,
}
if mapped.licensee_reported_royalty is not None:
    insert_data["licensee_reported_royalty"] = str(mapped.licensee_reported_royalty)
```

`licensee_reported_royalty` is conditionally included — written to the DB only when
the spreadsheet parser extracted a value for it. The response is `SalesPeriod`, which
includes the computed discrepancy fields.

## 3. SalesPeriodCreate also accepts licensee_reported_royalty

The manual-entry endpoint (`POST /api/sales/`) uses `SalesPeriodCreate`, which
declares `licensee_reported_royalty: Optional[Decimal] = None`. However, the
`sales.py` router does **not** include this field in its `INSERT` statement (line
64–72 in `sales.py`). This is a minor gap for the manual-entry path, but that
endpoint is currently hidden from the UI and not part of Phase 1.2 scope.

## Conclusion

The spreadsheet-upload confirm endpoint and the GET list endpoint are fully
implemented. The frontend can read `licensee_reported_royalty`, `discrepancy_amount`,
and `has_discrepancy` from `GET /api/sales/contract/{contract_id}` with no additional
backend work.
