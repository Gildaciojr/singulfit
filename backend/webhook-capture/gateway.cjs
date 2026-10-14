'use strict';

// Standalone receiver: no Nest bootstrap, Prisma, providers or commercial state.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');

class InputError extends Error {
  constructor(status) {
    super('REQUEST_REJECTED');
    this.status = status;
  }
}

class Journal {
  constructor(directory, maxBytes = 256 * 1024 * 1024) {
    if (!path.isAbsolute(directory))
      throw new Error('ABSOLUTE_STORAGE_REQUIRED');
    this.directory = directory;
    process.umask(0o077);
    // Provision and durably mount the directory before routing traffic. Do not
    // silently create a new spool on a mistyped path or ephemeral root layer.
    const info = fs.lstatSync(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform !== 'win32' &&
        (info.mode & 0o077 || info.uid !== process.getuid()))
    )
      throw new Error('PRIVATE_OWNED_STORAGE_REQUIRED');
    const marker = path.join(directory, '.singulfit-capture-v1');
    if (!fs.existsSync(marker)) {
      if (fs.readdirSync(directory).length)
        throw new Error('EXCLUSIVE_STORAGE_REQUIRED');
      fs.writeFileSync(marker, 'singulfit-capture-v1\n', {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
    }
    if (
      fs.lstatSync(marker).isSymbolicLink() ||
      fs.readFileSync(marker, 'utf8') !== 'singulfit-capture-v1\n'
    )
      throw new Error('STORAGE_IDENTITY_MISMATCH');
    const filename = path.join(directory, 'capture.sqlite');
    for (const file of [filename, `${filename}-wal`, `${filename}-shm`])
      if (
        fs.existsSync(file) &&
        (fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile())
      )
        throw new Error('UNSAFE_STORAGE_FILE');
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(
        'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;',
      );
      const id = this.db.prepare('PRAGMA application_id').get().application_id;
      if (id !== 0 && id !== 1397113649)
        throw new Error('DATABASE_IDENTITY_MISMATCH');
      if (this.db.prepare('PRAGMA user_version').get().user_version > 1)
        throw new Error('UNSUPPORTED_STORAGE_VERSION');
      if (
        id === 0 &&
        this.db
          .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
          .get().n
      )
        throw new Error('NONEMPTY_FOREIGN_DATABASE');
      this.db.exec(`
        PRAGMA application_id=1397113649;
        PRAGMA user_version=1;
        CREATE TABLE IF NOT EXISTS envelopes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          body BLOB NOT NULL, digest TEXT NOT NULL, entry_count INTEGER NOT NULL,
          received_at INTEGER NOT NULL, delivered_at INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0,
          lease_token TEXT, lease_until INTEGER, last_failure TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_envelopes ON envelopes(delivered_at,id);
        CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL CHECK(paused IN (0,1)));
        INSERT OR IGNORE INTO control VALUES(1,1);
      `);
      const pages = Math.floor(
        maxBytes / this.db.prepare('PRAGMA page_size').get().page_size,
      );
      if (!Number.isSafeInteger(pages) || pages < 32)
        throw new Error('INVALID_STORAGE_BUDGET');
      this.db.exec(`PRAGMA max_page_count=${pages}`);
      if (
        this.db.prepare('PRAGMA synchronous').get().synchronous !== 2 ||
        this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' ||
        this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok'
      )
        throw new Error('STORAGE_INTEGRITY_FAILURE');
      this.db.prepare('SELECT * FROM control WHERE id=1').get();
      fs.chmodSync(filename, 0o600);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  append(body, entryCount, now = Date.now()) {
    // COMMIT (synchronous FULL), not a memory queue, precedes the HTTP ACK.
    return this.transaction(
      () =>
        this.db
          .prepare(
            'INSERT INTO envelopes(body,digest,entry_count,received_at) VALUES(?,?,?,?)',
          )
          .run(
            body,
            createHash('sha256').update(body).digest('hex'),
            entryCount,
            now,
          ).lastInsertRowid,
    );
  }
  pause(value) {
    this.db
      .prepare('UPDATE control SET paused=? WHERE id=1')
      .run(value ? 1 : 0);
  }
  claim(now, leaseMs) {
    return this.transaction(() => {
      if (this.db.prepare('SELECT paused FROM control WHERE id=1').get().paused)
        return null;
      // Strict FIFO: never skip a delayed, leased or operationally blocked head.
      const head = this.db
        .prepare(
          'SELECT * FROM envelopes WHERE delivered_at IS NULL ORDER BY id LIMIT 1',
        )
        .get();
      if (
        !head ||
        head.available_at > now ||
        (head.lease_until && head.lease_until > now)
      )
        return null;
      const token = randomUUID();
      this.db
        .prepare(
          'UPDATE envelopes SET attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?',
        )
        .run(token, now + leaseMs, head.id);
      return { ...head, attempts: head.attempts + 1, lease_token: token };
    });
  }
  settle(head, admitted, failure, now, retryMs) {
    return (
      this.db
        .prepare(
          `UPDATE envelopes SET delivered_at=?,last_failure=?,available_at=?,lease_token=NULL,lease_until=NULL
      WHERE id=? AND lease_token=? AND delivered_at IS NULL`,
        )
        .run(
          admitted ? now : null,
          admitted ? null : failure,
          now + retryMs,
          head.id,
          head.lease_token,
        ).changes === 1
    );
  }
  clean(now, retentionMs) {
    // Pending/leased bodies never expire. Retention starts only at confirmed admission.
    return this.db
      .prepare(
        `DELETE FROM envelopes WHERE id IN (SELECT id FROM envelopes
      WHERE delivered_at IS NOT NULL AND delivered_at<? ORDER BY id LIMIT 100)`,
      )
      .run(now - retentionMs).changes;
  }
  metrics(now = Date.now()) {
    const result = this.db
      .prepare(
        `SELECT count(*) AS retained,
      count(*) FILTER(WHERE delivered_at IS NULL) AS backlog,
      min(received_at) FILTER(WHERE delivered_at IS NULL) AS oldest,
      count(*) FILTER(WHERE delivered_at IS NULL AND last_failure IS NOT NULL) AS failed,
      coalesce(sum(attempts),0) AS attempts,
      count(*) FILTER(WHERE delivered_at IS NULL AND lease_until>?) AS active_leases FROM envelopes`,
      )
      .get(now);
    return {
      retained: result.retained,
      backlog: result.backlog,
      oldestAgeMs:
        result.oldest === null ? 0 : Math.max(0, now - result.oldest),
      failed: result.failed,
      attempts: result.attempts,
      activeLeases: result.active_leases,
      paused: Boolean(
        this.db.prepare('SELECT paused FROM control WHERE id=1').get().paused,
      ),
    };
  }
  close() {
    this.db.close();
  }
}

function validateEnvelope(body, instance) {
  let envelope;
  try {
    envelope = JSON.parse(body.toString('utf8'));
  } catch {
    throw new InputError(400);
  }
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    typeof envelope.instance !== 'string' ||
    envelope.instance.trim() !== instance.trim() ||
    typeof envelope.event !== 'string' ||
    envelope.event.trim().toUpperCase().replace(/[.-]/g, '_') !==
      'MESSAGES_UPSERT'
  )
    throw new InputError(400);
  const entries = Array.isArray(envelope.data)
    ? envelope.data
    : [envelope.data];
  if (
    !entries.length ||
    entries.length > 1000 ||
    entries.some(
      (entry) =>
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.key?.id !== 'string' ||
        !entry.key.id.trim(),
    )
  )
    throw new InputError(400);
  return entries.length;
}

function admittedResponse(value, count) {
  const items = Array.isArray(value) ? value : [value];
  return (
    items.length === count &&
    items.every(
      (item) =>
        item &&
        item.received === true &&
        item.processed === false &&
        item.reason === 'QUEUED',
    )
  );
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const parts = [];
    request.on('data', (part) => {
      length += part.length;
      if (length > limit) {
        parts.length = 0;
        reject(new InputError(413));
      } else parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts)));
    request.on('error', () => reject(new InputError(400)));
    request.on('aborted', () => reject(new InputError(400)));
  });
}

function createGateway(
  config,
  journal = new Journal(config.directory, config.maxBytes),
  transport = fetch,
) {
  let target;
  try {
    target = new URL(config.target);
  } catch {
    journal.close();
    throw new Error('INVALID_TARGET');
  }
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/api/v1/webhooks/evolution'
  ) {
    journal.close();
    throw new Error('INVALID_TARGET');
  }
  if (!config.secret || !config.instance) {
    journal.close();
    throw new Error('MISSING_AUTH_CONFIGURATION');
  }
  const secretDigest = createHash('sha256').update(config.secret).digest();
  const timeoutMs = config.timeoutMs ?? 15000;
  const leaseMs = timeoutMs + 30000;
  const retryBaseMs = config.retryBaseMs ?? 1000;
  const retentionMs = config.retentionMs ?? 7 * 24 * 3600 * 1000;
  let running = false;
  let timer;
  let stopping = false;
  let active;
  let closing;
  let intakeFailures = 0;
  let storageFailures = 0;

  async function tick() {
    if (running || stopping) return;
    running = true;
    try {
      journal.clean(Date.now(), retentionMs);
      const head = journal.claim(Date.now(), leaseMs);
      if (!head) return;
      let admitted = false;
      let failure = 'DOWNSTREAM_UNAVAILABLE';
      try {
        if (
          createHash('sha256').update(head.body).digest('hex') !== head.digest
        )
          throw new Error('CORRUPT_ENVELOPE');
        const response = await transport(target, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-evolution-webhook-secret': config.secret,
          },
          body: Buffer.from(head.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // HTTP 2xx alone could be a proxy page, ignored event, or partial batch.
        // Bound the reply as well as the request. Never log its content.
        const reader = response.body?.getReader();
        let bytes = 0;
        const chunks = [];
        if (reader) {
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.length;
              if (bytes > 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
              chunks.push(Buffer.from(part.value));
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        }
        admitted =
          response.status === 200 &&
          admittedResponse(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
            head.entry_count,
          );
        failure = 'ADMISSION_NOT_CONFIRMED';
      } catch {
        /* Generic durable failure code; no tokens, bodies, IDs or network errors in logs. */
      }
      const retryMs = Math.min(
        60000,
        retryBaseMs * 2 ** Math.min(head.attempts - 1, 10),
      );
      journal.settle(head, admitted, failure, Date.now(), retryMs);
    } catch {
      storageFailures += 1; /* Leave claimed head recoverable after its lease; do not skip. */
    } finally {
      running = false;
    }
  }
  function pump() {
    if (!active)
      active = tick().finally(() => {
        active = undefined;
      });
    return active;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method === 'GET' && request.url === '/health/live')
        return reply(200, { live: true });
      const supplied = request.headers['x-evolution-webhook-secret'];
      if (
        typeof supplied !== 'string' ||
        !timingSafeEqual(
          secretDigest,
          createHash('sha256').update(supplied.trim()).digest(),
        )
      )
        throw new InputError(401);
      if (request.method === 'GET' && request.url === '/metrics')
        return reply(200, {
          ...journal.metrics(),
          intakeFailures,
          storageFailures,
        });
      if (
        request.method !== 'POST' ||
        request.url !== '/api/v1/webhooks/evolution'
      )
        throw new InputError(404);
      if (stopping) throw new InputError(503);
      const body = await readBody(
        request,
        config.bodyLimit ?? 10 * 1024 * 1024,
      );
      const entryCount = validateEnvelope(body, config.instance);
      journal.append(body, entryCount);
      return reply(200, {
        received: true,
        processed: false,
        reason: 'CAPTURED',
      });
    } catch (error) {
      intakeFailures += 1;
      if (!(error instanceof InputError)) storageFailures += 1;
      request.resume();
      if (!response.headersSent)
        reply(error instanceof InputError ? error.status : 503, {
          received: false,
          reason: 'CAPTURE_NOT_CONFIRMED',
        });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return {
    journal,
    server,
    tick: pump,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port ?? 0, config.bind ?? '127.0.0.1', resolve);
      });
      timer = setInterval(() => {
        void pump();
      }, config.pollMs ?? 1000);
      timer.unref();
      return server.address().port;
    },
    close() {
      if (!closing)
        closing = (async () => {
          stopping = true;
          clearInterval(timer);
          await new Promise((resolve) => server.close(resolve));
          await active;
          journal.close();
        })();
      return closing;
    },
  };
}

function integer(environment, name, fallback, min, max) {
  const raw = environment[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error('INVALID_INTEGER_CONFIGURATION');
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error('INVALID_INTEGER_CONFIGURATION');
  return result;
}

async function main() {
  const directory = process.env.CAPTURE_DIRECTORY;
  if (!directory) throw new Error('MISSING_STORAGE');
  const command = process.argv[2] ?? 'serve';
  if (['pause', 'resume', 'status'].includes(command)) {
    if (!fs.existsSync(path.join(directory, '.singulfit-capture-v1')))
      throw new Error('STORAGE_NOT_INITIALIZED');
    const journal = new Journal(
      directory,
      integer(
        process.env,
        'CAPTURE_MAX_BYTES',
        256 * 1024 * 1024,
        1024 * 1024,
        4 * 1024 * 1024 * 1024,
      ),
    );
    try {
      if (command !== 'status') journal.pause(command === 'pause');
      console.log(JSON.stringify(journal.metrics()));
    } finally {
      journal.close();
    }
    return;
  }
  if (command !== 'serve') throw new Error('INVALID_COMMAND');
  const secret = fs
    .readFileSync(process.env.EVOLUTION_WEBHOOK_SECRET_FILE, 'utf8')
    .trim();
  const gateway = createGateway({
    directory,
    secret,
    target: process.env.CAPTURE_TARGET,
    instance: process.env.EVOLUTION_INSTANCE_NAME,
    port: integer(process.env, 'CAPTURE_PORT', 3180, 0, 65535),
    bind: process.env.CAPTURE_BIND ?? '127.0.0.1',
    timeoutMs: integer(process.env, 'CAPTURE_TIMEOUT_MS', 15000, 100, 60000),
    bodyLimit: integer(
      process.env,
      'CAPTURE_BODY_LIMIT',
      10 * 1024 * 1024,
      1024,
      16 * 1024 * 1024,
    ),
    maxBytes: integer(
      process.env,
      'CAPTURE_MAX_BYTES',
      256 * 1024 * 1024,
      1024 * 1024,
      4 * 1024 * 1024 * 1024,
    ),
  });
  const port = await gateway.start();
  console.log(JSON.stringify({ event: 'CAPTURE_LISTENING', port }));
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void gateway.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
}

module.exports = { Journal, createGateway, validateEnvelope, admittedResponse };
if (require.main === module)
  main().catch(() => {
    console.error('CAPTURE_START_FAILED');
    process.exitCode = 1;
  });
