'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { Journal, createGateway, admittedResponse } = require('./gateway.cjs');
const secret = 'synthetic-capture-secret-for-local-tests-only';
const route = '/api/v1/webhooks/evolution';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resources = new WeakMap();
function lifecycle(t) {
  if (!resources.has(t)) {
    const state = { close: [], directories: [] };
    resources.set(t, state);
    t.after(async () => {
      for (const close of state.close.reverse()) await close();
      for (const dir of state.directories.reverse()) {
        const resolved = path.resolve(dir);
        assert.ok(
          resolved.startsWith(
            path.join(path.resolve(os.tmpdir()), 'singulfit-capture-test-'),
          ),
        );
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    });
  }
  return resources.get(t);
}
function envelope(ids = ['local-1'], padding = '') {
  return Buffer.from(
    JSON.stringify({
      event: 'messages.upsert',
      instance: 'isolated-capture',
      data: ids.map((id) => ({
        key: { id, remoteJid: 'synthetic@lid' },
        message: { conversation: 'synthetic' },
      })),
      padding,
    }),
  );
}
function response(count) {
  const result = Array.from({ length: count }, () => ({
    received: true,
    processed: false,
    reason: 'QUEUED',
  }));
  return count === 1 ? result[0] : result;
}
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'singulfit-capture-test-'));
  lifecycle(t).directories.push(dir);
  return dir;
}
async function downstream(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  lifecycle(t).close.push(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}${route}`;
}
async function gateway(t, options = {}, journal) {
  const target =
    options.target ??
    (await downstream(t, (_req, res) => {
      res.writeHead(503);
      res.end();
    }));
  const instance = createGateway(
    {
      directory: options.directory ?? directory(t),
      secret,
      instance: 'isolated-capture',
      target,
      pollMs: 3600000,
      retryBaseMs: 1,
      timeoutMs: 100,
      ...options,
    },
    journal,
  );
  const port = await instance.start();
  lifecycle(t).close.push(() => instance.close());
  return { ...instance, url: `http://127.0.0.1:${port}${route}` };
}
async function post(url, body, token = secret) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'x-evolution-webhook-secret': token,
      'content-type': 'application/json',
    },
    body,
  });
}
async function until(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(20);
  }
  throw new Error('LOCAL_TEST_TIMEOUT');
}

test('HTTP ACK follows the real FULL-sync commit and retains the exact batch bytes', async (t) => {
  const g = await gateway(t);
  const body = Buffer.concat([
    Buffer.from(' \n'),
    envelope(['first', 'second']),
    Buffer.from('\r\n'),
  ]);
  const reply = await post(g.url, body);
  assert.equal(reply.status, 200);
  const observer = new Journal(g.journal.directory);
  assert.deepEqual(
    Buffer.from(observer.db.prepare('SELECT body FROM envelopes').get().body),
    body,
  );
  observer.close();
  assert.deepEqual(
    Buffer.from(g.journal.db.prepare('SELECT body FROM envelopes').get().body),
    body,
  );
  assert.equal(
    g.journal.db.prepare('SELECT entry_count FROM envelopes').get().entry_count,
    2,
  );
  assert.equal(g.journal.db.prepare('PRAGMA synchronous').get().synchronous, 2);
  assert.equal(g.journal.metrics().paused, true);
});

test('invalid authentication, instance, envelope and excess body never receive a capture ACK', async (t) => {
  const g = await gateway(t, { bodyLimit: 4096 });
  assert.equal((await post(g.url, envelope(), 'wrong-secret')).status, 401);
  assert.equal((await post(g.url, Buffer.from('{broken'))).status, 400);
  assert.equal(
    (
      await post(
        g.url,
        Buffer.from(
          '{"instance":"another","event":"messages.upsert","data":[]}',
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(g.url, envelope(['huge'], 'x'.repeat(8192)))).status,
    413,
  );
  assert.equal(g.journal.metrics().backlog, 0);
});

test('actual SQLite FULL fails the HTTP admission without committing a phantom envelope', async (t) => {
  const g = await gateway(t, { maxBytes: 128 * 1024 });
  assert.equal(
    (await post(g.url, envelope(['disk-full'], 'x'.repeat(200 * 1024)))).status,
    503,
  );
  assert.equal(g.journal.metrics().backlog, 0);
});

test('a commit error cannot become HTTP success and rolls back the inserted row', async (t) => {
  const journal = new Journal(directory(t));
  const exec = journal.db.exec.bind(journal.db);
  journal.db.exec = (sql) => {
    if (sql === 'COMMIT') throw new Error('synthetic fsync failure');
    return exec(sql);
  };
  const g = await gateway(t, {}, journal);
  assert.equal((await post(g.url, envelope())).status, 503);
  assert.equal(journal.metrics().backlog, 0);
});

test('an unavailable API never discards the head or lets a later batch overtake', async (t) => {
  const order = [];
  let available = false;
  const target = await downstream(t, async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const data = JSON.parse(Buffer.concat(parts));
    order.push(data.data[0].key.id);
    res.writeHead(available ? 200 : 503);
    res.end(JSON.stringify(response(data.data.length)));
  });
  const g = await gateway(t, { target });
  await post(g.url, envelope(['A']));
  await post(g.url, envelope(['B', 'C']));
  g.journal.pause(false);
  await g.tick();
  await wait(5);
  await g.tick();
  assert.deepEqual(order, ['A', 'A']);
  assert.equal(g.journal.metrics().backlog, 2);
  available = true;
  await wait(5);
  await g.tick();
  await g.tick();
  assert.deepEqual(order, ['A', 'A', 'A', 'B']);
  assert.equal(g.journal.metrics().backlog, 0);
});

test('HTTP 200 without a complete QUEUED acknowledgement never marks delivery', async (t) => {
  let reply = {};
  const target = await downstream(t, (_req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify(reply));
  });
  const g = await gateway(t, { target });
  await post(g.url, envelope(['one', 'two']));
  g.journal.pause(false);
  for (reply of [
    {},
    { received: true, reason: 'INSTANCE_MISMATCH' },
    [response(1)],
    [{ received: true, processed: true, reason: 'QUEUED' }],
  ]) {
    await wait(20);
    await g.tick();
    assert.equal(g.journal.metrics().backlog, 1);
  }
  reply = response(2);
  await wait(30);
  await g.tick();
  assert.equal(g.journal.metrics().backlog, 0);
});

test('timeout after destination admission replays the same IDs and deduplicates at destination', async (t) => {
  const admitted = new Set();
  let requests = 0;
  const target = await downstream(t, async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const data = JSON.parse(Buffer.concat(parts));
    for (const entry of data.data) admitted.add(entry.key.id);
    requests += 1;
    if (requests === 1) return; // ACK lost; fetch must time out.
    res.writeHead(200);
    res.end(JSON.stringify(response(data.data.length)));
  });
  const g = await gateway(t, { target });
  await post(g.url, envelope(['same-1', 'same-2']));
  g.journal.pause(false);
  await g.tick();
  assert.equal(g.journal.metrics().backlog, 1);
  await wait(5);
  await g.tick();
  assert.equal(requests, 2);
  assert.equal(admitted.size, 2);
  assert.equal(g.journal.metrics().backlog, 0);
});

test('retry pressure beyond a legacy attempt budget retains durable data for recovery', async (t) => {
  const g = await gateway(t);
  await post(g.url, envelope());
  g.journal.pause(false);
  g.journal.db.prepare('UPDATE envelopes SET attempts=1000').run();
  await g.tick();
  assert.equal(g.journal.metrics().attempts, 1001);
  assert.equal(g.journal.metrics().backlog, 1);
  assert.equal(g.journal.metrics().failed, 1);
});

test('persistent leases prevent concurrent dispatch and fence stale acknowledgements', (t) => {
  const dir = directory(t);
  const a = new Journal(dir);
  const b = new Journal(dir);
  try {
    a.append(envelope(), 1, 1);
    a.pause(false);
    const first = a.claim(10, 100);
    assert.equal(b.claim(20, 100), null);
    const second = b.claim(111, 100);
    assert.ok(second);
    assert.equal(a.settle(first, true, null, 112, 1), false);
    assert.equal(b.settle(second, true, null, 113, 1), true);
  } finally {
    a.close();
    b.close();
  }
});

test('only confirmed deliveries expire; pending bodies and FIFO survive retention', (t) => {
  const j = new Journal(directory(t));
  try {
    j.append(envelope(['done']), 1, 1);
    j.append(envelope(['pending']), 1, 2);
    j.pause(false);
    const head = j.claim(3, 100);
    j.settle(head, true, null, 4, 0);
    assert.equal(j.clean(20, 10), 1);
    assert.equal(j.metrics(20).backlog, 1);
    assert.equal(
      JSON.parse(Buffer.from(j.claim(21, 100).body)).data[0].key.id,
      'pending',
    );
  } finally {
    j.close();
  }
});

test('metrics require authentication and never expose payloads, identities or secrets', async (t) => {
  const g = await gateway(t);
  await post(g.url, envelope());
  const url = g.url.replace(route, '/metrics');
  assert.equal((await fetch(url)).status, 401);
  const reply = await fetch(url, {
    headers: { 'x-evolution-webhook-secret': secret },
  });
  const text = await reply.text();
  assert.equal(reply.status, 200);
  assert.equal(JSON.parse(text).backlog, 1);
  for (const forbidden of [secret, 'synthetic@lid', 'local-1', 'conversation'])
    assert.equal(text.includes(forbidden), false);
});

test('foreign storage directories and invalid downstream configuration fail closed', (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'other-project.txt'), 'untouched');
  assert.throws(() => new Journal(dir), /EXCLUSIVE_STORAGE_REQUIRED/);
  assert.equal(
    fs.readFileSync(path.join(dir, 'other-project.txt'), 'utf8'),
    'untouched',
  );
  for (const target of [
    'https://secret:password@example.invalid' + route,
    'http://127.0.0.1/wrong',
    'not-a-url',
  ])
    assert.throws(
      () =>
        createGateway({
          directory: directory(t),
          target,
          secret,
          instance: 'isolated-capture',
        }),
      /INVALID_TARGET/,
    );
  assert.equal(
    admittedResponse({ received: true, processed: false, reason: 'QUEUED' }, 2),
    false,
  );
});

test('SIGKILL after a capture ACK survives receiver restart and original-ID replay', async (t) => {
  const dir = directory(t);
  const secretPath = path.join(dir, 'test-secret');
  // Secret is outside the journal directory; the journal refuses unrelated files.
  const data = path.join(dir, 'journal');
  fs.mkdirSync(data, { mode: 0o700 });
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  let delivered = 0;
  const seen = [];
  const target = await downstream(t, async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    seen.push(Buffer.concat(chunks));
    delivered += 1;
    res.writeHead(200);
    res.end(JSON.stringify(response(2)));
  });
  async function child() {
    const process = fork(path.join(__dirname, 'gateway.cjs'), [], {
      env: {
        ...global.process.env,
        CAPTURE_DIRECTORY: data,
        EVOLUTION_WEBHOOK_SECRET_FILE: secretPath,
        EVOLUTION_INSTANCE_NAME: 'isolated-capture',
        CAPTURE_TARGET: target,
        CAPTURE_PORT: '0',
        CAPTURE_TIMEOUT_MS: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let logs = '';
    process.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    process.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    lifecycle(t).close.push(async () => {
      if (process.exitCode === null && process.signalCode === null) {
        process.kill('SIGKILL');
        await new Promise((r) => process.once('exit', r));
      }
    });
    await until(() => {
      if (process.exitCode !== null) throw new Error('CHILD_START_FAILED');
      return logs.includes('CAPTURE_LISTENING');
    });
    const line = logs
      .split('\n')
      .find((entry) => entry.includes('CAPTURE_LISTENING'));
    return {
      process,
      logs: () => logs,
      url: `http://127.0.0.1:${JSON.parse(line).port}${route}`,
    };
  }
  const first = await child();
  const body = envelope(['persisted-first', 'persisted-second']);
  assert.equal((await post(first.url, body)).status, 200);
  first.process.kill('SIGKILL');
  await new Promise((resolve) => first.process.once('exit', resolve));
  assert.equal(delivered, 0);
  const observer = new Journal(data);
  assert.equal(observer.metrics().backlog, 1);
  observer.close();
  const second = await child();
  const control = new Journal(data);
  control.pause(false);
  control.close();
  await until(() => delivered === 1);
  assert.deepEqual(seen[0], body);
  assert.equal((await post(second.url, body)).status, 200); // emitter restarts/replays original IDs.
  await until(() => delivered === 2);
  const keys = new Set(
    seen.flatMap((raw) => JSON.parse(raw).data.map((entry) => entry.key.id)),
  );
  assert.equal(keys.size, 2);
  assert.equal(first.logs().includes(secret), false);
  assert.equal(second.logs().includes(secret), false);
});

test('SIGKILL inside an uncommitted SQLite transaction preserves only acknowledged rows', async (t) => {
  const dir = directory(t);
  const data = path.join(dir, 'journal');
  fs.mkdirSync(data, { mode: 0o700 });
  const original = new Journal(data);
  original.append(envelope(['committed']), 1);
  original.close();
  const fixture = path.join(dir, 'uncommitted.cjs');
  fs.writeFileSync(
    fixture,
    `const {Journal}=require(process.env.CAPTURE_MODULE);
    const j=new Journal(process.env.CAPTURE_TEST_DIRECTORY);j.db.exec('BEGIN IMMEDIATE');
    j.db.prepare('INSERT INTO envelopes(body,digest,entry_count,received_at) VALUES(?,?,?,?)').run(Buffer.from('{}'),'not-committed',1,1);
    process.send('UNCOMMITTED');setInterval(()=>{},1000);`,
  );
  const child = fork(fixture, [], {
    env: {
      ...process.env,
      CAPTURE_MODULE: path.join(__dirname, 'gateway.cjs'),
      CAPTURE_TEST_DIRECTORY: data,
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  lifecycle(t).close.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
    }
  });
  await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
  });
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  const recovered = new Journal(data);
  try {
    assert.equal(recovered.metrics().backlog, 1);
    assert.equal(
      JSON.parse(
        Buffer.from(
          recovered.db.prepare('SELECT body FROM envelopes').get().body,
        ),
      ).data[0].key.id,
      'committed',
    );
  } finally {
    recovered.close();
  }
});

test('two dispatchers share a durable head lease and cannot send the next batch early', async (t) => {
  let calls = 0;
  let release;
  const target = await downstream(t, async (_req, res) => {
    calls += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    res.writeHead(200);
    res.end(JSON.stringify(response(1)));
  });
  const dir = directory(t);
  const a = await gateway(t, { directory: dir, target });
  const b = await gateway(t, { directory: dir, target });
  await post(a.url, envelope(['head']));
  await post(b.url, envelope(['later']));
  a.journal.pause(false);
  const first = a.tick();
  await until(() => calls === 1);
  await b.tick();
  assert.equal(calls, 1);
  assert.equal(b.journal.metrics().backlog, 2);
  release();
  await first;
  assert.equal(b.journal.metrics().backlog, 1);
});

test('idle retention cleans confirmed bodies even when forwarding is paused', async (t) => {
  const g = await gateway(t, { retentionMs: 10 });
  g.journal.append(envelope(), 1, 1);
  g.journal.pause(false);
  const claimed = g.journal.claim(2, 10);
  g.journal.settle(claimed, true, null, 3, 0);
  g.journal.pause(true);
  await g.tick();
  assert.equal(g.journal.metrics().retained, 0);
});

test('shutdown waits for the actual in-flight dispatch despite concurrent polling', async (t) => {
  let release;
  let received = false;
  const target = await downstream(t, async (_req, res) => {
    received = true;
    await new Promise((resolve) => {
      release = resolve;
    });
    res.writeHead(200);
    res.end(JSON.stringify(response(1)));
  });
  const g = await gateway(t, { target, timeoutMs: 1000 });
  await post(g.url, envelope());
  g.journal.pause(false);
  const first = g.tick();
  await until(() => received);
  const concurrent = g.tick();
  assert.equal(concurrent, first);
  let closed = false;
  const closing = g.close().then(() => {
    closed = true;
  });
  await wait(20);
  assert.equal(closed, false);
  release();
  await closing;
  const observer = new Journal(g.journal.directory);
  try {
    assert.equal(observer.metrics().backlog, 0);
  } finally {
    observer.close();
  }
});
