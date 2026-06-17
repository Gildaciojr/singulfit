# NutraFit VPS Deploy Execution Report

## Execution Identity

- Date: 2026-06-15
- Operator: Codex local workspace session
- Target environment: not supplied
- VPS host: not supplied
- SSH user: not supplied
- Domain: not supplied
- Approved branch: not supplied
- Approved commit: not supplied
- Previous release commit/image: not supplied

## Local Artifact Audit

- `docker-compose.prod.yml`: PostgreSQL has no published port; API binds to
  `127.0.0.1`; outbox, AI, and automation workers are separate services.
- `Dockerfile`: multi-stage Node.js 22 production image; Prisma generation and
  application build occur in the image build.
- `ecosystem.config.js`: valid alternative topology with one API and three
  worker processes. It must not run alongside Docker Compose.
- `.env.example`: contains every mandatory Block 31 variable name.
- `smoke.ts`: checks database access, migrations, all worker heartbeats,
  transactional outbox claim, public health, ADMIN authentication, and ADMIN
  health without calling paid provider operations.
- Health/readiness: liveness is process-only; readiness covers database,
  migrations, workers, outbox, provider configuration, storage, and production
  environment validation.

## Commands Executed Locally

```text
docker version
docker compose version
docker info
required-variable presence check against .env.example
.env.production existence check
```

Relevant results:

- Docker CLI: `28.5.1`.
- Docker Compose: `v2.40.2-desktop.1`.
- Docker daemon: available after explicit managed-session approval.
- Compose configuration: valid with the example environment structure.
- Production image: built successfully as
  `nutrafit-backend:block31-validation`.
- Final image ID:
  `sha256:0a00a4576df04fa9ecf259f7d69ac4ba714116540cde1ede964207c095f4403b`.
- Final image size: `211522537` bytes.
- Image runtime: Node.js `22.22.3`, UID `1000`, with API, worker, smoke, Prisma
  schema, and migrations present.
- Every mandatory variable name exists in `.env.example`.
- Real `.env.production`: absent from the workspace, as expected for secrets
  not stored in Git.
- VPS/SSH/domain/production URL configuration: absent from the session.

The first image audit found two high-severity runtime findings through
`lodash 4.17.23` and one moderate finding through `qs 6.15.0`. The release
dependencies were minimally updated to `@nestjs/config 4.0.4` and a
`qs 6.15.2` override.

Post-correction validation:

- `npm ci`: passed after retrying outside the managed Windows sandbox. The
  first attempt was blocked by an `EPERM` file lock and left `node_modules`
  incomplete; reinstalling from the lockfile repaired it.
- Prisma generate and validate: passed.
- Prisma migration status: 36 migrations, database up to date.
- Build and lint: passed.
- Unit tests: 118 suites and 311 tests passed.
- End-to-end tests: 1 suite and 23 tests passed.
- Host `npm audit --omit=dev`: zero runtime vulnerabilities.
- Rebuilt production image: passed and reported zero runtime vulnerabilities
  after `npm prune --omit=dev`.
- Full dependency installation still reports development-tool advisories;
  they are excluded from the pruned production image.

## Not Executed

The following operations were not executed because no VPS target, SSH identity,
production domain, approved release commit, or real secret source was supplied:

- VPS operating-system, capacity, permission, listener, and firewall pre-flight.
- `git pull`, dependency installation, image build, migration, or service start
  on the VPS.
- Public DNS, TLS, redirect, CORS, and external port validation.
- Production health, authenticated ADMIN health, workers, logs, and smoke.
- PostgreSQL backup, checksum, isolated restore, table count, and post-restore
  smoke.
- PagBank, Evolution, OpenAI, payment, webhook, WhatsApp, or nutrition flow.
- Persistent pilot manual-check updates.

No result above is marked as passed without direct evidence.

The image validation does not prove that production environment validation,
provider credentials, network policy, storage permissions, or external
services are correct on the VPS.

## Blocking Evidence

- [ ] DNS
- [ ] TLS
- [ ] FIREWALL
- [ ] API
- [ ] WORKERS
- [ ] SMOKE
- [ ] BACKUP
- [ ] RESTORE
- [ ] PAGBANK_REAL
- [ ] EVOLUTION_REAL
- [ ] OPENAI_REAL
- [ ] FIRST_PAYMENT
- [ ] FIRST_WEBHOOK
- [ ] FIRST_WHATSAPP
- [ ] FIRST_ANALYSIS

## Decision

`NO_GO`

The deployment artifacts are locally coherent, but the real deployment and
every mandatory production evidence gate remain unexecuted. Change to `GO`
only after the commands in `vps-deploy-checklist.md` and
`backup-restore-drill.md` have produced direct evidence for the approved
release and all pilot manual checks are recorded as passed.
