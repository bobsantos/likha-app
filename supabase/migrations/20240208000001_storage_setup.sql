-- Storage setup for contract PDFs
-- Migration: 20240208000001_storage_setup

-- Create the contracts storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for PDFs
-- Note: RLS is enabled for storage.objects by default

-- Policy: Users can upload PDFs to their own folder
CREATE POLICY "Users can upload their own contract PDFs"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'contracts'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can view their own PDFs
CREATE POLICY "Users can view their own contract PDFs"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'contracts'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can update their own PDFs
CREATE POLICY "Users can update their own contract PDFs"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'contracts'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can delete their own PDFs
CREATE POLICY "Users can delete their own contract PDFs"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'contracts'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
