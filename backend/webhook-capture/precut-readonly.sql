-- Future read-only preflight, not executed by this component.
-- Run only after forwarding is paused, API in-flight has drained and all old
-- consumers are quiescent. No IDs, payloads, secrets or client names are output.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SELECT status::text,count(*) AS events,min("availableAt") AS first_available
FROM outbox_events GROUP BY status ORDER BY status;
SELECT "eventType",status::text,count(*) AS events,min("availableAt") AS first_available
FROM outbox_events WHERE status::text<>'PROCESSED'
GROUP BY "eventType",status ORDER BY "eventType",status;
SELECT inbox.status::text AS inbox_status,inbox.attempts,
       coalesce(parent.status::text,'MISSING') AS parent_outbox_status,
       count(*) AS inbound_events
FROM evolution_inbound_events inbox
LEFT JOIN outbox_events parent ON parent."aggregateId"=inbox.id
  AND parent."eventType"='WHATSAPP_MESSAGE_RECEIVED'
WHERE inbox.status::text='FAILED'
GROUP BY inbox.status,inbox.attempts,parent.status
ORDER BY inbox.attempts,parent.status;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM outbox_events WHERE status::text='FAILED') THEN
    RAISE EXCEPTION 'CUTOVER_BLOCKED: historical outbox FAILED requires explicit review';
  END IF;
  IF EXISTS(SELECT 1 FROM evolution_inbound_events inbox JOIN outbox_events parent
      ON parent."aggregateId"=inbox.id AND parent."eventType"='WHATSAPP_MESSAGE_RECEIVED'
      WHERE inbox.status::text='FAILED' AND parent.status::text IN ('PENDING','PROCESSING','FAILED')) THEN
    RAISE EXCEPTION 'CUTOVER_BLOCKED: failed inbox has a replayable parent';
  END IF;
  IF EXISTS(SELECT 1 FROM outbox_events event JOIN outbound_messages outbound
      ON outbound.id=event.payload->>'outboundMessageId'
      WHERE event."eventType"='ACTIVATION_ONBOARDING_RESPONSE_REQUESTED'
      AND event.status::text='PROCESSED' AND outbound.status::text IN ('PENDING','SENDING','FAILED')) THEN
    RAISE EXCEPTION 'CUTOVER_BLOCKED: automatic outbound reconciliation needs explicit review';
  END IF;
  IF EXISTS(SELECT 1 FROM outbox_events WHERE status::text='PROCESSING') OR
     EXISTS(SELECT 1 FROM evolution_inbound_events WHERE status::text='PROCESSING') OR
     EXISTS(SELECT 1 FROM outbound_messages WHERE status::text='SENDING') THEN
    RAISE EXCEPTION 'CUTOVER_BLOCKED: in-flight or ambiguous delivery remains';
  END IF;
END $$;
COMMIT;
