-- Phase 1: Discrepancy Detection
-- Adds licensee_reported_royalty to sales_periods so licensors can record
-- what the licensee claimed to owe and compare it against the calculated amount.

ALTER TABLE sales_periods
  ADD COLUMN IF NOT EXISTS licensee_reported_royalty DECIMAL(15,2) NULL;
