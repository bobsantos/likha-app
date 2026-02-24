-- Migration: add metadata column to sales_periods
--
-- Phase 1.1.1: The column mapper now supports "Keep as additional data" (metadata).
-- Columns mapped to "metadata" are captured as key-value lists and stored here
-- as an opaque JSON blob.  The metadata does NOT affect royalty calculations.
--
-- After applying this migration, uncomment the metadata insert line in:
--   backend/app/routers/sales_upload.py  (search for "upload_metadata")

ALTER TABLE sales_periods
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;

COMMENT ON COLUMN sales_periods.metadata IS
  'Arbitrary columns captured by the column mapper when mapped to "metadata". '
  'Stored as {column_name: [row_value, ...]} for audit/reference. '
  'Does not affect royalty calculations.';
