ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_context_check_v2"
  CHECK (
    (
      "type"::text IN ('DIET', 'WORKOUT', 'PROGRESS')
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
    )
    OR (
      "type"::text = 'TEXT'
      AND (
        (
          "conversationId" IS NULL
          AND "messageId" IS NULL
        )
        OR (
          "conversationId" IS NOT NULL
          AND "messageId" IS NOT NULL
        )
      )
    )
    OR (
      "type"::text NOT IN ('DIET', 'WORKOUT', 'PROGRESS', 'TEXT')
      AND "conversationId" IS NOT NULL
      AND "messageId" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_jobs"
  VALIDATE CONSTRAINT "ai_jobs_context_check_v2";

ALTER TABLE "ai_jobs"
  DROP CONSTRAINT "ai_jobs_context_check";

ALTER TABLE "ai_jobs"
  RENAME CONSTRAINT "ai_jobs_context_check_v2"
  TO "ai_jobs_context_check";
