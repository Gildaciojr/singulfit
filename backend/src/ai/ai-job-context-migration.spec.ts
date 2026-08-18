import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OLD_MIGRATION_SHA256 =
  'c0c0760ebd26e0dc749cc0d57ff3252302a71e17edeae49de625dd63fbc09d57';
const oldMigration = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260611042000_ai_job_context_hardening',
  'migration.sql',
);
const newMigration = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260818123000_allow_standalone_text_ai_jobs',
  'migration.sql',
);
const expectedCheck = `
  CHECK (
    (
      "type"::text IN ('DIET', 'WORKOUT', 'PROGRESS')
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
    )
    OR (
      "type"::text = 'TEXT'
      AND (
        (
          "conversationId" IS NULL
          AND "messageId" IS NULL
        )
        OR (
          "conversationId" IS NOT NULL
          AND "messageId" IS NOT NULL
        )
      )
    )
    OR (
      "type"::text NOT IN ('DIET', 'WORKOUT', 'PROGRESS', 'TEXT')
      AND "conversationId" IS NOT NULL
      AND "messageId" IS NOT NULL
    )
  ) NOT VALID;
`;

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function accepts(
  type: string,
  conversationId: string | null,
  messageId: string | null,
): boolean {
  const standalone = ['DIET', 'WORKOUT', 'PROGRESS'].includes(type);
  if (standalone) return conversationId === null && messageId === null;
  if (type === 'TEXT') {
    return (
      (conversationId === null && messageId === null) ||
      (conversationId !== null && messageId !== null)
    );
  }
  return conversationId !== null && messageId !== null;
}

describe('standalone TEXT AI job migration contract', () => {
  it('installs and validates v2 before removing and renaming the old constraint', () => {
    const sql = readFileSync(newMigration, 'utf8');
    const add = sql.indexOf('ADD CONSTRAINT "ai_jobs_context_check_v2"');
    const validate = sql.indexOf(
      'VALIDATE CONSTRAINT "ai_jobs_context_check_v2"',
    );
    const drop = sql.indexOf('DROP CONSTRAINT "ai_jobs_context_check"');
    const rename = sql.indexOf('RENAME CONSTRAINT "ai_jobs_context_check_v2"');

    expect(add).toBeGreaterThanOrEqual(0);
    expect(sql).toContain(') NOT VALID;');
    expect(validate).toBeGreaterThan(add);
    expect(drop).toBeGreaterThan(validate);
    expect(rename).toBeGreaterThan(drop);
    expect(normalizeSql(sql)).toContain(normalizeSql(expectedCheck));
  });

  it.each([
    ['A TEXT standalone', 'TEXT', null, null, true],
    ['B TEXT contextual', 'TEXT', 'conversation', 'message', true],
    ['C TEXT without message', 'TEXT', 'conversation', null, false],
    ['D TEXT without conversation', 'TEXT', null, 'message', false],
    ['E DIET standalone', 'DIET', null, null, true],
    ['F WORKOUT standalone', 'WORKOUT', null, null, true],
    ['G PROGRESS standalone', 'PROGRESS', null, null, true],
    ['H DIET contextual', 'DIET', 'conversation', 'message', false],
    ['H WORKOUT contextual', 'WORKOUT', 'conversation', 'message', false],
    ['H PROGRESS contextual', 'PROGRESS', 'conversation', 'message', false],
    ['I IMAGE contextual', 'IMAGE', 'conversation', 'message', true],
    ['J IMAGE standalone', 'IMAGE', null, null, false],
    [
      'K CONVERSATION_REALIZATION contextual',
      'CONVERSATION_REALIZATION',
      'conversation',
      'message',
      true,
    ],
    [
      'L CONVERSATION_REALIZATION standalone',
      'CONVERSATION_REALIZATION',
      null,
      null,
      false,
    ],
  ] as const)(
    '%s => %s',
    (_case, type, conversationId, messageId, expected) => {
      expect(accepts(type, conversationId, messageId)).toBe(expected);
    },
  );

  it('keeps the previously applied context-hardening migration byte-identical', () => {
    const digest = createHash('sha256')
      .update(readFileSync(oldMigration))
      .digest('hex');

    expect(digest).toBe(OLD_MIGRATION_SHA256);
  });
});
