-- Reason recorded when an Administrator denies a credit limit request.
ALTER TABLE credit_limit_requests ADD COLUMN IF NOT EXISTS denial_reason text;
