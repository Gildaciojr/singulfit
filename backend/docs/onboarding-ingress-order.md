# Durable initial-onboarding ingress order

## Guarantee and scope

Canonical order means committed admission order of identified TEXT messages, not physical WhatsApp send time, provider timestamps, HTTP socket arrival time, or UUID sorting. Concurrent HTTP requests may commit in either order; that committed order is retained. Listed entries belonging to the same identified user in one provider batch are admitted sequentially. Different users and API replicas remain concurrent.

The ordering identity is the user: initial-onboarding state and its existing transaction lock are user-scoped. This deliberately spans active Conversation changes for the same user. It does not impose a global queue or claim ordering of every modern-runtime/external-provider side effect. The protected operation is the initial-onboarding profile transition, including dietary correction/confirmation, committed together with its outbound, outbox and consumption receipt.

The preexisting stale-provider-timestamp clarification remains a safety validation, not the ordering algorithm. Equal timestamps do not bypass the persisted predecessor check. A late unquoted confirmation with an older provider timestamp does not confirm a newer dietary draft.

## Additive schema

Migration: `20261013210000_onboarding_ingress_order`.

- `users.onboardingIngressCounter`: nonnegative INTEGER, default 0.
- `evolution_inbound_events.orderingUserId`: optional owner, FK to existing users.
- `admissionSequence`: optional positive INTEGER, unique with owner.
- `turnProcessedAt`: optional durable consumption receipt.
- Index for unresolved positions per owner.

No new table, Message column, historical reorder, deletion, or sequence backfill. Message and inbox are associated by their existing unique `(instanceName, externalMessageId)` keys, with owner validation before materialization and profile transition. INTEGER avoids introducing BigInt values into existing user JSON responses. Overflow fails the admission transaction; it never wraps or resets the stream (2,147,483,647 positions per user). Monitor counter exhaustion; do not reset counters.

## Admission and consumption

Webhook authentication/instance validation runs first. Known TEXT sender identity is resolved using the existing remote-JID/WhatsApp-phone mappings. Admission then locks that user's admission key, rechecks inbox deduplication, increments the counter and inserts inbox + WHATSAPP outbox in the same transaction. A failed insert/publication rolls back the counter. Duplicate provider IDs reuse the immutable original position. Unknown senders, fromMe/group entries and non-TEXT messages receive no invented onboarding position; original intake handling remains.

Workers can materialize messages out of order. Under the existing user-scoped onboarding lock, a sequenced turn checks for any lower unresolved admission, even one not yet materialized. Pending/retry predecessors defer the successor using the existing bounded DeliveryPendingError path. Dead-letter inbox or COACH predecessors report an explicit ID and require operational recovery. Claims and transport leases retain existing fencing. A completed profile transition atomically records turnProcessedAt; crash/replay cannot apply that position again. Successful COACH outbox completion also records the receipt atomically with its claim fence for messages handled outside initial onboarding. It does not release a position on a stale claim.

Profile advancement additionally retains the existing dependency on confirmed prompt delivery. Unrelated event families such as context refresh do not become predecessors. Urgent safety replies bypass the profile-order barrier but preserve the pending state, answers and earlier unresolved receipts; they retain normal subscription/send authorization. A confirmation quoting a superseded dietary prompt cannot confirm the current draft; the user receives the current confirmation question.

## Operational modes (default OFF)

`ONBOARDING_INGRESS_ORDERING_MODE` accepts exact `OFF`, `DRAIN`, `REQUIRED`. Invalid values fail closed. No production configuration was changed.

- OFF: original admission without new positions; previously assigned positions still enforce their predecessors. An unsequenced turn cannot bypass an unresolved sequenced stream. This is not a FIFO certification for historical/unsequenced traffic.
- DRAIN: identified new TEXT admissions get positions but normal sequenced profile transitions wait. Historical unsequenced turns may finish through existing code. Urgent safety remains available without profile advancement.
- REQUIRED: new admissions get positions and initial-onboarding profile transitions require them. Unsequenced turns fail explicitly rather than receiving a fabricated late position. Unresolved historical COACH events block sequenced transitions until recovery/drain completes.

## Controlled rollout; old and new worker versions

Old worker binaries do not check the new fields and cannot participate safely once ordered processing is enabled. The migration alone does not prevent an old binary from writing onboarding state. **Do not certify an uncoordinated rolling deployment.**

1. Apply expansion under a separately reviewed deployment. Keep admissions/consumers OFF during any coexistence with old binaries.
2. Quiesce all old inbox/outbox/automation paths that can call initial onboarding; wait for active leases/in-flight operations to finish. Inventory every consumer, including the direct Evolution inbox worker. Preserve all inbox/outbox rows.
3. Deploy the new API and every relevant worker; prove that no old consumer can run. Configure these processes consistently in DRAIN. Incoming known TEXT messages continue being persisted with positions, while historical work drains. Preserve subscription gates and current sessions.
4. Inventory all historical unsequenced inbox and COACH work, including retries, absent-message inbox entries, PROCESSING leases and DEAD_LETTER. Resolve dead letters using existing audited retry/recovery. Do not silently skip, delete, mark consumed or infer an order for them. Compare durable state and transport receipts when resolving ambiguous prior side effects.
5. Only after historical work has actually completed and no old consumer remains, switch the new processes consistently to REQUIRED and retry deferred ordered work. Monitor earliest unresolved receipt, associated inbox/COACH event and outbound lease. Bound the DRAIN window: the existing 24h defer cap can escalate waiting events to dead letter; recover these through audited retry after the barrier opens.

Different modes among **new** workers retain checks for existing positions; however, inconsistent OFF/REQUIRED admission is not an approved steady state. Keep configuration consistent and use a coordinated barrier. Pausing all workers does not authorize dropping webhooks; retain admissions in the new DRAIN API or a previously reviewed durable capture path.

## Rollback and dead letters

Rollback is operational, not destructive SQL. Keep expansion columns/indexes/data. Quiesce consumers and inspect in-flight work. Drain/recover the ordered stream under the new binary before reverting to OFF or rolling back binaries; verify no unresolved ordered receipt or pending ordered response remains. Keep the new consumers until that condition is proven. Do not reset counters, remove columns, reassign positions, or run historical backfills. If the stream cannot be drained safely, retain DRAIN/operational blocking and investigate; an old binary is not a recovery mechanism.

Dead-letter predecessors intentionally block only that user's affected profile stream. Their identifiers remain traceable. Audited retry retains the original admission position. No automatic predecessor skip is introduced. Other users remain concurrent; urgent safety can still receive a durable reply.

## Review evidence

The dedicated PostgreSQL suite covers reversed consumption before earlier materialization, equal timestamps, distinct worker instances, retry/overtaking, inbox and turn dead letters, concurrent Evolution duplicates, counter/turn rollback, correction then confirmation, superseded quoted confirmation, cross-user parallelism including a held database lock, historical DRAIN transition, missing sequence in REQUIRED, urgent safety, admission/materialization crash, stale outbox receipt fencing, constraints, provider batch order, unrelated event families, OFF with persisted positions and owner reassignment.

No providers, production database, Docker/WSL, commit, push or deploy are required or permitted by these tests. Production activation and rollout are separate review steps.
