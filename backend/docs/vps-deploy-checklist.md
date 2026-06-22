# SingulFit VPS Deploy Checklist

Use this checklist for a controlled Ubuntu LTS pilot deployment. Docker Compose
is the recommended runtime. PM2 is an alternative for a host-managed Node.js
deployment; never run both topologies at the same time.

Replace example domains, users, paths, and IP ranges before execution.

## 1. Server Baseline

- [ ] Provision an Ubuntu LTS VPS with a static public IP.
- [ ] Create a non-root deploy user with sudo access.
- [ ] Add SSH public keys and verify a second session before changing SSH.
- [ ] Disable direct root login and password authentication after key access is
      confirmed.
- [ ] Restrict SSH at the cloud firewall and UFW to trusted administrative IPs.
- [ ] Enable time synchronization and confirm UTC time.
- [ ] Configure disk, memory, CPU, uptime, and certificate-expiry monitoring.

Run and retain this pre-flight output before installing or changing services:

```bash
set -eu
printf '%s\n' '== release =='
date -u
uname -a
test -r /etc/os-release && cat /etc/os-release
printf '%s\n' '== identity and application directory =='
id
getent passwd "$USER"
sudo -n true
test -d /opt/singulfit
test -r /opt/singulfit
test -w /opt/singulfit
stat -c '%U:%G %a %n' /opt/singulfit
printf '%s\n' '== capacity =='
df -h /
df -h /var/lib/docker 2>/dev/null || true
free -h
printf '%s\n' '== runtime =='
docker version
docker compose version
sudo systemctl is-enabled docker
sudo systemctl is-active docker
printf '%s\n' '== network =='
sudo ss -lntup
sudo ufw status verbose
```

Expected results:

- The operating system is a supported Ubuntu LTS release.
- The deploy user is non-root, uses key-based SSH, and has controlled sudo.
- `/opt/singulfit` is owned by the deployment account and is not world-writable.
- Disk and memory have enough headroom for two images, a database dump, build
  files, logs, PostgreSQL growth, and uploads.
- Docker and Compose v2 are installed, active, and enabled at boot.
- No listener exposes PostgreSQL, port 3000, or a worker publicly.

```bash
sudo apt update
sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC
sudo apt install -y ca-certificates curl git ufw
sudo install -d -o "$USER" -g "$USER" /opt/singulfit
```

A reboot may be required after kernel or critical library updates:

```bash
test -f /var/run/reboot-required && sudo reboot
```

## 2. Docker And Compose

Install Docker Engine from Docker's official Ubuntu repository. Do not use an
unmaintained distro package or the convenience script for production.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

- [ ] Start a new login session so Docker group membership applies.
- [ ] Confirm `docker version` and `docker compose version`.
- [ ] Confirm Docker starts on boot: `sudo systemctl enable --now docker`.

## 3. PM2 Alternative

Skip this section when using Docker. For PM2, install Node.js 22 LTS, npm 10+,
PostgreSQL 16, and PM2. PostgreSQL must listen only on loopback or a private
network.

```bash
sudo npm install -g pm2
pm2 startup
```

Run the command printed by `pm2 startup`, then use
`pm2 start ecosystem.config.js --update-env` and `pm2 save`.

## 4. Domain And DNS

- [ ] Choose the public API hostname, for example `api.example.com`.
- [ ] Create an `A` record pointing to the VPS IPv4 address.
- [ ] Create an `AAAA` record only when IPv6 is configured and firewalled.
- [ ] Remove stale or conflicting records.
- [ ] Wait for DNS propagation and verify from an external resolver.
- [ ] Set `CORS_ALLOWED_ORIGINS` to exact HTTPS frontend origins, without `*`.

```bash
dig +short A api.example.com
dig +short AAAA api.example.com
getent ahosts api.example.com
```

Compare the result with the intended VPS public IP before requesting TLS.

## 5. Reverse Proxy And TLS

Caddy is recommended for the pilot because it obtains and renews TLS
certificates automatically. Nginx with Certbot or Traefik is acceptable when it
is already the team's supported standard. Only the proxy may reach the API
loopback port.

Example `/etc/caddy/Caddyfile`:

```caddyfile
api.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

- [ ] Install Caddy from its official repository.
- [ ] Validate and reload the configuration.
- [ ] Confirm certificate issuance and automatic renewal.
- [ ] Confirm HTTP redirects to HTTPS.
- [ ] Confirm the certificate hostname and expiry from an external machine.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl --fail https://api.example.com/api/v1/health/live
openssl s_client -connect api.example.com:443 -servername api.example.com \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

## 6. Firewall Policy

Default-deny all inbound traffic. Allow:

- TCP 22 only from trusted administrative IP ranges.
- TCP 80 from the internet for redirect and ACME HTTP challenge.
- TCP 443 from the internet for HTTPS.

Block from public access:

- PostgreSQL TCP 5432.
- API TCP 3000; Docker binds it to `127.0.0.1` only.
- Worker ports; workers do not expose HTTP.
- Docker/container internal ports and any provider management port.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from ADMIN_PUBLIC_IP/32 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Also apply equivalent rules at the VPS provider firewall. Verify externally
that ports 3000 and 5432 are closed.

## 7. Secrets And Files

- [ ] Complete [the secrets checklist](./secrets-checklist.md).
- [ ] Store `/opt/singulfit/backend/.env.production` outside Git history.
- [ ] Set ownership to the deploy user and permissions to `0600`.
- [ ] Use unique production secrets; do not reuse sandbox credentials.
- [ ] Set `TRUST_PROXY_HOPS=1` for one trusted reverse proxy.
- [ ] Set real HTTPS provider URLs and exact HTTPS CORS origins.
- [ ] Review cost and exchange-rate variables before launch.

```bash
chmod 600 /opt/singulfit/backend/.env.production
stat -c '%U:%G %a %n' /opt/singulfit/backend/.env.production
```

Validate required names without printing values:

```bash
cd /opt/singulfit/backend
set -a
. ./.env.production
set +a
required='DATABASE_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET JWT_ISSUER JWT_AUDIENCE CORS_ALLOWED_ORIGINS PAGBANK_API_URL PAGBANK_TOKEN PAGBANK_WEBHOOK_SECRET EVOLUTION_BASE_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE_NAME EVOLUTION_WEBHOOK_SECRET OPENAI_API_KEY OPENAI_MODEL_TEXT OPENAI_MODEL_VISION UPLOAD_PATH SMOKE_ADMIN_EMAIL SMOKE_ADMIN_PASSWORD SMOKE_BASE_URL'
missing=0
for name in $required; do
  eval "value=\${$name-}"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$name" PRESENT
  else
    printf '%s=%s\n' "$name" MISSING
    missing=1
  fi
done
test "$missing" -eq 0
```

## 8. Docker Deploy

The Compose migration service runs `npx prisma migrate deploy` and gates API
and worker startup. The host build is an explicit preflight requested by the
release process; the image is then built independently.

```bash
cd /opt/singulfit
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git pull --ff-only
cd backend
npm ci
npm run prisma:generate
npm run build
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm migrate npx prisma migrate deploy
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200
```

Stop when `git status --short` is not empty or the checked-out branch/commit is
not the approved release. Record the pre-deploy and deployed commit hashes.

Confirm the `migrate` service exited successfully and the API and three workers
are running. Do not expose PostgreSQL or add worker port mappings.

## 9. PM2 Deploy Alternative

Use this flow only when the database is reachable from the host through a
private or loopback address.

```bash
cd /opt/singulfit
git pull --ff-only
cd backend
npm ci
npm run prisma:generate
set -a
. ./.env.production
set +a
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js --update-env
pm2 save
pm2 status
```

## 10. Health And Smoke

Docker:

```bash
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend-api npm run smoke:test
curl --fail https://api.example.com/api/v1/health/live
curl --fail https://api.example.com/api/v1/health/ready
```

Use an ADMIN access token only in the operator shell to inspect detailed
health. Do not write the token to shell history or the report:

```bash
curl --fail \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  https://api.example.com/api/v1/admin/health
```

PM2:

```bash
set -a
. ./.env.production
set +a
npm run smoke:test
```

- [ ] Liveness returns HTTP 200 and `status: ok`.
- [ ] Readiness returns HTTP 200 and `status: ok`.
- [ ] All three worker heartbeats are current in admin health.
- [ ] Smoke confirms database, migrations, workers, outbox, login, and health.
- [ ] Logs contain no credentials, tokens, raw passwords, or webhook secrets.

## 11. Backup And Rollback

- [ ] Complete [the backup and restore drill](./backup-restore-drill.md).
- [ ] Create a fresh PostgreSQL dump before every migration.
- [ ] Back up the `singulfit_uploads` volume independently.
- [ ] Copy encrypted backups off the VPS and test retention.
- [ ] Record the deployed Git commit and image tag.

Rollback:

1. Disable public traffic at the reverse proxy.
2. Stop API and workers.
3. If no incompatible migration ran, deploy the previous commit/image.
4. If schema compatibility was broken, restore the pre-deploy database backup
   or apply a reviewed forward migration.
5. Run migration status, readiness, smoke, and log review.
6. Re-enable traffic only after every gate passes.

Prisma does not provide automatic production down migrations. Never mark a
failed migration as applied without verifying the database state.

## 12. Pilot Gate

Complete [the pilot launch checklist](./pilot-launch-checklist.md) and create a
report from [the pilot report template](./pilot-report-template.md). A
readiness failure, failed restore drill, invalid TLS, public database port, or
failed smoke test is an automatic `NO-GO`.

Record the actual command evidence and final decision in the
[VPS deploy execution report](./vps-deploy-execution-report.md).
