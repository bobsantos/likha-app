-- Phase 2, ADR 20260225095833: Email Intake Matching and Post-Confirm Processing
-- Add matching signal columns, period date extraction columns, audit trail link,
-- and extend status constraint to include 'processed'.

ALTER TABLE inbound_reports
  ADD COLUMN candidate_contract_ids text[]      DEFAULT NULL,
  ADD COLUMN suggested_period_start  date        DEFAULT NULL,
  ADD COLUMN suggested_period_end    date        DEFAULT NULL,
  ADD COLUMN sales_period_id         uuid        REFERENCES sales_periods(id) ON DELETE SET NULL;

-- Extend status CHECK to include 'processed'
ALTER TABLE inbound_reports
  DROP CONSTRAINT IF EXISTS inbound_reports_status_check,
  ADD CONSTRAINT inbound_reports_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'processed'));

-- Index for looking up reports linked to a sales period
CREATE INDEX idx_inbound_reports_sales_period_id
  ON inbound_reports (sales_period_id)
  WHERE sales_period_id IS NOT NULL;
