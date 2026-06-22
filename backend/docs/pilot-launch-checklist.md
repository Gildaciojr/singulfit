# SingulFit Pilot Launch Checklist

Complete this checklist in the production-equivalent environment. Attach
evidence without storing secrets, tokens, passwords, payment data, or personal
health data in the report.

## Infrastructure

- [ ] VPS operating system is patched and reboot status is clear.
- [ ] Domain resolves to the intended VPS.
- [ ] TLS certificate is valid for the hostname and auto-renewal is enabled.
- [ ] HTTP redirects to HTTPS.
- [ ] SSH TCP 22 is restricted to approved administrative IPs.
- [ ] Only public TCP 80 and 443 are open.
- [ ] PostgreSQL TCP 5432, API TCP 3000, worker ports, and container internal
      ports are blocked from public access.
- [ ] Reverse proxy forwards only to `127.0.0.1:3000`.
- [ ] Disk, memory, uptime, certificate, and backup monitoring are active.

## Deployment

- [ ] Release commit and image tag are recorded.
- [ ] `.env.production` has no placeholders and mode `0600`.
- [ ] `npm ci`, Prisma generation, build, and migration deploy succeeded.
- [ ] API container/process is healthy.
- [ ] Outbox worker is running with a current heartbeat.
- [ ] AI worker is running with a current heartbeat.
- [ ] Automation worker is running with a current heartbeat.
- [ ] Public liveness returns HTTP 200.
- [ ] Public readiness returns HTTP 200 with `status: ok`.
- [ ] Authenticated admin health returns `status: ok`.
- [ ] `npm run smoke:test` succeeds.

## Providers And Product Flow

- [ ] PagBank sandbox or production mode is explicitly recorded.
- [ ] PagBank URL, token, webhook registration, and secret use the same mode.
- [ ] Evolution URL, instance, API key, and webhook secret are configured.
- [ ] OpenAI key, approved text model, approved vision model, and account limits
      are configured.
- [ ] First plan is active and has reviewed entitlements and price.
- [ ] First controlled payment test completes.
- [ ] First PagBank webhook is authenticated, persisted, and processed once.
- [ ] First WhatsApp message is sent through Evolution.
- [ ] First inbound WhatsApp message is authenticated and processed.
- [ ] First nutritional analysis completes and is visible to the test user.
- [ ] First AI quality/safety fallback is deliberately exercised and produces
      the approved safe behavior.

## Operations And Data Protection

- [ ] Application, worker, proxy, and provider integration logs were reviewed.
- [ ] Logs contain no credentials, JWTs, webhook secrets, raw passwords, or
      unnecessary personal data.
- [ ] Outbox has no unexplained old backlog or dead letters.
- [ ] Cost rates and BRL exchange rate were reviewed.
- [ ] PostgreSQL backup was created, checksummed, and copied off-host.
- [ ] Local uploads were backed up and copied off-host.
- [ ] PostgreSQL restore drill passed.
- [ ] Post-restore migrations, readiness, smoke, and data checks passed.
- [ ] Upload restore/read check passed.
- [ ] Rollback owner, previous image/commit, and traffic-disable procedure are
      recorded.

## Pilot Execution

- [ ] Pilot user list and consent/support channel are defined.
- [ ] Test data handling and deletion procedure are defined.
- [ ] Support owner and incident contacts are available during the window.
- [ ] Metrics for latency, failures, provider usage, and estimated costs are
      being collected.
- [ ] Pilot start and end times are recorded.
- [ ] Findings are entered in the
      [pilot report](./pilot-report-template.md).

## Decision Gate

Mark `NO-GO` when any of these are true:

- TLS or DNS is invalid.
- PostgreSQL or an internal port is publicly reachable.
- Migration, readiness, worker heartbeat, smoke, backup, or restore fails.
- Required provider credentials are missing or environments are mixed.
- A payment/webhook can be duplicated or cannot be reconciled.
- The tested safety fallback does not behave as approved.
- Critical logs expose secrets or sensitive data.

Mark `GO` only after all blocking items pass and remaining risks have an owner,
deadline, and accepted pilot impact.
