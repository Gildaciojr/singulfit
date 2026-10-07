import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import {
  PromptService,
  type CreatePromptVersionInput,
} from '../../ai/prompt.service';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V3,
  WORKOUT_PLANNING_V2_PROMPT_V4,
  WORKOUT_PLANNING_V2_PROMPT_V5,
  WORKOUT_PLANNING_V2_PROMPT_V6,
  WORKOUT_PLANNING_V2_PROMPT_V7,
  WORKOUT_PLANNING_V2_PROMPT_V8,
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V10,
  WORKOUT_PLANNING_V2_PROMPT_V11,
  WORKOUT_PLANNING_V2_PROMPT_V12,
} from './workout-planning-v2.prompt.definition';

describe('workout planning prompt rollout', () => {
  it('distinguishes adjustable recommendations from fabricated facts in effective V12 instructions', () => {
    const text = WORKOUT_PLANNING_V2_PROMPT_V12.instructions;
    expect(text).toContain('STRENGTH exige prescription.execution');
    expect(text).toContain('ADJUSTABLE_START');
    expect(text).toContain(
      'não apresente cargas, pace ou potência como fatos confirmados sem evidência',
    );
    expect(text).not.toContain('não invente cargas exatas, pace ou potência');
    expect(text).not.toContain('sem inventar cargas ou transformar');
    expect(text).not.toContain('sem inventar carga absoluta');
  });
  it('pins the complete immutable V10 definition and instructions to production 17836b0', () => {
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V10.instructions)
        .digest('hex'),
    ).toBe('58c1313cdc905e584f807b79e1aca302340ee21518e55c4141efeb61c20390dc');
    expect(
      createHash('sha256')
        .update(JSON.stringify(WORKOUT_PLANNING_V2_PROMPT_V10))
        .digest('hex'),
    ).toBe('05c0110b76e17196e95e1354b7d8e21e321f811301d6fe9712e913a49dad8833');
    expect(WORKOUT_PLANNING_V2_PROMPT_V10.instructions).not.toContain(
      'QUALIDADE GYM E CALENDÁRIO:',
    );
  });
  it('preserves immutable V11 while selecting the typed V12 capability contract', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT).toBe(WORKOUT_PLANNING_V2_PROMPT_V12);
    expect(WORKOUT_PLANNING_V2_PROMPT_V11).toMatchObject({
      name: 'workout_planning_v2_v11',
      version: 11,
      capability: WORKOUT_PLANNING_V2_PROMPT_V10.capability,
      model: WORKOUT_PLANNING_V2_PROMPT_V10.model,
    });
    expect(WORKOUT_PLANNING_V2_PROMPT_V11.schema.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V10.schema.schema,
    );
    expect(Object.isFrozen(WORKOUT_PLANNING_V2_PROMPT_V11)).toBe(true);
    expect(Object.isFrozen(WORKOUT_PLANNING_V2_PROMPT_V11.schema)).toBe(true);
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V11.instructions)
        .digest('hex'),
    ).toBe('9c8fab357248f4a10133736151f83b6bbe9e2b5219be3bf421fa96c0b795d468');
    expect(WORKOUT_PLANNING_V2_PROMPT_V11.instructions).toContain(
      'QUALIDADE GYM E CALENDÁRIO:',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V11.instructions).toContain(
      'APRESENTAÇÃO EXECUTÁVEL:',
    );
  });
  it('uses the real prompt lifecycle to lazily activate V12 while preserving active V11/V10 and historical V9/V8', async () => {
    const rows: {
      name: string;
      version: number;
      prompt: string;
      isActive: boolean;
    }[] = [
      {
        name: WORKOUT_PLANNING_V2_PROMPT_V11.name,
        version: 11,
        prompt: WORKOUT_PLANNING_V2_PROMPT_V11.instructions,
        isActive: true,
      },
      {
        name: WORKOUT_PLANNING_V2_PROMPT_V10.name,
        version: 10,
        prompt: WORKOUT_PLANNING_V2_PROMPT_V10.instructions,
        isActive: true,
      },
      {
        name: WORKOUT_PLANNING_V2_PROMPT_V8.name,
        version: 8,
        prompt: WORKOUT_PLANNING_V2_PROMPT_V8.instructions,
        isActive: true,
      },
      {
        name: WORKOUT_PLANNING_V2_PROMPT_V9.name,
        version: 9,
        prompt: WORKOUT_PLANNING_V2_PROMPT_V9.instructions,
        isActive: true,
      },
    ];
    const promptVersion = {
      findFirst: jest.fn((query: { where: { name: string } }) =>
        Promise.resolve(
          rows.find((row) => row.name === query.where.name && row.isActive) ??
            null,
        ),
      ),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn((query: { where: { name: string } }) => {
        rows
          .filter((row) => row.name === query.where.name)
          .forEach((row) => {
            row.isActive = false;
          });
        return Promise.resolve({ count: 0 });
      }),
      create: jest.fn((query: { data: CreatePromptVersionInput }) => {
        const row = { ...query.data, isActive: query.data.isActive ?? false };
        rows.push(row);
        return Promise.resolve(row);
      }),
    };
    const prisma = {
      promptVersion,
      $transaction: (
        execute: (transaction: {
          promptVersion: typeof promptVersion;
        }) => Promise<unknown>,
      ) => Promise.resolve(execute({ promptVersion })),
    };
    const prompts = new PromptService(prisma as never);
    await new WorkoutPromptActivationService(
      prompts,
      prisma as never,
    ).ensureActive();
    expect(
      (await prompts.getActive(WORKOUT_PLANNING_V2_PROMPT.name)).version,
    ).toBe(12);
    expect(
      (await prompts.getActive(WORKOUT_PLANNING_V2_PROMPT_V8.name)).version,
    ).toBe(8);
    expect(
      (await prompts.getActive(WORKOUT_PLANNING_V2_PROMPT_V9.name)).prompt,
    ).toBe(WORKOUT_PLANNING_V2_PROMPT_V9.instructions);
    expect(rows.filter((row) => row.isActive)).toHaveLength(5);
    expect(
      (await prompts.getActive(WORKOUT_PLANNING_V2_PROMPT_V11.name)).prompt,
    ).toBe(WORKOUT_PLANNING_V2_PROMPT_V11.instructions);
    expect(
      (await prompts.getActive(WORKOUT_PLANNING_V2_PROMPT_V10.name)).prompt,
    ).toBe(WORKOUT_PLANNING_V2_PROMPT_V10.instructions);
    expect(promptVersion.updateMany).toHaveBeenCalledWith({
      where: { name: WORKOUT_PLANNING_V2_PROMPT.name, isActive: true },
      data: { isActive: false },
    });
    await new WorkoutPromptActivationService(
      prompts,
      prisma as never,
    ).ensureActive();
    expect(promptVersion.create).toHaveBeenCalledTimes(1);
  });
  it('activates immutable v12 via the existing prompt lifecycle without a migration or seed', async () => {
    const prompts = {
      getActive: jest.fn().mockResolvedValue({ version: 7 }),
      createVersion: jest.fn().mockResolvedValue({ id: 'v8' }),
      activate: jest.fn(),
    };
    const prisma = {
      promptVersion: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await new WorkoutPromptActivationService(
      prompts as never,
      prisma as never,
    ).ensureActive();
    expect(prompts.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 12,
        prompt: WORKOUT_PLANNING_V2_PROMPT.instructions,
        isActive: true,
      }),
    );
    expect(prompts.activate).not.toHaveBeenCalled();
  });
  it('does not rewrite an already active v12 or overwrite a historical mismatch', async () => {
    const prompts = {
      getActive: jest.fn().mockResolvedValue({
        version: 12,
        prompt: WORKOUT_PLANNING_V2_PROMPT.instructions,
      }),
      createVersion: jest.fn(),
      activate: jest.fn(),
    };
    const prisma = { promptVersion: { findUnique: jest.fn() } };
    const activation = new WorkoutPromptActivationService(
      prompts as never,
      prisma as never,
    );
    await activation.ensureActive();
    expect(prisma.promptVersion.findUnique).not.toHaveBeenCalled();
    expect(prompts.createVersion).not.toHaveBeenCalled();
    prompts.getActive.mockResolvedValue({
      version: 12,
      prompt: 'unexpected immutable content',
    });
    await expect(activation.ensureActive()).rejects.toThrow(
      'definition mismatch',
    );
    expect(prompts.activate).not.toHaveBeenCalled();
  });
  it('keeps the complete V8 definition identical to release 2210260', () => {
    expect(
      createHash('sha256')
        .update(JSON.stringify(WORKOUT_PLANNING_V2_PROMPT_V8))
        .digest('hex'),
    ).toBe('6c83221e25e3767bf866b45759f2f777d8698352dacc727a8938a6efa747a06b');
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V8.schema,
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.model).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V8.model,
    );
  });
  it('freezes the final commercial v7 instructions hash', () => {
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V7.instructions)
        .digest('hex'),
    ).toBe('62efa6ef1de1aa7486d2a54ae26930c1e816bb40b55a1894fecefd120d43414c');
    expect(WORKOUT_PLANNING_V2_PROMPT_V7.instructions).toContain(
      'Cada activity.instruction deve ser curta, específica ao exercício',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V7.instructions).toContain(
      'cues de segurança podem repetir quando realmente necessários',
    );
  });
  it('freezes historical v6 instructions while selecting v12', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT.version).toBe(12);
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V6.instructions)
        .digest('hex'),
    ).toBe('2d94eff78b1dff71226957c3a07e4f4ae24a2c6565fe390e16795cb4ecb57436');
  });
  it('selects v12 while retaining immutable v7 and its schema', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT).toBe(WORKOUT_PLANNING_V2_PROMPT_V12);
    expect(WORKOUT_PLANNING_V2_PROMPT_V7.version).toBe(7);
    expect(WORKOUT_PLANNING_V2_PROMPT_V8.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V7.schema,
    );
    expect(
      WORKOUT_PLANNING_V2_PROMPT_V8.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V7.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT_V8.instructions).toContain(
      'strategy.runningTransitionAuthorized=true',
    );
  });
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

  it('selects version 12 without mutating the historical definitions', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT.version).toBe(12);
    expect(WORKOUT_PLANNING_V2_PROMPT_V4.version).toBe(4);
    expect(
      createHash('sha256')
        .update(WORKOUT_PLANNING_V2_PROMPT_V4.instructions)
        .digest('hex'),
    ).toBe('343ced01b4456dfd5dd7213d0105158fa3aa7088eee9dba53a2f1d406817f32f');
    expect(
      WORKOUT_PLANNING_V2_PROMPT_V8.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V4.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT_V8.instructions).toContain(
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
      WORKOUT_PLANNING_V2_PROMPT_V6.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V5.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT_V6.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V5.schema,
    );
    const extension = WORKOUT_PLANNING_V2_PROMPT_V6.instructions.slice(
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

  it('extends immutable v6 with complete multi-round prescriptions and generic quality', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT_V6.version).toBe(6);
    expect(
      WORKOUT_PLANNING_V2_PROMPT_V8.instructions.startsWith(
        WORKOUT_PLANNING_V2_PROMPT_V6.instructions,
      ),
    ).toBe(true);
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.schema).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V6.schema,
    );
    const extension = WORKOUT_PLANNING_V2_PROMPT_V8.instructions.slice(
      WORKOUT_PLANNING_V2_PROMPT_V6.instructions.length,
    );
    expect(extension).toContain('rounds > 1');
    expect(extension).toContain('recoverySeconds = 0');
    expect(extension).toContain('durationSeconds=210');
    expect(extension).toContain('strategy.sessionDurationMinutes');
    expect(extension).toContain('volume semanal');
    expect(extension).not.toMatch(/\b60\s*(?:min|minutos)\b/iu);
  });

  it('deactivates only the prior active definition and preserves history', () => {
    expect(migration).toContain(
      'WHERE "name" = \'workout_planning_v2\'\n  AND "isActive" = true;',
    );
    expect(migration).toContain('ON CONFLICT ("name", "version") DO UPDATE');
    expect(migration).not.toMatch(/\bDELETE\b/i);
  });
});
