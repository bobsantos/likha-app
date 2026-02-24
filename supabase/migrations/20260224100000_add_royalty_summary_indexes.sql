-- Performance indexes for the royalty summary endpoints.
--
-- GET /api/sales/dashboard-summary uses:
--   1. contracts filtered by (user_id, status)
--   2. sales_periods filtered by (contract_id, period_start)
--
-- GET /api/sales/contract/{id}/totals uses:
--   1. sales_periods filtered by contract_id (already covered by FK index)
--      A composite index on (contract_id, period_start) also benefits the
--      dashboard-summary YTD filter at no extra cost.

-- Composite index for dashboard-summary: filter contracts by user_id and status
CREATE INDEX IF NOT EXISTS idx_contracts_user_status
  ON contracts (user_id, status);

-- Composite index for dashboard-summary: filter + range-scan on period_start
-- contract_id alone is already indexed (FK), but a composite index speeds up
-- the YTD filter (.in_ on contract_id + .gte on period_start).
CREATE INDEX IF NOT EXISTS idx_sales_periods_contract_period_start
  ON sales_periods (contract_id, period_start);
