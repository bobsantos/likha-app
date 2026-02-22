-- Draft contract support + duplicate filename detection
-- Migration: 20240208000002_draft_contracts

-- Add status column (existing rows default to 'active')
ALTER TABLE contracts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'active'));

-- Add original filename for duplicate detection
ALTER TABLE contracts ADD COLUMN filename TEXT;

-- Add storage path for deterministic file references
ALTER TABLE contracts ADD COLUMN storage_path TEXT;

-- Drop NOT NULL constraints for fields not available at draft time
-- (These are populated during the confirm/review step, not at extraction)
ALTER TABLE contracts ALTER COLUMN licensee_name DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN royalty_rate DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN royalty_base DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN contract_start_date DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN contract_end_date DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN minimum_guarantee DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN minimum_guarantee_period DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN reporting_frequency DROP NOT NULL;

-- Indexes for duplicate-check and status-filter queries
CREATE INDEX idx_contracts_user_filename ON contracts(user_id, lower(filename));
CREATE INDEX idx_contracts_user_status ON contracts(user_id, status);
