ALTER TABLE "outbound_messages"
  DROP CONSTRAINT "outbound_messages_lifecycle_check";

ALTER TABLE "outbound_messages"
  ADD CONSTRAINT "outbound_messages_lifecycle_check"
  CHECK (
    (
      "status" IN ('PENDING', 'SENDING')
      AND "externalMessageId" IS NULL
      AND "sentAt" IS NULL
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NULL
      AND "errorMessage" IS NULL
    )
    OR (
      "status" = 'SENT'
      AND "externalMessageId" IS NOT NULL
      AND "sentAt" IS NOT NULL
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NULL
      AND "errorMessage" IS NULL
    )
    OR (
      "status" = 'DELIVERED'
      AND "externalMessageId" IS NOT NULL
      AND "sentAt" IS NOT NULL
      AND "deliveredAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "errorMessage" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "deliveredAt" IS NULL
      AND "failedAt" IS NOT NULL
      AND "errorMessage" IS NOT NULL
    )
  );
