-- Add source_file_path column to sales_periods
-- Stores the Supabase Storage path of the original uploaded sales report file.
-- Path format: sales-reports/{user_id}/{contract_id}/{sanitized_filename}

ALTER TABLE sales_periods ADD COLUMN source_file_path text;
