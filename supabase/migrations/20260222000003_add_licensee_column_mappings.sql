-- Phase 1.1: Spreadsheet Upload with Column Mapping
-- Stores per-licensee column mapping configurations so licensors don't have
-- to remap the same columns each time a licensee sends a new report.

CREATE TABLE licensee_column_mappings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  licensee_name TEXT        NOT NULL,
  column_mapping JSONB      NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure one mapping per licensor per licensee
CREATE UNIQUE INDEX licensee_column_mappings_user_licensee_idx
  ON licensee_column_mappings (user_id, licensee_name);
