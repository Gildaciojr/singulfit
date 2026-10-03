import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V3,
} from './workout-planning-v2.prompt.definition';

describe('workout planning prompt rollout', () => {
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

  it('selects version 4 without mutating the historical definition', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT.version).toBe(4);
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'strategy.authorizedEquipment',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V3.version).toBe(3);
  });

  it('deactivates only the prior active definition and preserves history', () => {
    expect(migration).toContain(
      'WHERE "name" = \'workout_planning_v2\'\n  AND "isActive" = true;',
    );
    expect(migration).toContain('ON CONFLICT ("name", "version") DO UPDATE');
    expect(migration).not.toMatch(/\bDELETE\b/i);
  });
});
