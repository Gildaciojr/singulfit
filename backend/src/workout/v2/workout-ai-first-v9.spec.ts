import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, FitnessGoal, Prisma } from '@prisma/client';
import { WorkoutPlanV2PersistenceService } from './persistence/workout-plan-v2-persistence.service';
import { WorkoutPlanV2PersistenceValidator } from './persistence/workout-plan-v2-persistence.validator';
import type {
  CreateWorkoutPlanV2Record,
  PersistedWorkoutPlanRecord,
} from './persistence/workout-plan-v2.repository';
import { AIService } from '../../ai/ai.service';
import { OpenAIGateway } from '../../ai/openai.gateway';
import { AIUsageService } from '../../ai/ai-usage.service';
import type {
  OpenAIResponseResult,
  OpenAITextRequest,
  OpenAIBackgroundResponse,
} from '../../ai/interfaces/openai.interface';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';
import {
  durableTextOperation,
  DurableTextPendingError,
} from '../../ai/durable-text-operation.contract';
import {
  knownDatum,
  unknownDatum,
  routingSnapshot,
} from '../../conversation/tests/conversation-routing.fixtures';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import type { WorkoutModality } from './workout-planning-artifact.contract';
import {
  qualityCandidate,
  qualitySession,
  strength,
} from './workout-quality.fixtures';

interface StoredJob {
  id: string;
  userId: string;
  type: AIJobType;
  operationKey: string;
  promptVersionId: string;
  promptVersion: typeof prompt;
  providerResponseId?: string | null;
  status: AIJobStatus;
  attempts: number;
  startedAt: Date | null;
  leaseExpiresAt: Date | null;
  result: Prisma.JsonValue | null;
}
const prompt = {
  ...WORKOUT_PLANNING_V2_PROMPT,
  id: 'v9',
  prompt: WORKOUT_PLANNING_V2_PROMPT.instructions,
};

function plan(
  modality: WorkoutModality,
  count: number,
  conflict = false,
): GeneratedWorkoutPlanV2Candidate {
  return {
    ...qualityCandidate(),
    modality,
    sessions: Array.from({ length: count }, (_, index) => {
      const key = `session-${index}`;
      const locomotion: WorkoutActivityV2 = {
        activityKey: `${key}-locomotion`,
        kind: 'ENDURANCE',
        name: conflict
          ? 'Remoções articulares e corrida no lugar leve'
          : modality === 'RUNNING'
            ? 'Corrida leve'
            : 'Caminhada confortável',
        mode: modality === 'RUNNING' ? 'RUN' : 'WALK',
        source: 'MODEL_GENERATED',
        movementPattern: 'LOCOMOTION',
        equipment: ['BODYWEIGHT'],
        intensity: 'CONVERSATIONAL',
        durationMinutes: 60,
        distanceKm: null,
        alerts: [],
        appliedConstraintCodes: [],
        instruction: conflict
          ? 'Mobilize tornozelos, quadris e ombros com ritmo leve e respiração solta.'
          : 'Mantenha esforço confortável.',
      };
      const session =
        modality === 'CROSSFIT'
          ? {
              ...qualitySession(key, []),
              blocks: [
                {
                  blockKey: `${key}-warm`,
                  type: 'WARM_UP' as const,
                  title: 'Aquecimento',
                  estimatedDurationMinutes: 6,
                  activities: [
                    {
                      ...locomotion,
                      activityKey:
                        index === 0 ? 'MONDAY_WARMUP_1' : `${key}-warmup`,
                      durationMinutes: 6,
                      name:
                        conflict && index === 0
                          ? locomotion.name
                          : 'Caminhada confortável',
                    },
                  ],
                },
                {
                  blockKey: `${key}-skill`,
                  type: 'SKILL' as const,
                  title: 'Técnica e scaling',
                  estimatedDurationMinutes: 32,
                  activities: [
                    {
                      activityKey: `${key}-skill-1`,
                      kind: 'MOBILITY' as const,
                      name: 'Prática técnica de agachamento com apoio',
                      source: 'MODEL_GENERATED' as const,
                      movementPattern: 'OTHER' as const,
                      equipment: ['BODYWEIGHT' as const],
                      instruction:
                        'Pratique amplitude confortável com pausas e regressão apoiada.',
                      alerts: [],
                      appliedConstraintCodes: [],
                      durationSeconds: 1920,
                      repetitions: null,
                      holdSeconds: null,
                    },
                  ],
                },
                {
                  blockKey: `${key}-wod`,
                  type: 'CONDITIONING' as const,
                  title: 'EMOM técnico com scaling',
                  estimatedDurationMinutes: 18,
                  activities: [
                    {
                      activityKey: `${key}-wod-1`,
                      kind: 'TIMED' as const,
                      name: 'EMOM de air squats e flexões inclinadas',
                      source: 'MODEL_GENERATED' as const,
                      movementPattern: 'OTHER' as const,
                      equipment: ['BODYWEIGHT' as const],
                      instruction:
                        'Alterne os movimentos por minuto, com poucas repetições controladas e descanso restante; reduza a amplitude se necessário.',
                      alerts: [],
                      appliedConstraintCodes: [],
                      durationSeconds: 1080,
                      workSeconds: 30,
                      recoverySeconds: 30,
                      rounds: 18,
                      intensity: 'LIGHT' as const,
                    },
                  ],
                },
                {
                  blockKey: `${key}-cool`,
                  type: 'COOLDOWN' as const,
                  title: 'Desaceleração',
                  estimatedDurationMinutes: 4,
                  activities: [
                    {
                      ...locomotion,
                      activityKey: `${key}-cool-1`,
                      name: 'Caminhada confortável',
                      durationMinutes: 4,
                      instruction: 'Reduza o ritmo gradualmente.',
                    },
                  ],
                },
              ],
            }
          : modality === 'GYM_STRENGTH' || modality === 'HOME_WORKOUT'
            ? qualitySession(key)
            : qualitySession(key, [locomotion]);
      return {
        ...session,
        sequence: index + 1,
        label: `${modality} ${index + 1}`,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) =>
            activity.kind === 'ENDURANCE'
              ? {
                  activityKey: activity.activityKey,
                  name: activity.name,
                  kind: activity.kind,
                  mode: activity.mode,
                  source: activity.source,
                  movementPattern: activity.movementPattern,
                  equipment: activity.equipment,
                  instruction: activity.instruction,
                  alerts: activity.alerts,
                  appliedConstraintCodes: activity.appliedConstraintCodes,
                  intensity: activity.intensity,
                  durationMinutes: activity.durationMinutes,
                  distanceKm: activity.distanceKm,
                }
              : activity,
          ),
        })),
      };
    }),
  };
}

async function subject(
  text: string,
  candidates: readonly GeneratedWorkoutPlanV2Candidate[],
  overrides: Partial<CoachProfileSnapshot['training']> = {},
  limitations: readonly string[] = [],
) {
  const base = routingSnapshot();
  const snapshot: CoachProfileSnapshot = {
    ...base,
    training: {
      ...base.training,
      primaryGoal: knownDatum('WEIGHT_LOSS'),
      preferredModality: knownDatum('RUNNING'),
      experienceLevel: knownDatum('INTERMEDIATE'),
      environment: knownDatum('FULL_GYM'),
      weeklyFrequency: knownDatum(5),
      sessionDurationMinutes: knownDatum(60),
      perceivedConditioning: unknownDatum(),
      availableEquipment: knownDatum([
        'BARBELL',
        'BENCH',
        'CABLE',
        'DUMBBELL',
        'MACHINE',
        'PULL_UP_BAR',
        'TREADMILL',
      ]),
      ...overrides,
    },
    nutrition: { ...base.nutrition, primaryGoal: knownDatum('WEIGHT_LOSS') },
    restrictions: {
      ...base.restrictions,
      physicalLimitations: knownDatum(
        limitations.map((description) => ({
          description,
          source: 'FITNESS_PROFILE' as const,
        })),
      ),
    },
  };
  const input = (
    await new GenerateWorkoutPlanV2InputBuilder({} as never, {} as never).build(
      {
        userId: 'owned-user',
        profileId: 'owned-profile',
        snapshot,
        currentMessage: text,
        requestId: 'request-id',
        referenceDate: new Date(snapshot.referenceDate),
      },
    )
  ).generationInput;
  let job: StoredJob | null = null;
  const usageRows: {
    id: string;
    userId: string;
    aiJobId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: Prisma.Decimal;
    costCurrency: string;
    createdAt: Date;
  }[] = [];
  const reserved = jest.fn().mockResolvedValue([]);
  const confirmed = jest.fn();
  const reversed = jest.fn();
  const config = new ConfigService({
    AI_JOB_LEASE_SECONDS: '120',
    OPENAI_TEXT_INPUT_COST_PER_1M_USD: '2',
    OPENAI_TEXT_OUTPUT_COST_PER_1M_USD: '4',
  });
  const jobStore = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(() =>
      Promise.resolve(
        job && ['PENDING', 'PROCESSING'].includes(job.status) ? job : null,
      ),
    ),
    findUnique: jest.fn(() => Promise.resolve(job)),
    findUniqueOrThrow: jest.fn(() => Promise.resolve(job)),
    create: jest.fn(
      (query: {
        data: { operationKey: string; userId: string; type: AIJobType };
      }) => {
        job = {
          ...query.data,
          id: 'job',
          status: AIJobStatus.PENDING,
          attempts: 0,
          startedAt: null,
          leaseExpiresAt: null,
          result: null,
          promptVersionId: 'v9',
          promptVersion: prompt,
        };
        return Promise.resolve(job);
      },
    ),
    updateMany: jest.fn(
      (query: {
        where: Prisma.AIJobWhereInput;
        data: Prisma.AIJobUpdateManyMutationInput;
      }) => {
        if (
          !job ||
          (query.where.id !== job.id &&
            !(
              typeof query.where.id === 'object' &&
              Array.isArray(query.where.id.in) &&
              query.where.id.in.includes(job.id)
            )) ||
          (typeof query.where.status === 'string' &&
            query.where.status !== job.status) ||
          (typeof query.where.attempts === 'number' &&
            query.where.attempts !== job.attempts) ||
          (query.where.startedAt instanceof Date &&
            query.where.startedAt.getTime() !== job.startedAt?.getTime())
        )
          return Promise.resolve({ count: 0 });
        if (typeof query.data.status === 'string')
          job.status = query.data.status;
        if (query.data.startedAt instanceof Date)
          job.startedAt = query.data.startedAt;
        if (
          query.data.leaseExpiresAt instanceof Date ||
          query.data.leaseExpiresAt === null
        )
          job.leaseExpiresAt = query.data.leaseExpiresAt;
        if (query.data.attempts && typeof query.data.attempts === 'object')
          job.attempts += query.data.attempts.increment ?? 0;
        if (query.data.result)
          job.result = JSON.parse(
            JSON.stringify(query.data.result),
          ) as Prisma.JsonValue;
        if (
          typeof query.data.providerResponseId === 'string' ||
          query.data.providerResponseId === null
        )
          job.providerResponseId = query.data.providerResponseId;
        return Promise.resolve({ count: 1 });
      },
    ),
    update: jest.fn(
      (query: {
        data: {
          status: AIJobStatus;
          result?: Prisma.InputJsonValue;
          providerResponseId?: string | null;
        };
      }) => {
        if (!job) throw new Error('Missing job');
        job.status = query.data.status;
        job.leaseExpiresAt = null;
        if (query.data.providerResponseId !== undefined)
          job.providerResponseId = query.data.providerResponseId;
        if (query.data.result)
          job.result = JSON.parse(
            JSON.stringify(query.data.result),
          ) as Prisma.JsonValue;
        return Promise.resolve(job);
      },
    ),
  };
  const tx = {
    aIJob: jobStore,
    $queryRaw: jest.fn().mockResolvedValue([]),
    aIUsage: {
      findUnique: jest.fn(() => Promise.resolve(usageRows[0] ?? null)),
      create: jest.fn(
        (query: {
          data: Omit<(typeof usageRows)[number], 'id' | 'createdAt'>;
        }) => {
          if (usageRows.length) throw new Error('Unique usage per job');
          const row = { ...query.data, id: 'usage', createdAt: new Date() };
          usageRows.push(row);
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        (query: {
          where: Prisma.AIUsageWhereInput;
          data: Prisma.AIUsageUpdateManyMutationInput;
        }) => {
          const row = usageRows[0];
          if (
            !row ||
            query.where.id !== row.id ||
            query.where.promptTokens !== row.promptTokens ||
            query.where.completionTokens !== row.completionTokens
          )
            return Promise.resolve({ count: 0 });
          if (typeof query.data.promptTokens === 'object')
            row.promptTokens += query.data.promptTokens.increment ?? 0;
          if (typeof query.data.completionTokens === 'object')
            row.completionTokens += query.data.completionTokens.increment ?? 0;
          if (typeof query.data.totalTokens === 'object')
            row.totalTokens += query.data.totalTokens.increment ?? 0;
          if (
            typeof query.data.estimatedCost === 'object' &&
            'increment' in query.data.estimatedCost
          ) {
            const increment = query.data.estimatedCost.increment;
            if (
              increment instanceof Prisma.Decimal ||
              typeof increment === 'number' ||
              typeof increment === 'string'
            ) {
              row.estimatedCost = row.estimatedCost.add(increment);
            }
          }
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    aIUsageSummary: { upsert: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      const beforeJob = job ? structuredClone(job) : null;
      const beforeUsage = usageRows.map((row) => ({
        ...row,
        estimatedCost: new Prisma.Decimal(row.estimatedCost),
      }));
      try {
        return await operation(tx);
      } catch (error: unknown) {
        job = beforeJob;
        usageRows.splice(0, usageRows.length, ...beforeUsage);
        throw error;
      }
    },
  };
  let gatewayCalls = 0;
  const gateway = {
    getRequestedTextModel: jest.fn(() => 'unchanged-model'),
    createTextResponse: jest.fn(
      (request: OpenAITextRequest): Promise<OpenAIResponseResult> => {
        const index = gatewayCalls++;
        const candidate = candidates[index];
        if (!candidate) throw new Error('Unexpected provider call');
        expect(request.instructions).toBe(prompt.instructions);
        return Promise.resolve({
          outputText: JSON.stringify(candidate),
          responseId: `response-${index}`,
          model: 'unchanged-model',
          promptTokens: 100 + index,
          completionTokens: 20 + index,
          totalTokens: 120 + 2 * index,
        });
      },
    ),
    startBackgroundTextResponse: jest.fn<
      Promise<string>,
      [OpenAITextRequest]
    >(),
    retrieveTextResponse: jest.fn<
      Promise<OpenAIBackgroundResponse>,
      [string]
    >(),
    cancelTextResponse: jest.fn(),
  };
  const providerResponses = new Map<string, OpenAIResponseResult>();
  gateway.startBackgroundTextResponse.mockImplementation(async (request) => {
    const response = await gateway.createTextResponse(request);
    providerResponses.set(response.responseId, response);
    return response.responseId;
  });
  gateway.retrieveTextResponse.mockImplementation((responseId: string) => {
    expect(
      durableTextOperation(job?.result)?.attempts.some(
        (attempt) => attempt.responseId === responseId,
      ),
    ).toBe(true);
    const result = providerResponses.get(responseId);
    if (!result) throw new Error('Provider response not found');
    return Promise.resolve({ responseId, status: 'completed', result });
  });
  const ai = new AIService(
    prisma as never,
    { getActive: jest.fn().mockResolvedValue(prompt) } as never,
    gateway as never,
    new AIUsageService(prisma as never, config),
    { reserveCommercialUsageInTransaction: reserved } as never,
    {
      confirmInTransaction: confirmed,
      reverseInTransaction: reversed,
    } as never,
    config,
    { publish: jest.fn() } as never,
  );
  const engine = new WorkoutPlanningEngineV2Service(
    new WorkoutArtifactResolverService(),
    new WorkoutPlanningReadinessService(),
    new WorkoutPlanningContextBuilder(),
    new WorkoutPlanningStrategyService(),
    new WorkoutPlanningSafetyService(),
    new WorkoutPlanV2Validator(),
    ai,
    undefined,
    { ensureActive: jest.fn() } as never,
  );
  const complete = async (
    result: Awaited<ReturnType<typeof engine.generateCandidate>>,
    thinResult = false,
  ) => {
    if (result.completion)
      await ai.completeJobInTransaction(tx as never, {
        ...result.completion,
        result: {
          ...(thinResult
            ? {
                candidateOutput: result.storedResult.candidateOutput,
                model: result.storedResult.model,
              }
            : result.storedResult),
          acceptedOutput: JSON.parse(
            JSON.stringify(result.output),
          ) as Prisma.InputJsonObject,
        },
      });
  };
  return {
    engine,
    input,
    ai,
    gateway,
    reserved,
    confirmed,
    reversed,
    usageRows,
    complete,
    jobStore,
    tx,
    providerResponses,
    prisma,
    job: () => job,
  };
}

describe('Workout AI-first V9: real engine, AIJob claim and usage', () => {
  it('repairs a requested alias with the same provider snapshot through the real background gateway', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    const configured = 'gpt-5.4-mini';
    const resolved = 'gpt-5.4-mini-2026-03-17';
    const realGateway = new OpenAIGateway({
      get: (key: string) =>
        key === 'OPENAI_MODEL_TEXT' ? configured : 'test-key',
    } as never);
    s.gateway.getRequestedTextModel.mockImplementation(() =>
      realGateway.getRequestedTextModel(),
    );
    s.gateway.startBackgroundTextResponse.mockImplementation((request) =>
      realGateway.startBackgroundTextResponse(request),
    );
    const generation = s.gateway.createTextResponse.getMockImplementation();
    if (!generation) throw new Error('Missing generation fixture');
    const wire = jest.spyOn(global, 'fetch');
    wire.mockImplementation(async (_url, init) => {
      if (typeof init?.body !== 'string')
        throw new Error('Expected background POST');
      const body = JSON.parse(init.body) as {
        model: string;
        instructions: string;
        input: string;
      };
      expect(body.model).toBe(configured);
      const response = await generation({
        instructions: body.instructions,
        input: body.input,
        requestId: 'wire-fixture',
      });
      const result = {
        ...response,
        model: resolved,
        responseId: response.responseId.replace('response-', 'resp_'),
      };
      s.providerResponses.set(result.responseId, result);
      return new Response(
        JSON.stringify({ id: result.responseId, status: 'queued' }),
        { status: 200 },
      );
    });
    try {
      const result = await s.engine.generateCandidate(s.input);
      await s.complete(result);
      const ledger = durableTextOperation(s.job()?.result);
      expect(ledger?.attempts.map((attempt) => attempt.requestedModel)).toEqual(
        [configured, configured],
      );
      expect(
        ledger?.attempts.map((attempt) => attempt.response?.model),
      ).toEqual([resolved, resolved]);
      expect(ledger?.attempts.map((attempt) => attempt.responseId)).toEqual([
        'resp_0',
        'resp_1',
      ]);
      expect(ledger?.attempts.every((attempt) => attempt.usageRecorded)).toBe(
        true,
      );
      expect(s.usageRows).toHaveLength(1);
      expect(s.usageRows[0]).toMatchObject({
        model: resolved,
        totalTokens: 242,
      });
      expect(s.usageRows[0].estimatedCost).toEqual(
        new Prisma.Decimal('0.000566'),
      );
      await s.engine.generateCandidate(s.input);
      expect(wire).toHaveBeenCalledTimes(2);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
    } finally {
      wire.mockRestore();
    }
  });

  it('blocks a real configured model change before creating the repair', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
    ]);
    s.gateway.getRequestedTextModel
      .mockReturnValueOnce('unchanged-model')
      .mockReturnValue('different-model');
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Durable repair model configuration changed',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(durableTextOperation(s.job()?.result)?.attempts).toHaveLength(1);
    expect(s.usageRows[0].totalTokens).toBe(120);
  });
  it.each([false, true])(
    'preserves the completed ledger, audit and accepted candidate with repair=%s',
    async (repair) => {
      const s = await subject(
        'Monte um treino de Crossfit 4x',
        repair
          ? [plan('CROSSFIT', 4, true), plan('CROSSFIT', 4)]
          : [plan('CROSSFIT', 4)],
      );
      const result = await s.engine.generateCandidate(s.input);
      const originalLedger = durableTextOperation(s.job()?.result);
      expect(originalLedger).not.toBeNull();
      let persisted: PersistedWorkoutPlanRecord | null = null;
      const create = jest.fn(
        (
          _tx: Prisma.TransactionClient,
          record: CreateWorkoutPlanV2Record,
        ): Promise<PersistedWorkoutPlanRecord> => {
          persisted = {
            ...record,
            id: 'persisted-plan',
            createdAt: record.generatedAt,
            updatedAt: record.generatedAt,
            days: record.days.map((day) => ({
              ...day,
              id: `day-${day.dayNumber}`,
              workoutPlanId: 'persisted-plan',
              exercises: day.exercises.map((exercise, index) => ({
                ...exercise,
                id: `exercise-${day.dayNumber}-${index}`,
                workoutDayId: `day-${day.dayNumber}`,
              })),
            })),
          };
          return Promise.resolve(persisted);
        },
      );
      const persistence = new WorkoutPlanV2PersistenceService(
        {
          inTransaction: <T>(
            operation: (transaction: Prisma.TransactionClient) => Promise<T>,
          ): Promise<T> =>
            s.prisma.$transaction((transaction) =>
              operation(transaction as never),
            ) as Promise<T>,
          acquireUserLock: () => Promise.resolve(),
          findOwnership: () =>
            Promise.resolve({
              profile: { goal: FitnessGoal.MAINTENANCE },
              aiJob: s.job(),
            }),
          findByAIJobId: () => Promise.resolve(persisted),
          archiveActive: () => Promise.resolve(),
          create,
        },
        new WorkoutPlanV2PersistenceValidator(),
        { recordInTransaction: jest.fn() } as never,
        s.ai,
      );
      const ownership = { userId: s.input.userId, profileId: 'profile' };
      await persistence.persist({ generation: result, ownership });
      const terminal = s.job()?.result as Prisma.JsonObject;
      expect(durableTextOperation(terminal)).toEqual(originalLedger);
      expect(terminal.executionAudit).toEqual(
        result.storedResult.executionAudit,
      );
      expect(terminal.acceptedOutput).toEqual(result.output);
      expect(terminal.candidateOutput).toBe(
        result.storedResult.candidateOutput,
      );
      expect(originalLedger?.requestInput).toBe(
        s.gateway.createTextResponse.mock.calls[0][0].input,
      );
      expect(originalLedger?.attempts).toHaveLength(repair ? 2 : 1);
      expect(
        originalLedger?.attempts.every(
          (attempt) => attempt.responseId && attempt.usageRecorded,
        ),
      ).toBe(true);
      if (repair)
        expect(originalLedger?.attempts[0].validationIssues).toContainEqual({
          code: 'ENDURANCE_MODE_CONFLICT',
          severity: 'ERROR',
          path: 'MONDAY_WARMUP_1',
        });
      const replay = await s.engine.generateCandidate(s.input);
      expect(replay.status).toBe('ALREADY_COMPLETED');
      expect(
        (await persistence.persist({ generation: replay, ownership }))
          .persistence,
      ).toBe('REUSED');
      expect(create).toHaveBeenCalledTimes(1);
      expect(durableTextOperation(s.job()?.result)).toEqual(originalLedger);
      expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(
        repair ? 2 : 1,
      );
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.usageRows).toHaveLength(1);
      expect(s.usageRows[0].totalTokens).toBe(repair ? 242 : 120);
    },
  );

  it('protects a durable ledger when a completion caller supplies only final output fields', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    const result = await s.engine.generateCandidate(s.input);
    const originalLedger = durableTextOperation(s.job()?.result);
    await s.complete(result, true);
    expect(durableTextOperation(s.job()?.result)).toEqual(originalLedger);
    expect((s.job()?.result as Prisma.JsonObject).acceptedOutput).toEqual(
      result.output,
    );
  });
  it.each(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const)(
    'A/B/C/I: CrossFit 4x current beats RUNNING/5x history for %s with unknown conditioning',
    async (experience) => {
      const text =
        'Monte um treino de Crossfit para mim, 4 vezes por semana, considerando meu perfil';
      const s = await subject(text, [plan('CROSSFIT', 4)], {
        experienceLevel: knownDatum(experience),
      });
      const output = await s.engine.generateCandidate(s.input);
      expect(output.output.modality).toBe('CROSSFIT');
      expect(output.output.sessions).toHaveLength(4);
      expect(
        output.output.sessions[0].blocks.some((block) =>
          block.title.includes('EMOM'),
        ),
      ).toBe(true);
      const payload = JSON.parse(
        s.gateway.createTextResponse.mock.calls[0][0].input,
      ) as Record<string, unknown>;
      expect(payload.currentRequest).toEqual({ text, requestId: 'request-id' });
      expect(payload.context).toMatchObject({
        training: {
          experience: { value: experience },
          perceivedConditioning: { status: 'NOT_SET' },
          environment: { value: 'FULL_GYM' },
        },
        resolvedFacts: {
          modality: { value: 'CROSSFIT', source: 'CURRENT_EXPLICIT' },
          weeklyFrequency: { value: 4, source: 'CURRENT_EXPLICIT' },
        },
      });
      expect(payload.strategy).toMatchObject({
        sessionFocuses: [],
        requiredBlocks: [],
        sessionCount: 4,
      });
      expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
      await s.complete(output);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [
      'D',
      'Monte um treino de corrida 4x para correr 10 km, já corro 5 km',
      'RUNNING',
      4,
    ],
    ['E', 'Monte um treino de caminhada 5x sem trote', 'WALKING', 5],
    [
      'F',
      'Monte um treino de musculação 4x para hipertrofia',
      'GYM_STRENGTH',
      4,
    ],
    [
      'G',
      'Monte um treino em casa 3x apenas com peso corporal',
      'HOME_WORKOUT',
      3,
    ],
  ] as const)(
    '%s: preserves modality and frequency through structured output',
    async (_id, text, modality, count) => {
      const candidate = {
        ...plan(modality, count),
        objective:
          modality === 'RUNNING'
            ? ('COMPLETE_DISTANCE' as const)
            : modality === 'GYM_STRENGTH'
              ? ('HYPERTROPHY' as const)
              : ('WEIGHT_LOSS' as const),
      };
      const s = await subject(text, [candidate]);
      const result = await s.engine.generateCandidate(s.input);
      expect(result.output.modality).toBe(modality);
      expect(result.output.sessions).toHaveLength(count);
      expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
    },
  );
  it('K/N: repairs the exact production representation conflict once, accounts both calls, and replays without provider', async () => {
    const s = await subject('Monte um treino de Crossfit 4 vezes por semana', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    const result = await s.engine.generateCandidate(s.input);
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    const first = JSON.parse(
      s.gateway.createTextResponse.mock.calls[0][0].input,
    ) as Record<string, unknown>;
    const second = JSON.parse(
      s.gateway.createTextResponse.mock.calls[1][0].input,
    ) as Record<string, unknown>;
    expect(second.context).toEqual(first.context);
    expect(second.strategy).toEqual(first.strategy);
    expect(second.currentRequest).toEqual(first.currentRequest);
    expect(second.repair).toMatchObject({
      validationIssues: expect.arrayContaining([
        expect.objectContaining({
          code: 'ENDURANCE_MODE_CONFLICT',
          severity: 'ERROR',
        }),
      ]),
    });
    await s.complete(result);
    expect(s.usageRows).toEqual([
      expect.objectContaining({
        promptTokens: 201,
        completionTokens: 41,
        totalTokens: 242,
        estimatedCost: new Prisma.Decimal('0.000566'),
      }),
    ]);
    expect(s.job()?.attempts).toBe(1);
    expect(s.job()?.status).toBe('COMPLETED');
    expect(s.reserved).toHaveBeenCalledTimes(1);
    expect(s.confirmed).toHaveBeenCalledTimes(1);
    const replay = await s.engine.generateCandidate(s.input);
    expect(replay.status).toBe('ALREADY_COMPLETED');
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
  });
  it('L: fails after exactly two invalid candidates, records both usages and never retries the failed operation', async () => {
    const invalid = plan('CROSSFIT', 4, true);
    const s = await subject('Monte um treino de Crossfit 4x', [
      invalid,
      invalid,
    ]);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'ENDURANCE_MODE_CONFLICT',
    );
    expect(s.job()?.status).toBe('FAILED');
    expect(s.job()?.leaseExpiresAt).toBeNull();
    const failedLedger = durableTextOperation(s.job()?.result);
    expect(failedLedger?.attempts.map((attempt) => attempt.responseId)).toEqual(
      ['response-0', 'response-1'],
    );
    expect(
      failedLedger?.attempts.every((attempt) => attempt.usageRecorded),
    ).toBe(true);
    expect(failedLedger?.requestInput).toBe(
      s.gateway.createTextResponse.mock.calls[0][0].input,
    );
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    expect(s.usageRows).toEqual([
      expect.objectContaining({ totalTokens: 242 }),
    ]);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    expect(s.reversed).toHaveBeenCalledTimes(1);
  });
  it('M: persists warnings without repair', async () => {
    const base = plan('GYM_STRENGTH', 4);
    const candidate = {
      ...base,
      sessions: base.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          estimatedDurationMinutes:
            block.type === 'STRENGTH' ? 75 : block.estimatedDurationMinutes,
        })),
      })),
    };
    const s = await subject('Monte um treino de musculação 4x', [candidate]);
    const output = await s.engine.generateCandidate(s.input);
    expect(output.output.validation.status).toBe('VALID_WITH_WARNINGS');
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
    await s.complete(output);
  });
  it('J: a current hard safety blocker never claims a provider operation', async () => {
    const s = await subject('Monte um treino de Crossfit 4x, estou com febre', [
      plan('CROSSFIT', 4),
    ]);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'bloqueada',
    );
    expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
    expect(s.reserved).not.toHaveBeenCalled();
  });
  it('H: a known physical limitation is immutable and does not enter representation repair', async () => {
    const candidate = plan('GYM_STRENGTH', 4);
    const s = await subject(
      'Monte um treino de musculação 4x, tenho restrição no joelho',
      [candidate],
      {},
      ['evitar sobrecarga no joelho'],
    );
    const first = candidate.sessions[0];
    expect(strength().movementPattern).toBe('SQUAT');
    expect(first.blocks.length).toBeGreaterThan(0);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'LIMITATION_CONFLICT',
    );
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
    expect(s.job()?.status).toBe('FAILED');
  });
  it('replay keeps request identity even if time and the profile snapshot have changed', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    const first = await s.engine.generateCandidate(s.input);
    await s.complete(first);
    const input = {
      ...s.input,
      referenceDate: new Date(s.input.referenceDate.getTime() + 60_000),
      snapshot: {
        ...s.input.snapshot,
        training: {
          ...s.input.snapshot.training,
          weeklyFrequency: knownDatum(6),
        },
      },
    };
    const replay = await s.engine.generateCandidate(input);
    expect(replay.operationKey).toBe(first.operationKey);
    expect(replay.status).toBe('ALREADY_COMPLETED');
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
    expect(s.reserved).toHaveBeenCalledTimes(1);
  });
  it('an expired durable job retrieves its saved result without another generation', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    await s.engine.generateCandidate(s.input);
    const job = s.job();
    if (!job) throw new Error('Expected job');
    job.leaseExpiresAt = new Date(0);
    await expect(s.engine.generateCandidate(s.input)).resolves.toMatchObject({
      status: 'PENDING_COMPLETION',
    });
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
  });
  it('F/G: expired pending persistence resumes once and completed replay never generates again', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    await s.engine.generateCandidate(s.input);
    const job = s.job();
    if (!job) throw new Error('Expected job');
    job.leaseExpiresAt = new Date(0);
    s.jobStore.findMany.mockResolvedValue([{ ...job }]);
    const resumed = await s.engine.generateCandidate(s.input);
    await s.complete(resumed);
    await expect(s.engine.generateCandidate(s.input)).resolves.toMatchObject({
      status: 'ALREADY_COMPLETED',
    });
    expect(s.job()?.status).toBe('COMPLETED');
    expect(s.usageRows).toEqual([
      expect.objectContaining({ totalTokens: 242 }),
    ]);
    expect(s.reversed).not.toHaveBeenCalled();
    expect(s.confirmed).toHaveBeenCalledTimes(1);
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    expect(s.reserved).toHaveBeenCalledTimes(1);
  });
  it('a repair transport failure accounts the first response and terminates the lease without a third call', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
    ]);
    const initial = s.gateway.createTextResponse.getMockImplementation();
    if (!initial) throw new Error('Expected gateway implementation');
    s.gateway.createTextResponse
      .mockImplementationOnce(initial)
      .mockRejectedValueOnce(new Error('Repair transport failure'));
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Repair transport failure',
    );
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    expect(s.job()?.status).toBe('FAILED');
    expect(s.job()?.leaseExpiresAt).toBeNull();
    expect(s.usageRows).toEqual([
      expect.objectContaining({ totalTokens: 120 }),
    ]);
    expect(s.job()?.result).toMatchObject({
      executionAudit: {
        providerCalls: 2,
        repairAttempted: true,
        finalOutcome: 'FAILED',
      },
    });
  });
  it.each(['modality', 'frequency'] as const)(
    'a repair may not relax immutable %s constraints',
    async (field) => {
      const repaired =
        field === 'modality'
          ? { ...plan('CROSSFIT', 4), modality: 'RUNNING' as const }
          : plan('CROSSFIT', 5);
      const s = await subject('Monte um treino de Crossfit 4x', [
        plan('CROSSFIT', 4, true),
        repaired,
      ]);
      await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
        field === 'modality' ? 'MODALITY_MISMATCH' : 'SESSION_COUNT_MISMATCH',
      );
      expect(s.job()?.status).toBe('FAILED');
      expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(2);
    },
  );
  it('unknown optional facts remain unknown and the original request nuance survives intact', async () => {
    const text =
      'Quero um CrossFit 4 vezes por semana, mas estou voltando agora e quero algo mais técnico do que intenso';
    const s = await subject(text, [plan('CROSSFIT', 4)], {
      experienceLevel: unknownDatum(),
      environment: unknownDatum(),
      availableEquipment: unknownDatum(),
      sessionDurationMinutes: unknownDatum(),
    });
    const result = await s.engine.generateCandidate(s.input);
    expect(result.output.modality).toBe('CROSSFIT');
    const payload = JSON.parse(
      s.gateway.createTextResponse.mock.calls[0][0].input,
    ) as Record<string, unknown>;
    expect(payload.currentRequest).toMatchObject({ text });
    expect(payload.context).toMatchObject({
      training: {
        experience: { status: 'NOT_SET' },
        environment: { status: 'NOT_SET' },
        perceivedConditioning: { status: 'NOT_SET' },
        sessionDurationMinutes: { status: 'NOT_SET' },
      },
    });
    expect(payload.strategy).toMatchObject({
      authorizedEquipment: ['BODYWEIGHT'],
      technicalMovementsAllowed: false,
    });
  });
  it('rejects a prepared context from another input before the provider', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    const prepared = s.engine.prepare(s.input);
    await expect(
      s.engine.generateCandidate({ ...s.input }, prepared),
    ).rejects.toThrow('does not belong');
    expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'A/C: restart retrieves the durable %s response without another create',
    async (repair) => {
      const s = await subject(
        'Monte um treino de Crossfit 4x',
        repair
          ? [plan('CROSSFIT', 4, true), plan('CROSSFIT', 4)]
          : [plan('CROSSFIT', 4)],
      );
      const retrieve = s.gateway.retrieveTextResponse.getMockImplementation();
      if (!retrieve) throw new Error('Expected provider retrieval');
      if (repair)
        s.gateway.retrieveTextResponse.mockImplementationOnce(retrieve);
      s.gateway.retrieveTextResponse.mockRejectedValueOnce(
        new Error('Worker lost before completion'),
      );
      await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
        DurableTextPendingError,
      );
      const durable = durableTextOperation(s.job()?.result);
      expect(durable?.attempts.at(-1)?.responseId).toBe(
        repair ? 'response-1' : 'response-0',
      );
      expect(s.job()?.status).toBe('PROCESSING');
      const resumed = await s.engine.generateCandidate(s.input);
      await s.complete(resumed);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(
        repair ? 2 : 1,
      );
      expect(s.usageRows[0]?.totalTokens).toBe(repair ? 242 : 120);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
    },
  );
  it('B: initial usage committed before validation is not charged again on restart', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    const validation = jest
      .spyOn(WorkoutPlanV2Validator.prototype, 'validate')
      .mockImplementationOnce(() => {
        throw new DurableTextPendingError();
      });
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      DurableTextPendingError,
    );
    validation.mockRestore();
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    const job = s.job();
    if (!job) throw new Error('Expected job');
    job.leaseExpiresAt = new Date(0);
    await s.complete(await s.engine.generateCandidate(s.input));
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
  });
  it.each(['unchanged-model', 'unproven-alias'])(
    'recovers a legacy ledger and authorizes new repair only with proven identity: %s',
    async (configured) => {
      const s = await subject('Monte um treino de Crossfit 4x', [
        plan('CROSSFIT', 4, true),
        plan('CROSSFIT', 4),
      ]);
      s.gateway.retrieveTextResponse.mockRejectedValueOnce(
        new Error('Restart after response ID'),
      );
      await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
        DurableTextPendingError,
      );
      const job = s.job();
      const ledger = durableTextOperation(job?.result);
      if (!job || !ledger) throw new Error('Expected durable job');
      delete ledger.attempts[0].requestedModel;
      job.result = JSON.parse(
        JSON.stringify({ durableTextOperation: ledger }),
      ) as Prisma.JsonObject;
      job.leaseExpiresAt = new Date(0);
      s.gateway.getRequestedTextModel.mockReturnValue(configured);
      if (configured === 'unchanged-model') {
        await s.complete(await s.engine.generateCandidate(s.input));
        expect(s.usageRows[0].totalTokens).toBe(242);
        expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
      } else {
        await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
          'Legacy durable repair requested model identity unavailable',
        );
        expect(s.usageRows[0].totalTokens).toBe(120);
        expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      }
      expect(
        durableTextOperation(s.job()?.result)?.attempts[0].responseId,
      ).toBe('response-0');
    },
  );
  it('D: a rolled-back repair usage transaction is recorded once on replay', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    s.tx.aIUsage.updateMany.mockRejectedValueOnce(
      new Error('Crash before commit'),
    );
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      DurableTextPendingError,
    );
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    const state = durableTextOperation(s.job()?.result);
    expect(state?.attempts[1]?.response?.totalTokens).toBe(122);
    expect(state?.attempts[1]?.usageRecorded).toBe(false);
    const job = s.job();
    if (!job) throw new Error('Expected job');
    job.leaseExpiresAt = new Date(0);
    await s.complete(await s.engine.generateCandidate(s.input));
    expect(s.usageRows[0]?.totalTokens).toBe(242);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
  });
  it('E: lost commit ACK does not sum committed repair usage twice', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    const transaction = s.prisma.$transaction;
    let interrupted = false;
    jest
      .spyOn(s.prisma, '$transaction')
      .mockImplementation(async (operation) => {
        const result = await transaction(operation);
        if (
          !interrupted &&
          durableTextOperation(s.job()?.result)?.attempts[1]?.usageRecorded
        ) {
          interrupted = true;
          throw new Error('Crash after commit');
        }
        return result;
      });
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      DurableTextPendingError,
    );
    expect(s.usageRows[0]?.totalTokens).toBe(242);
    const job = s.job();
    if (!job) throw new Error('Expected job');
    job.leaseExpiresAt = new Date(0);
    await s.complete(await s.engine.generateCandidate(s.input));
    expect(s.usageRows).toHaveLength(1);
    expect(s.usageRows[0]?.totalTokens).toBe(242);
    expect(s.usageRows[0]?.estimatedCost.toString()).toBe('0.000566');
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
  });
  it('model mismatch fails terminally and keeps both actual usages for reconciliation without fabricating cost', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    const generation = s.gateway.createTextResponse.getMockImplementation();
    if (!generation) throw new Error('Expected provider generation');
    s.gateway.createTextResponse
      .mockImplementationOnce(generation)
      .mockImplementationOnce(async (request) => ({
        ...(await generation(request)),
        model: 'unsupported-model',
      }));
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'model mismatch',
    );
    expect(s.job()?.status).toBe('FAILED');
    expect(s.job()?.leaseExpiresAt).toBeNull();
    const state = durableTextOperation(s.job()?.result);
    expect(state?.accountingIssue).toBe('MODEL_MISMATCH');
    expect(
      state?.attempts.map((attempt) => attempt.response?.totalTokens),
    ).toEqual([120, 122]);
    expect(state?.attempts[1]?.usageRecorded).toBe(false);
    expect(s.usageRows[0]?.model).toBe('unchanged-model');
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    expect(s.reversed).toHaveBeenCalledTimes(1);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
  });
  it('bounds polling and resumes an in-progress Response without creating another generation', async () => {
    jest.useFakeTimers();
    try {
      const s = await subject('Monte um treino de Crossfit 4x', [
        plan('CROSSFIT', 4),
      ]);
      const retrieve = s.gateway.retrieveTextResponse.getMockImplementation();
      if (!retrieve) throw new Error('Expected retrieval');
      s.gateway.retrieveTextResponse.mockResolvedValue({
        responseId: 'response-0',
        status: 'in_progress',
      });
      const pending = expect(
        s.engine.generateCandidate(s.input),
      ).rejects.toBeInstanceOf(DurableTextPendingError);
      await jest.runAllTimersAsync();
      await pending;
      expect(
        s.gateway.retrieveTextResponse.mock.calls.length,
      ).toBeLessThanOrEqual(61);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      s.gateway.retrieveTextResponse.mockImplementation(retrieve);
      await s.complete(await s.engine.generateCandidate(s.input));
      expect(s.job()?.providerResponseId).toBe('response-0');
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('preserves both response identities durably and uses the accepted repair ID as scalar', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4, true),
      plan('CROSSFIT', 4),
    ]);
    const result = await s.engine.generateCandidate(s.input);
    const before = durableTextOperation(s.job()?.result);
    expect(before?.attempts.map((attempt) => attempt.responseId)).toEqual([
      'response-0',
      'response-1',
    ]);
    expect(before?.attempts.every((attempt) => attempt.usageRecorded)).toBe(
      true,
    );
    expect(before?.attempts.map((attempt) => attempt.attemptKey)).toEqual([
      result.operationKey + ':attempt:1',
      result.operationKey + ':attempt:2',
    ]);
    await s.complete(result);
    expect(s.job()?.providerResponseId).toBe('response-1');
    expect(
      durableTextOperation(s.job()?.result)?.attempts.map(
        (attempt) => attempt.responseId,
      ),
    ).toEqual(['response-0', 'response-1']);
  });
  it('accounts usage on a terminal incomplete Response and never starts repair', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    s.gateway.retrieveTextResponse.mockImplementationOnce((responseId) =>
      Promise.resolve({
        responseId,
        status: 'incomplete',
        result: {
          responseId,
          model: 'unchanged-model',
          outputText: '',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      }),
    );
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Background response failed',
    );
    expect(s.job()?.status).toBe('FAILED');
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(s.reversed).toHaveBeenCalledTimes(1);
  });
  it('never retries an ambiguous create when there is no durable provider response identity', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    s.gateway.startBackgroundTextResponse.mockRejectedValueOnce(
      new Error('Create acknowledgement lost'),
    );
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Create acknowledgement lost',
    );
    expect(
      durableTextOperation(s.job()?.result)?.attempts[0]?.attemptKey,
    ).toContain(':attempt:1');
    expect(s.job()?.status).toBe('FAILED');
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
  });
  it('cancels a Response past its deadline, accounts terminal usage and never regenerates', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    s.gateway.retrieveTextResponse.mockRejectedValueOnce(
      new Error('Worker restart'),
    );
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      DurableTextPendingError,
    );
    const state = durableTextOperation(s.job()?.result);
    const job = s.job();
    if (!state || !job) throw new Error('Expected durable job');
    state.deadlineAt = new Date(0).toISOString();
    job.result = JSON.parse(
      JSON.stringify({ durableTextOperation: state }),
    ) as Prisma.JsonValue;
    s.gateway.retrieveTextResponse
      .mockResolvedValueOnce({
        responseId: 'response-0',
        status: 'in_progress',
      })
      .mockResolvedValueOnce({
        responseId: 'response-0',
        status: 'cancelled',
        result: {
          responseId: 'response-0',
          model: 'unchanged-model',
          outputText: '',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      });
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Background response failed',
    );
    expect(s.gateway.cancelTextResponse).toHaveBeenCalledTimes(1);
    expect(s.gateway.cancelTextResponse).toHaveBeenCalledWith('response-0');
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(s.usageRows[0]?.totalTokens).toBe(120);
    expect(s.job()?.status).toBe('FAILED');
  });
});
