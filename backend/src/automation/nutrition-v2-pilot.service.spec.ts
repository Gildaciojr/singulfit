import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { NutritionExecutionResultV2 } from '../diet/v2/execution/nutrition-application-execution.contract';
import type { NutritionApplicationExecutorService } from '../diet/v2/execution/nutrition-application-executor.service';
import type { NutritionPublicResultFormatter } from '../diet/v2/execution/nutrition-public-result.formatter';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import type {
  NutritionV2PilotAuthorization,
  NutritionV2PilotConfigService,
} from './nutrition-v2-pilot-config.service';
import {
  NutritionV2PilotService,
  type NutritionV2PilotSelectionInput,
} from './nutrition-v2-pilot.service';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

function decision(goal = 'GENERATE_DIET_PLAN'): ConversationGoalDecision {
  return Object.freeze({ goal }) as unknown as ConversationGoalDecision;
}

function generationInput(
  artifactType = 'DAILY_STRUCTURE',
): GenerateNutritionPlanV2Input {
  return Object.freeze({
    userId: USER_ID,
    decision: decision(),
    snapshot: Object.freeze({}),
    referenceDate: new Date('2026-07-30T12:00:00.000Z'),
    explicitArtifactType: artifactType,
  }) as unknown as GenerateNutritionPlanV2Input;
}

function planResult(
  artifactType = 'DAILY_STRUCTURE',
): NutritionExecutionResultV2 {
  return Object.freeze({
    kind: 'PLAN',
    aggregateId: 'aggregate-id',
    artifactType,
    document: Object.freeze({ title: 'Plano V2' }),
    aiJobCompleted: true,
    requiresFormatting: true,
    requiresPersistence: true,
  }) as unknown as NutritionExecutionResultV2;
}

describe('NutritionV2PilotService', () => {
  function setup(options?: {
    authorization?: NutritionV2PilotAuthorization;
    result?: NutritionExecutionResultV2;
    timeoutMs?: number;
    formatted?: string;
  }) {
    const config = {
      authorize: jest
        .fn()
        .mockReturnValue(
          options?.authorization ?? ({ status: 'AUTHORIZED' } as const),
        ),
      timeoutMs: jest.fn().mockReturnValue(options?.timeoutMs ?? 100),
    };
    const executor = {
      execute: jest.fn().mockResolvedValue(options?.result ?? planResult()),
    };
    const formatter = {
      format: jest.fn().mockReturnValue(options?.formatted ?? ' resposta V2 '),
    };
    const service = new NutritionV2PilotService(
      config as unknown as NutritionV2PilotConfigService,
      executor as unknown as NutritionApplicationExecutorService,
      formatter as unknown as NutritionPublicResultFormatter,
    );
    const input: NutritionV2PilotSelectionInput = {
      userId: USER_ID,
      profileId: 'profile-id',
      decision: decision(),
      generationInput: generationInput(),
      correlationId: 'correlation-id',
      legacyContent: 'resposta legada',
    };
    return { config, executor, formatter, service, input };
  }

  it.each([
    { status: 'DISABLED' },
    { status: 'INVALID_CONFIG' },
    { status: 'NOT_AUTHORIZED' },
  ] as const)(
    'keeps legacy for authorization status $status',
    async (status) => {
      const test = setup({ authorization: status });

      await expect(test.service.select(test.input)).resolves.toEqual({
        content: 'resposta legada',
        selected: 'LEGACY',
        suppressShadow: false,
      });
      expect(test.executor.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['GENERATE_COMBINED_PLANS', 'DAILY_STRUCTURE'],
    ['UPDATE_DIET_PLAN', 'DAILY_STRUCTURE'],
    ['GENERAL_GUIDANCE', 'POINT_GUIDANCE'],
    ['GENERATE_DIET_PLAN', 'WEEKLY_PLAN'],
  ])(
    'keeps legacy for ineligible goal %s or artifact %s',
    async (goal, artifact) => {
      const test = setup();

      await expect(
        test.service.select({
          ...test.input,
          decision: decision(goal),
          generationInput: generationInput(artifact),
        }),
      ).resolves.toMatchObject({
        selected: 'LEGACY',
        suppressShadow: false,
      });
      expect(test.executor.execute).not.toHaveBeenCalled();
    },
  );

  it('keeps legacy when the fitness profile ownership is unavailable', async () => {
    const test = setup();

    await expect(
      test.service.select({ ...test.input, profileId: null }),
    ).resolves.toMatchObject({
      selected: 'LEGACY',
      suppressShadow: false,
    });
    expect(test.executor.execute).not.toHaveBeenCalled();
  });

  it('selects one trimmed V2 response for an authorized daily plan', async () => {
    const test = setup();

    await expect(test.service.select(test.input)).resolves.toEqual({
      content: 'resposta V2',
      selected: 'V2',
      suppressShadow: true,
    });
    expect(test.executor.execute).toHaveBeenCalledWith({
      generationInput: test.input.generationInput,
      ownership: { userId: USER_ID, profileId: 'profile-id' },
      correlationId: 'correlation-id',
      traceId: undefined,
    });
    expect(test.formatter.format).toHaveBeenCalledWith(planResult());
  });

  it.each([
    Object.freeze({
      kind: 'CONVERSATIONAL_ARTIFACT',
      artifactType: 'POINT_GUIDANCE',
      document: Object.freeze({}),
    }),
    Object.freeze({
      kind: 'CURRENT_PLAN_PRESENTATION',
      artifactType: 'CURRENT_PLAN_PRESENTATION',
      document: null,
    }),
    Object.freeze({
      kind: 'PLAN',
      artifactType: 'DAILY_STRUCTURE',
      document: null,
    }),
  ])('falls back for an incompatible execution result', async (result) => {
    const test = setup({
      result: result as unknown as NutritionExecutionResultV2,
    });

    await expect(test.service.select(test.input)).resolves.toEqual({
      content: 'resposta legada',
      selected: 'LEGACY',
      suppressShadow: true,
    });
    expect(test.formatter.format).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(10_001)])(
    'falls back when the formatter returns an invalid official string',
    async (formatted) => {
      const test = setup({ formatted });

      await expect(test.service.select(test.input)).resolves.toMatchObject({
        content: 'resposta legada',
        selected: 'LEGACY',
        suppressShadow: true,
      });
    },
  );

  it('falls back when the formatter throws', async () => {
    const test = setup();
    test.formatter.format.mockImplementation(() => {
      throw new Error('formatter unavailable');
    });

    await expect(test.service.select(test.input)).resolves.toMatchObject({
      content: 'resposta legada',
      suppressShadow: true,
    });
  });

  it('falls back when the Executor throws', async () => {
    const test = setup();
    test.executor.execute.mockRejectedValue(new Error('engine unavailable'));

    await expect(test.service.select(test.input)).resolves.toMatchObject({
      content: 'resposta legada',
      suppressShadow: true,
    });
  });

  it('falls back after the total external timeout without an unhandled rejection', async () => {
    const test = setup({ timeoutMs: 5 });
    test.executor.execute.mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    await expect(test.service.select(test.input)).resolves.toEqual({
      content: 'resposta legada',
      selected: 'LEGACY',
      suppressShadow: true,
    });
  });
});
