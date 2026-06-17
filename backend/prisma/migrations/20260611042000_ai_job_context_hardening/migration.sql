ALTER TABLE "ai_jobs"
  DROP CONSTRAINT "ai_jobs_context_check";

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_context_check"
  CHECK (
    (
      "type"::text IN ('DIET', 'WORKOUT', 'PROGRESS')
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
    )
    OR (
      "type"::text NOT IN ('DIET', 'WORKOUT', 'PROGRESS')
      AND "conversationId" IS NOT NULL
      AND "messageId" IS NOT NULL
    )
  );
