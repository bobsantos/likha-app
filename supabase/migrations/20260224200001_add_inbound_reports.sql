-- Phase 2, Task 3: Email Intake
-- Create inbound_reports table to store emailed royalty reports received
-- via Postmark inbound webhook, pending review by the licensor.

CREATE TABLE inbound_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contract_id UUID,
  sender_email TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attachment_filename TEXT,
  attachment_path TEXT,
  match_confidence TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing a user's reports efficiently
CREATE INDEX idx_inbound_reports_user_id ON inbound_reports (user_id);

-- Index for looking up reports by contract
CREATE INDEX idx_inbound_reports_contract_id ON inbound_reports (contract_id);
