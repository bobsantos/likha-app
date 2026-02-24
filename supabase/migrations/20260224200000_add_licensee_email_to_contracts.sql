-- Phase 2, Task 3: Email Intake
-- Add licensee_email to contracts so inbound reports can be auto-matched
-- by the sender's From address.

ALTER TABLE contracts ADD COLUMN licensee_email TEXT;
