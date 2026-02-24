-- Add category_mapping JSONB column to licensee_column_mappings.
-- Stores licensee-specific report-category -> contract-category aliases
-- so subsequent uploads are pre-filled without requiring AI or user input.
ALTER TABLE licensee_column_mappings ADD COLUMN category_mapping JSONB;
