# SingulFit Backend Architecture Status

## Status

The backend is a NestJS modular monolith using PostgreSQL 16 and Prisma. The
runtime is split into one HTTP API and three non-HTTP worker roles. Durable
asynchronous work uses the existing transactional outbox; no Redis, Kafka,
RabbitMQ, BullMQ, or additional provider was introduced.

Current schema inventory: 113 Prisma models, 84 enums, and 38 migration
directories.

## Runtime Architecture

- API: `src/main.ts` bootstraps `AppModule`, Helmet, explicit CORS, global
  validation, throttling, and graceful shutdown.
- Workers: `src/main.worker.ts` bootstraps `WorkersModule` with
  `createApplicationContext`; it never opens an HTTP listener.
- Runtime roles: `API`, `OUTBOX`, `AI`, and `AUTOMATION` are validated before
  module initialization.
- Persistence: PostgreSQL through the global `PrismaModule`.
- Async delivery: transactional `OutboxEvent`, fenced claims, retries,
  exponential backoff, dead letters, and worker heartbeats.
- Production checks: `ProductionModule` validates local dependencies without
  contacting paid providers.

## Module Responsibilities

- `Auth`, `Users`: identity, JWT access/refresh sessions, roles, and user data.
- `Subscriptions`, `Billing`, `Payments`, `PagBank`, `Webhooks`: plans,
  invoices, PIX, payment state, and authenticated provider callbacks.
- `WhatsApp`, `Evolution`: conversations, inbound ingestion, outbound delivery,
  and provider webhook protection.
- `Storage`: authenticated media metadata, local storage, ownership checks, and
  protected downloads.
- `AI`: AI jobs, OpenAI gateway, usage/cost records, recovery, and reservations.
- `Nutrition`: meals, vision analysis, quality scores, patterns, insights,
  trends, and nutrition recommendations.
- `Responses`: context-aware response composition and outbound requests.
- `Context`: preferences, conversation memory, snapshots, and user context
  assembly.
- `Automation`, `Coach`: scheduled messages, daily coaching, reviews,
  engagement, consistency, churn risk, and reengagement.
- `Behavior`: behavioral profile, motivation, stage of change, adherence,
  triggers, insights, and daily snapshots.
- `Recommendations`: contextual recommendation engines, confidence, lifecycle,
  snapshots, and coach/response consumption.
- `AI Quality`: deterministic quality and safety evaluation, fallback, prompt
  quality, review queue, and daily read models.
- `Activation`: auditable onboarding stages, first-value detection, score,
  risk, recovery flows, and daily snapshots.
- `Longitudinal`, `Adaptive Intelligence`: accumulated nutrition history,
  preferences, evolution, relapse, learning, communication, and churn signals.
- `Analytics`: revenue, churn, retention, growth, costs, profitability, and plan
  snapshots.
- `Pilot`: controlled cohorts, participants, manual checks, metrics, reports,
  and GO/WARNING/NO_GO evidence.
- `EventBus`, `IntegrationEvents`: durable internal events and handler registry.
- `Observability`, `Operations`, `Admin`: audit logs, system events, metrics,
  retention cleanup, outbox administration, health, and readiness.
- `Production`: environment validation, runtime mode, migrations, worker,
  outbox, storage, and provider-configuration checks.
- `Profile`, `Progress`, `Workout`, `Diet`, `Entitlements`, `Usage`: existing
  profile, fitness, product entitlement, and consumption capabilities.

## Main Endpoints

Public operational endpoints:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `POST /api/v1/webhooks/pagbank`
- `POST /api/v1/webhooks/evolution`

Authenticated product groups:

- `/api/v1/auth`, `/api/v1/profile`, `/api/v1/progress`
- `/api/v1/workouts`, `/api/v1/diets`, `/api/v1/automations`
- `/api/v1/payments`, `/api/v1/media`

ADMIN JWT groups:

- `/api/v1/admin/health`, `/api/v1/admin/outbox`,
  `/api/v1/admin/system-events`, `/api/v1/admin/metrics`
- `/api/v1/admin/nutrition`, `/api/v1/admin/coach`,
  `/api/v1/admin/behavior`, `/api/v1/admin/recommendations`
- `/api/v1/admin/ai-quality`, `/api/v1/admin/analytics`,
  `/api/v1/admin/observability`, `/api/v1/admin/context`,
  `/api/v1/admin/activation`, `/api/v1/admin/pilot`

Internal endpoints under `/api/v1/internal` remain protected by the existing
JWT guards and are not worker control endpoints.

## Workers

- `OUTBOX_WORKER`: payment and subscription events, inbound WhatsApp, outbound
  delivery requests, context refresh events, and retention cleanup.
- `AI_WORKER`: media analysis, nutrition completion, AI response events, and
  recovery of stale AI work.
- `AUTOMATION_WORKER`: scheduled coach and automation events.

Each worker has a unique instance identity, records startup/heartbeat/shutdown,
claims only its event types, and uses graceful Nest shutdown hooks.

## Core Internal Events

Business flow:

`PAGBANK_WEBHOOK_RECEIVED`, `PAYMENT_APPROVED`,
`SUBSCRIPTION_ACTIVATED`, `WHATSAPP_MESSAGE_RECEIVED`, `MEDIA_RECEIVED`,
`NUTRITION_ANALYSIS_COMPLETED`, `AI_RESPONSE_GENERATED`,
`OUTBOUND_MESSAGE_REQUESTED`, `AUTOMATION_TRIGGERED`, and user context refresh
events.

Reliability and operations:

`RETRY_SCHEDULED`, `RETRY_EXECUTED`, `DEAD_LETTER`, `LEASE_EXPIRED`,
`EVENT_RECOVERED`, `EVENT_IGNORED`, `WORKER_STARTED`, and `WORKER_STOPPED`.

Domain observability also records nutrition, coach, behavior, recommendation,
AI-quality, and analytics recalculation events in `SystemEvent`.

## Principal Entities

- Identity and commerce: `User`, `AuthSession`, `Plan`, `Subscription`,
  `Invoice`, `Payment`, `WebhookEvent`.
- Messaging and storage: `Conversation`, `Message`, `MediaFile`,
  `EvolutionInboundEvent`, `OutboundMessage`.
- AI and quality: `PromptVersion`, `AIJob`, `AIUsage`,
  `AIResponseEvaluation`, `AIReviewQueue`, quality snapshots.
- Context and product: `NutritionProfile`, `FitnessProfile`,
  `UserPreferences`, `ConversationMemory`, `UserContextSnapshot`.
- Nutrition: `Meal`, `MealAnalysis`, `MealItem`, `NutritionQualityScore`,
  `NutritionInsight`, `MealPattern`, `NutritionTrend`.
- Coaching and behavior: `CoachProfile`, `HabitSnapshot`,
  `ConsistencyScore`, `EngagementScore`, `ChurnRiskAssessment`,
  `CoachMessage`, `CoachReview`, `BehavioralProfile`, motivations, stages,
  adherence, triggers, insights, and snapshots.
- Recommendations and analytics: `Recommendation`, recommendation snapshots,
  revenue/churn/retention/cost/profitability/plan/growth snapshots.
- Activation and pilot: `UserActivation`, `ActivationEvent`,
  `ActivationSnapshot`, `PilotCohort`, `PilotParticipant`,
  `PilotManualCheck`.
- Operations: `OutboxEvent`, `WorkerHeartbeat`, `SystemEvent`, `AuditLog`.

## Validated Product Journey

`test/app.e2e-spec.ts` contains the controlled end-to-end journey:

`register -> pending subscription -> PIX -> PagBank webhook -> active
subscription -> activation welcome -> Evolution image -> media -> nutrition
analysis -> AI quality gate -> WhatsApp response -> recommendation -> coach ->
first value -> activation -> analytics -> pilot metrics`

PagBank, Evolution, and OpenAI are replaced by test providers; no paid external
call is made. The scenario validates provider webhook deduplication, outbound
idempotency, coach idempotency, first-value persistence, activation funnel
progress, pilot synchronization, and analytics snapshot consistency.

Run the full validation with:

```bash
npm run test:e2e -- --runInBand
```

Real DNS, TLS, firewall, worker heartbeats, provider connectivity, backup, and
restore remain deployment evidence and are not simulated by this E2E.

## Production Hardening Delivered

- Central production environment validation with weak-secret, CORS, URL,
  numeric-range, runtime-role, and storage-path checks.
- Predictable API/worker separation and graceful shutdown.
- PM2 process definitions with restart policy, memory ceilings, role-specific
  environment, and separate logs.
- Multi-stage production image and Compose topology with persistent volumes,
  migration gate, loopback-only API binding, and no published PostgreSQL port.
- Liveness, readiness, and authenticated operational health.
- Readiness verifies schema migrations, all worker heartbeats, outbox backlog,
  provider configuration, and writable storage without paid external calls.
- Transactional smoke claim that rolls back its synthetic outbox event.
- Existing Helmet, explicit CORS, throttling, JWT guards, webhook secrets, media
  ownership checks, and safe public health output retained.

## Remaining Risks

- Rate limiting is process-local. Keep one API instance until shared limiting
  exists or accept per-instance limits explicitly.
- Local media storage requires volume backup and single-writer operational
  discipline. Horizontal API scaling needs shared object storage in a future
  project.
- Provider configuration readiness proves configuration presence, not external
  provider availability. Provider outages remain visible through normal
  request failures and system events.
- PostgreSQL backup, restore drills, secret rotation, TLS, firewall, reverse
  proxy, host monitoring, and alert routing are infrastructure responsibilities
  and must be exercised before launch.
- Prisma migrations require forward-fix discipline; destructive rollback is not
  automatic.
- Cost configuration is operational input and must be reviewed whenever provider
  pricing changes.

## Recommended Next Steps

1. Run a staging deployment with production-equivalent topology and complete
   backup/restore and rollback drills.
2. Configure TLS, firewall rules, off-host encrypted backups, log rotation, and
   alerts for readiness, dead letters, stale workers, and disk usage.
3. Rotate all launch secrets and verify webhook secrets at both providers.
4. Establish release approval requiring migration review, readiness, smoke, and
   a recorded rollback decision.
5. Perform a controlled load test before increasing traffic or process count.
