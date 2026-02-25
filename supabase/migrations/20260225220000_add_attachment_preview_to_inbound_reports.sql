-- Migration: add attachment preview columns to inbound_reports
--
-- attachment_metadata_rows: structured key/value rows from the attachment
--   header block (rows before the data header, where a cell looks like a
--   label).  Stored as an array of {"key": "...", "value": "..."} objects.
--
-- attachment_sample_rows: the column headers and first 3 data rows of the
--   attachment, stored as {"headers": [...], "rows": [[...], ...]}.
--
-- Both columns default to NULL so existing rows and attachments that could
-- not be parsed are represented as NULL rather than an empty structure.

ALTER TABLE inbound_reports
  ADD COLUMN IF NOT EXISTS attachment_metadata_rows jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attachment_sample_rows   jsonb DEFAULT NULL;
