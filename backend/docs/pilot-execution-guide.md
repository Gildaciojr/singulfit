# SingulFit Controlled Pilot Execution Guide

Execute this guide only in staging or production-equivalent infrastructure.
Use an ADMIN JWT and never place tokens, secrets, payment payloads, personal
health data, or complete phone numbers in notes.

## 1. Preflight

Before creating the cohort:

```bash
npx prisma migrate deploy
curl --fail https://api.example.com/api/v1/health/live
curl --fail https://api.example.com/api/v1/health/ready
npm run smoke:test
```

The smoke command records `SMOKE_TEST_STARTED` followed by
`SMOKE_TEST_PASSED` or `SMOKE_TEST_FAILED` in `SystemEvent`. A passing smoke
older than 24 hours is not accepted by the pilot decision gate.

Complete the VPS, secrets, backup, restore, and launch checklists before
inviting real users.

## 2. End-To-End Product Validation

Run the controlled journey before opening or expanding a cohort:

```bash
npm run build
npm run lint
npx prisma validate
npx prisma migrate status
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

For a focused diagnosis of the product journey:

```bash
npx jest --config ./test/jest-e2e.json --runInBand \
  --runTestsByPath test/app.e2e-spec.ts \
  -t "complete controlled-pilot journey"
```

The E2E uses mocked PagBank, Evolution, and OpenAI providers. It validates:

- registration with a pending subscription and blocked pre-payment access
- idempotent PIX creation and PagBank webhook approval
- paid invoice, active subscription, and restored product access
- activation welcome message
- deduplicated Evolution image ingestion and persistent local media
- nutrition analysis, safe response evaluation, and single outbound response
- recommendation consumption by the coach and daily-coach idempotency
- first-value detection, activation score, and the `ACTIVATED` stage
- pilot participant synchronization and funnel metrics
- revenue, cost, profitability, and growth snapshot idempotency
- separation of AI costs in USD from operational and revenue values in BRL

This test does not prove real provider connectivity, DNS, TLS, firewall,
worker processes, backup, or restore. Keep those as mandatory manual and smoke
evidence for the launch decision.

## 3. Create A Cohort

```http
POST /api/v1/admin/pilot/cohorts
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "name": "Pilot June 2026",
  "description": "Controlled production pilot with support coverage.",
  "status": "ACTIVE",
  "startsAt": "2026-06-15T12:00:00.000Z",
  "endsAt": "2026-06-29T12:00:00.000Z"
}
```

Use `PLANNED` while preparing evidence and `ACTIVE` when the pilot begins.
`COMPLETED` and `CANCELED` are not valid creation states.

List and inspect cohorts:

```http
GET /api/v1/admin/pilot/cohorts
GET /api/v1/admin/pilot/cohorts/{cohortId}
```

## 4. Add Participants

Participants must already have a SingulFit user ID. This means the current data
model treats every invited participant as a registered account; the
`registeredUsers` metric confirms that the linked account exists in the pilot
period.

```http
POST /api/v1/admin/pilot/cohorts/{cohortId}/participants
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "userIds": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ],
  "notes": "Consent and support channel confirmed."
}
```

Duplicate user IDs are ignored idempotently. Participants cannot be added to
completed or canceled cohorts.

## 5. Record Manual Checks

Record each check through the authenticated operator account:

```http
POST /api/v1/admin/pilot/cohorts/{cohortId}/checks
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "checkType": "TLS",
  "status": "PASSED",
  "notes": "Certificate and renewal verified at 2026-06-15T10:00Z."
}
```

Required check types:

- `DNS`
- `TLS`
- `FIREWALL`
- `BACKUP`
- `RESTORE`
- `PAGBANK_REAL`
- `EVOLUTION_REAL`
- `OPENAI_REAL`
- `FIRST_PAYMENT`
- `FIRST_WEBHOOK`
- `FIRST_WHATSAPP`
- `FIRST_ANALYSIS`

Statuses are `PENDING`, `PASSED`, `FAILED`, or `WAIVED`. Missing, pending, or
failed evidence is `NO_GO`. A waived check is `WARNING` and requires an owner,
deadline, and explicit acceptance outside the API.

## 6. Read Metrics

```http
GET /api/v1/admin/pilot/cohorts/{cohortId}/metrics
```

Metrics include:

- invited, registered, paid, and activated users
- first meal, analysis, recommendation, and coach milestones
- initial churn, activation, and retention rates
- average AI quality and safety
- average daily image usage
- inbound and sent messages
- AI cost in USD
- WhatsApp and storage costs in BRL

USD and BRL are returned separately and must not be added without an explicitly
recorded exchange rate.

Participant activation is reconciled from the existing Activation Engine when
metrics are read. The first transition emits `PILOT_PARTICIPANT_ACTIVATED`.

## 7. Decision Criteria

Generate the structured report:

```http
GET /api/v1/admin/pilot/cohorts/{cohortId}/report
```

The decision service evaluates:

- production readiness and worker heartbeats
- latest smoke result
- outbox dead letters
- provider configuration
- critical and operational errors
- activation and initial churn
- AI quality, blocked responses, and fallbacks
- every required manual check

Decision meanings:

- `GO`: all blocking evidence passed and no warning threshold was reached.
- `WARNING`: no blocker exists, but quality, activation, errors, a waived
  manual check, or another threshold requires monitored operation.
- `NO_GO`: readiness, worker, smoke, dead-letter, provider, critical error,
  quality, or mandatory manual evidence is missing or failing.

Provider readiness proves configuration presence. The `*_REAL` manual checks
prove actual connectivity and controlled end-to-end execution.

## 8. Complete The Cohort

Review the JSON report and attach infrastructure evidence to the operational
pilot report without secrets.

```http
POST /api/v1/admin/pilot/cohorts/{cohortId}/complete
Authorization: Bearer <ADMIN_JWT>
```

Completion marks every non-dropped participant as `COMPLETED` and emits
`PILOT_COHORT_COMPLETED`. Do not complete a cohort to hide an unresolved
`NO_GO`; retain the report and incident evidence.

## 9. Launch Decision

Approve wider launch only when:

1. The latest generated report recommends `GO`.
2. Backup and restore evidence refers to the deployed release.
3. First payment, webhook, WhatsApp, and analysis checks passed.
4. No dead letters or unexplained critical failures remain.
5. Remaining risks have an owner and deadline.

Use the existing [pilot report template](./pilot-report-template.md) for the
human approval record.
