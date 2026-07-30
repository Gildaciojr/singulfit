-- The new response type reuses the existing durable outbound pipeline for
-- internal profile-acquisition questions. Turning PROFILE_ACQUISITION_MODE
-- back to OFF requires no schema rollback and leaves historical rows intact.
ALTER TYPE "ResponseType" ADD VALUE IF NOT EXISTS 'PROFILE_ACQUISITION';
