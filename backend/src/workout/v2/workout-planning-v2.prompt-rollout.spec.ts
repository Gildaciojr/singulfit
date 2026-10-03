import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V3,
  WORKOUT_PLANNING_V2_PROMPT_V4,
  WORKOUT_PLANNING_V2_PROMPT_V5,
} from './workout-planning-v2.prompt.definition';

describe('workout planning prompt rollout', () => {
  it('uses the requested duration generically in the v5 extension', () => {
    const extension = WORKOUT_PLANNING_V2_PROMPT_V5.instructions.slice(
      WORKOUT_PLANNING_V2_PROMPT_V4.instructions.length,
    );
    expect(extension).toContain('strategy.sessionDurationMinutes');
    expect(extension).not.toMatch(/\b60\s*(?:min|minutos)\b/iu);
  });
  const normalizeEol = (text: string): string => text.replace(/\r\n?/gu, '\n');
  const migration = normalizeEol(
    readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20260903120000_workout_planning_v3_prompt/migration.sql',
      ),
      'utf8',
    ),
  );

  it('preserves historical version 3 against its immutable migration', () => {
    const persistedPrompt = migration.match(
      /\$prompt\$([\s\S]*?)\$prompt\$/,
    )?.[1];
    const persistedSchema = migration.match(
      /\$schema\$([\s\S]*?)\$schema\$/,
    )?.[1];

    expect(WORKOUT_PLANNING_V2_PROMPT_V3.version).toBe(3);
    expect(persistedPrompt).toBe(
      normalizeEol(WORKOUT_PLANNING_V2_PROMPT_V3.instructions),
    );
    expect(JSON.parse(persistedSchema ?? '')).toEqual(
      WORKOUT_PLANNING_V2_PROMPT_V3.schema,
    );
    expect(migration).toContain("'workout_planning_v2',\n  3,");
    expect(migration).toContain("'WORKOUT_PLANNING_V2',\n  'TEXT',");
  });

  it('selects version 6 without mutating the historical definitions', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT.version).toBe(6);
    expect(WORKOUT_PLANNING_V2_PROMPT_V4.version).toBe(4);
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V4.instructions)
        .digest('hex'),
    ).toBe('343ced01b4456dfd5dd7213d0105158fa3aa7088eee9dba53a2f1d406817f32f');
    expect(
      WORKOUT_PLANNING_V2_PROMPT.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V4.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'strategy.authorizedEquipment',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V3.version).toBe(3);
  });

  it.each([
    [
      WORKOUT_PLANNING_V2_PROMPT_V3,
      'd58da9cd8d85dd4e1cac331e15c933d09a72d1bed4c81cac07ff74b0199adb24',
    ],
    [
      WORKOUT_PLANNING_V2_PROMPT_V4,
      '343ced01b4456dfd5dd7213d0105158fa3aa7088eee9dba53a2f1d406817f32f',
    ],
    [
      WORKOUT_PLANNING_V2_PROMPT_V5,
      '6d4057c8830d24e9ec71844e740b6bb66ddd2c4b8391b0f7de4f0b0162cefc31',
    ],
  ] as const)('preserves historical prompt v$version', (prompt, hash) => {
    expect(createHash('sha256').update(prompt.instructions).digest('hex')).toBe(
      hash,
    );
  });

  it('extends v5 with generic executable duration and exact TIMED arithmetic', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT_V5.version).toBe(5);
    expect(
      WORKOUT_PLANNING_V2_PROMPT.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V5.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V5.schema,
    );
    const extension = WORKOUT_PLANNING_V2_PROMPT.instructions.slice(
      WORKOUT_PLANNING_V2_PROMPT_V5.instructions.length,
    );
    expect(extension).toContain(
      'durationSeconds = workSeconds * rounds + recoverySeconds * (rounds - 1)',
    );
    expect(extension).toContain(
      'Não inclua recuperação obrigatória depois da última rodada',
    );
    expect(extension).toContain(
      'não invente workSeconds, recoverySeconds ou rounds artificiais',
    );
    expect(extension).toContain('rounds = 1');
    expect(extension).toContain('ENDURANCE');
    expect(extension).toContain('MOBILITY');
    expect(extension).toContain('strategy.sessionDurationMinutes');
    expect(extension).toContain('descanso ENTRE séries');
    expect(extension).toContain('não adicione descanso depois da última série');
    expect(extension).not.toMatch(/\b60\b/u);
  });

  it('deactivates only the prior active definition and preserves history', () => {
    expect(migration).toContain(
      'WHERE "name" = \'workout_planning_v2\'\n  AND "isActive" = true;',
    );
    expect(migration).toContain('ON CONFLICT ("name", "version") DO UPDATE');
    expect(migration).not.toMatch(/\bDELETE\b/i);
  });
});
