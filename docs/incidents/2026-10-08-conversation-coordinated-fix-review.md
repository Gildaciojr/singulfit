# Coordinated conversational correction — local review only

Production base: `eeea0fe03f26fe4c79258b44aeb18dc5cad78335`.
No production connection, SQL execution, commit, push or deployment was performed.
The preceding 17-file P0 package is preserved; these corrections are additional.

## Boundaries

- Request polarity is shared by operation recognition and final Workout authorization.
  A quoted affirmative fragment cannot erase the full inbound's refusal. Ownership,
  pending/source bindings, safety, profile and effect idempotency remain mandatory.
- Food/portion recognition uses literal evidence independently of plan adherence.
  Household measures are not converted into grams or calories. A later description
  is appended to the stored report in order; the model is instructed to use explicit
  corrections from the latest turn. Inconclusive comparison and technical failure
  no longer generate the generic food-and-quantity question.
- Only an owned inbound TEXT response in the same active conversation, scheduled
  as DAILY_COACH/WHATSAPP_COACH_COMMAND, bypasses reminder preferences at delivery.
  Automatic outreach, subscription authorization and global rule enablement remain.
- Pending correlation still requires SENT, ownership and an unconsumed receipt,
  within the existing 24-hour window. No consumed question is reused and no expiry
  is extended to make a test pass. Report recognition/comparison metadata is saved
  in continuationEvidence alongside reportedContent and the next question.

## Delivery uncertainty — not solved by this patch

AutomationService calls EvolutionGateway.sendText with number and text. The local
gateway contract exposes the returned external message identity, but no send
idempotency key or reconciliation operation. After external acceptance, the sender
retries SENT persistence locally three times without resending. A process crash or
exhaustion of those writes can leave SENDING until lease expiry and permit resend.
No exactly-once guarantee or invented provider capability is claimed.

Before implementing a delivery-uncertain recovery, obtain the deployed Evolution
version's supported idempotency/search contract and actual sanitized acceptance/
confirmation evidence. Then choose a bounded reconciliation rather than blind
resend. That change is not implemented here.

## Production evidence still required

The exact routes of the hydration incident and the two lunch inbounds cannot be
assigned from the fallback text alone. Need their message IDs, SENT questions,
reply-to linkage, receipt decisions, active profile cycles, delivery states and
operational eligibility at those timestamps. Do not export text, phone, credentials,
whole payloads or profile values.

Below are proposed read-only SELECTs, not executed. An authorized operator must
first verify `/opt/singulfit`, Compose `singulfit-production`, its reviewed production
Compose file and the exclusive SingulFit database. Run only through that Compose's
postgres service. Stop if the expected database/project differs. Do not grant an
audit account Docker socket access or dump environment/config/logs.

Bind `message_id` locally to each already identified inbound, label outputs A/B1/B2/C,
and never export the binding. Use default_transaction_read_only, a 5-second statement
timeout and a 1-second lock timeout. All queries belong in BEGIN READ ONLY / ROLLBACK.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT m.timestamp, m.direction, m.type,
       length(m.content) AS inbound_characters,
       m."replyToExternalMessageId" IS NOT NULL AS has_quote
FROM messages m WHERE m.id = :'message_id';

SELECT s.status, s.attempts, s."scheduledFor", s."sentAt",
       s."leaseExpiresAt", s."externalMessageId" IS NOT NULL AS provider_identity_saved,
       s.context->>'source' AS source,
       s.context#>>'{continuation,kind}' AS next_kind,
       s.context#>>'{continuation,meal}' AS meal,
       s.context#>>'{continuationEvidence,adherence}' AS adherence,
       s.context#>>'{continuationEvidence,mealReportStatus}' AS report_status,
       s.context#>>'{continuationEvidence,mealComparisonStatus}' AS comparison_status,
       length(s.context#>>'{continuationEvidence,reportedContent}') AS reported_characters
FROM scheduled_messages s
JOIN messages m ON m.id = :'message_id'
JOIN conversations c ON c.id = m."conversationId"
WHERE s."userId" = c."userId" AND s."conversationId" = c.id
  AND s.context->>'sourceMessageId' = m.id;

SELECT e."eventType", e.status, e.attempts,
       e."createdAt", e."claimedAt", e."processedAt", e."failedAt",
       e.payload->>'state' AS receipt_state,
       e.payload#>>'{result,domain}' AS result_domain,
       e.payload#>>'{result,evidence,adherence}' AS adherence
FROM outbox_events e
JOIN messages m ON m.id = :'message_id'
JOIN conversations c ON c.id = m."conversationId"
WHERE (e."aggregateType" = 'MESSAGE' AND e."aggregateId" = m.id)
   OR (e."eventType" = 'CONTINUATION_SEMANTIC_RECEIPT'
       AND e.payload->>'sourceMessageId' = m.id
       AND e.payload->>'userId' = c."userId"
       AND e.payload->>'conversationId' = c.id);

SELECT j.type, j.status, j.attempts, j."startedAt", j."completedAt", j."failedAt",
       j.result#>>'{executionAudit,providerCalls}' AS provider_calls,
       j.result#>>'{executionAudit,repairAttempted}' AS repair_attempted,
       j.error LIKE '%INVALID_PARAMETER%' AS invalid_parameter_reported
FROM ai_jobs j
JOIN messages m ON m.id = :'message_id'
JOIN conversations c ON c.id = m."conversationId"
WHERE j."messageId" = m.id AND j."userId" = c."userId";

SELECT p."remindersEnabled", p."progressReminderEnabled"
FROM user_automation_preferences p
JOIN conversations c ON c."userId" = p."userId"
JOIN messages m ON m."conversationId" = c.id
WHERE m.id = :'message_id';

ROLLBACK;
```

For B2, separately compare its quoted identity to the SENT quantity question inside
the database and export only a boolean. Compare B1/B2 outgoing content only as an
equality boolean. Inspect whether the pending was consumed or intervening outreach
was newer, with timestamps; do not broaden windows or reconstruct absent provider
output. Current states/preferences alone cannot prove historical settings.
