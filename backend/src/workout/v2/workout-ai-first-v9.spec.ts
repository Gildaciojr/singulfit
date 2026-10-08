import { ConfigService } from '@nestjs/config';
import { WorkoutApplicationExecutorService } from './execution/workout-application-executor.service';
import { WorkoutAsyncCompletionService } from '../../automation/workout-async-completion.service';
import { CoachPlanningExecutionService } from '../../automation/coach-planning-execution.service';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import { WorkoutPlanV2StoredDocumentParser } from './workout-plan-v2-stored-document.parser';
import { EventHandlerRegistry } from '../../event-bus/event-handler.registry';
import { OutboxDispatcherService } from '../../event-bus/outbox-dispatcher.service';
import { INTERNAL_EVENT } from '../../event-bus/event-bus.constants';
import { AIRecoveryService } from '../../ai/ai-recovery.service';
import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { AIJobStatus, AIJobType, FitnessGoal, Prisma } from '@prisma/client';
import { WorkoutPlanV2PersistenceService } from './persistence/workout-plan-v2-persistence.service';
import { WorkoutPlanV2PersistenceValidator } from './persistence/workout-plan-v2-persistence.validator';
import type {
  CreateWorkoutPlanV2Record,
  PersistedWorkoutPlanRecord,
} from './persistence/workout-plan-v2.repository';
import { AIService } from '../../ai/ai.service';
import { OpenAIGateway } from '../../ai/openai.gateway';
import { WORKOUT_V10_QUALITY_CORPUS } from './workout-v10-quality-corpus.fixtures';
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
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V10,
  WORKOUT_PLANNING_V2_PROMPT_V11,
} from './workout-planning-v2.prompt.definition';
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
  promptVersion:
    | typeof prompt
    | ((
        | typeof WORKOUT_PLANNING_V2_PROMPT_V9
        | typeof WORKOUT_PLANNING_V2_PROMPT_V10
        | typeof WORKOUT_PLANNING_V2_PROMPT_V11
      ) & { id: string; prompt: string });
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
                      publicIdentity: {
                        plane: 'SAGITTAL' as const,
                        targetRegion: 'HIPS' as const,
                        bodyPosition: 'STANDING' as const,
                        jointAction: 'FLEXION' as const,
                      },
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
                      publicIdentity: {
                        plane: 'SAGITTAL' as const,
                        targetRegion: 'WHOLE_BODY' as const,
                        bodyPosition: 'STANDING' as const,
                        jointAction: 'EXTENSION' as const,
                      },
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
        weekday: (
          [
            'MONDAY',
            'WEDNESDAY',
            'FRIDAY',
            'SUNDAY',
            'TUESDAY',
            'THURSDAY',
            'SATURDAY',
          ] as const
        )[index],
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
              : activity.kind === 'STRENGTH'
                ? {
                    ...activity,
                    prescription: {
                      execution: {
                        kind: 'COUNT' as const,
                        minimum: 8,
                        maximum: 12,
                        perSide: false,
                        alternating: false,
                      },
                      load: null,
                      effort: null,
                      enduranceMetrics: [],
                    },
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
  availableDays: readonly string[] = [],
  requestId: string | null = 'request-id',
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
    routine: {
      ...base.routine,
      ...(availableDays.length
        ? { availableTrainingDays: knownDatum(availableDays) }
        : {}),
    },
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
        requestId: requestId ?? undefined,
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
    findFirst: jest.fn(
      (query: { where?: { operationKey?: string; type?: AIJobType } }) =>
        Promise.resolve(
          job &&
            (!query.where?.operationKey ||
              query.where.operationKey === job.operationKey) &&
            (query.where?.type === AIJobType.WORKOUT ||
              ['PENDING', 'PROCESSING'].includes(job.status))
            ? job
            : null,
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
          job &&
          Array.isArray(query.where.OR) &&
          !query.where.OR.some((branch) => {
            if (branch.status === AIJobStatus.PENDING)
              return job?.status === AIJobStatus.PENDING;
            if (
              branch.status !== AIJobStatus.PROCESSING ||
              job?.status !== AIJobStatus.PROCESSING ||
              !job.leaseExpiresAt
            )
              return false;
            const lease = branch.leaseExpiresAt;
            return (
              !!lease &&
              typeof lease === 'object' &&
              'lte' in lease &&
              lease.lte instanceof Date &&
              job.leaseExpiresAt <= lease.lte
            );
          })
        )
          return Promise.resolve({ count: 0 });
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
        expect(request.instructions).toBe(
          job?.promptVersion.prompt ?? prompt.instructions,
        );
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
    { publish: jest.fn().mockResolvedValue({}) } as never,
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
  it.each([
    { repair: false, expired: false, terminal: false },
    { repair: true, expired: false, terminal: false },
    { repair: false, expired: true, terminal: false },
    { repair: false, expired: true, terminal: true },
    { repair: false, expired: false, terminal: false, transient: true },
    {
      repair: false,
      expired: false,
      terminal: false,
      persistenceTerminal: true,
    },
    {
      repair: false,
      expired: false,
      terminal: false,
      transient: true,
      synchronous: true,
    },
  ])(
    'completes the same asynchronous V11 request and delivers once after restart: %j',
    async ({
      repair,
      expired,
      terminal,
      transient = false,
      synchronous = false,
      persistenceTerminal = false,
    }) => {
      const s = await subject(
        'Monte um treino de Crossfit 4x',
        repair
          ? [plan('CROSSFIT', 4, true), plan('CROSSFIT', 4)]
          : [plan('CROSSFIT', 4)],
      );
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
            s.prisma.$transaction((tx) => operation(tx as never)) as Promise<T>,
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
      const executor = new WorkoutApplicationExecutorService(
        s.engine,
        persistence,
      );
      const failCandidate = jest.spyOn(s.engine, 'failCandidate');
      const transientError = new Prisma.PrismaClientKnownRequestError(
        'Database unavailable',
        { code: 'P1001', clientVersion: '5.22.0' },
      );
      if (synchronous)
        jest
          .spyOn(persistence, 'persist')
          .mockRejectedValueOnce(transientError);
      const applicationInput = {
        generationInput: s.input,
        ownership: { userId: s.input.userId, profileId: 'profile' },
        executionContext: {
          correlationId: 'correlation-id',
          sourceMessageId: 'collector-answer-id',
        },
      };
      const retrieve = s.gateway.retrieveTextResponse.getMockImplementation();
      if (!retrieve) throw new Error('Missing provider GET');
      if (!synchronous)
        s.gateway.retrieveTextResponse.mockResolvedValueOnce({
          responseId: 'response-0',
          status: 'in_progress',
        });
      const enqueue = jest.spyOn(s.ai, 'enqueueWorkoutCompletion');
      if (synchronous) {
        const coach = new CoachPlanningExecutionService(
          {
            dispatchStructured: () => executor.execute(applicationInput),
          } as never,
          { build: () => Promise.resolve(s.input.snapshot) } as never,
          {
            adapt: () => ({
              recognizedIntent: 'WORKOUT_PLAN_REQUEST',
              planTarget: 'WORKOUT',
              acquisitionIntent: {},
            }),
          } as never,
          { decide: () => ({ shouldAsk: false }) } as never,
          { plan: () => s.input.decision } as never,
        );
        const currentMessage = s.input.currentRequest?.text;
        if (!currentMessage)
          throw new Error('Missing explicit fixture request');
        Object.defineProperty(coach, 'prisma', {
          value: {
            message: {
              findFirst: ({
                where,
              }: {
                where: { id: string; conversation: { userId: string } };
              }) =>
                Promise.resolve(
                  where.id === 'collector-answer-id' &&
                    where.conversation.userId === s.input.userId
                    ? {
                        content: currentMessage,
                        timestamp: s.input.referenceDate,
                      }
                    : null,
                ),
            },
          },
        });
        const response = await coach.executeStructured(
          s.input.userId,
          'WORKOUT',
          {
            conversationId: 'conversation-id',
            messageId: 'collector-answer-id',
            correlationId: 'correlation-id',
            currentMessage,
            referenceDate: s.input.referenceDate,
          },
        );
        expect(response.responseRequired).toBe(false);
        expect(response.content).toBe('');
        expect(response.dispatch.fallbackApplied).toBe(false);
      } else {
        await expect(
          executor.execute(applicationInput, { pollWindowMs: 0 }),
        ).rejects.toBeInstanceOf(DurableTextPendingError);
      }
      expect(s.job()?.status).toBe(AIJobStatus.PROCESSING);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(s.job()?.id);
      expect(create).not.toHaveBeenCalled();
      expect(failCandidate).not.toHaveBeenCalled();
      const originalJobId = s.job()?.id;
      if (synchronous) {
        expect(s.reversed).not.toHaveBeenCalled();
        const job = s.job();
        if (!job) throw new Error('Expected job');
        job.leaseExpiresAt = new Date(0);
      }
      if (expired) {
        const job = s.job();
        const state = durableTextOperation(job?.result);
        if (!job || !state) throw new Error('Expected durable state');
        state.deadlineAt = new Date(Date.now() - 1).toISOString();
        job.result = JSON.parse(
          JSON.stringify({ durableTextOperation: state }),
        ) as Prisma.JsonValue;
      }
      const deliveries = new Map<string, string>();
      const commands = {
        deliverWorkoutCompletion: jest.fn(
          (input: { aiJobId: string; content: string }) => {
            if (!deliveries.has(input.aiJobId))
              deliveries.set(input.aiJobId, input.content);
            return Promise.resolve();
          },
        ),
      };
      const prisma = {
        ...s.prisma,
        message: {
          findFirst: jest.fn().mockResolvedValue({ id: 'request-id' }),
        },
        aIJob: {
          ...s.jobStore,
          findMany: jest.fn(() => Promise.resolve([s.job()])),
        },
      };
      const now = new Date();
      const recovery = new AIRecoveryService(
        prisma as never,
        {} as never,
        {} as never,
        s.ai,
      );
      await expect(recovery.recover(now)).resolves.toBe(1);
      expect(s.gateway.retrieveTextResponse).toHaveBeenCalledTimes(1);
      const event = {
        id: 'completion',
        eventType: INTERNAL_EVENT.WORKOUT_ASYNC_COMPLETION,
        aggregateType: 'AI_JOB',
        aggregateId: s.job()!.id,
        payload: { aiJobId: s.job()!.id },
        status: OutboxStatus.PROCESSING,
        attempts: 1,
        availableAt: now,
        claimedAt: now,
        processedAt: null,
        failedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      } satisfies OutboxEvent;
      const resume = () =>
        new WorkoutAsyncCompletionService(
          prisma as never,
          executor,
          new WorkoutPlanV2Formatter(),
          commands as never,
          new EventHandlerRegistry(),
        );
      if (!synchronous) {
        s.gateway.retrieveTextResponse.mockResolvedValueOnce({
          responseId: 'response-0',
          status: 'in_progress',
        });
        await expect(resume().complete(event)).rejects.toBeInstanceOf(
          DurableTextPendingError,
        );
      }
      expect(deliveries.size).toBe(0);
      expect(create).not.toHaveBeenCalled();
      if (terminal) {
        s.gateway.retrieveTextResponse.mockResolvedValueOnce({
          responseId: 'response-0',
          status: 'cancelled',
        });
        await resume().complete(event);
        await resume().complete(event);
        expect(s.job()?.status).toBe(AIJobStatus.FAILED);
        expect(create).not.toHaveBeenCalled();
        expect(deliveries.size).toBe(1);
        expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
        expect(s.reserved).toHaveBeenCalledTimes(1);
        expect(s.reversed).toHaveBeenCalledTimes(1);
        expect(s.confirmed).not.toHaveBeenCalled();
        return;
      }
      s.gateway.retrieveTextResponse.mockImplementation(retrieve);
      if (persistenceTerminal) {
        jest.spyOn(persistence, 'persist').mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Invalid foreign key', {
            code: 'P2003',
            clientVersion: '5.22.0',
          }),
        );
        await resume().complete(event);
        await resume().complete(event);
        expect(failCandidate).toHaveBeenCalledTimes(1);
        expect(s.job()?.status).toBe(AIJobStatus.FAILED);
        expect(s.job()?.startedAt).toBeInstanceOf(Date);
        expect(s.job()?.leaseExpiresAt).toBeNull();
        expect(
          durableTextOperation(s.job()?.result)?.attempts[0].responseId,
        ).toBe('response-0');
        expect(create).not.toHaveBeenCalled();
        expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
        expect(deliveries.size).toBe(1);
        expect(s.usageRows).toHaveLength(1);
        expect(s.reserved).toHaveBeenCalledTimes(1);
        expect(s.reversed).toHaveBeenCalledTimes(1);
        expect(s.confirmed).not.toHaveBeenCalled();
        return;
      }
      if (repair) {
        s.gateway.retrieveTextResponse
          .mockImplementationOnce(retrieve)
          .mockResolvedValueOnce({
            responseId: 'response-1',
            status: 'in_progress',
          });
        await expect(resume().complete(event)).rejects.toBeInstanceOf(
          DurableTextPendingError,
        );
        expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
        expect(deliveries.size).toBe(0);
      }
      if (transient) {
        const registry = new EventHandlerRegistry();
        registry.register(INTERNAL_EVENT.WORKOUT_ASYNC_COMPLETION, (e) =>
          resume().complete(e),
        );
        const outbox = {
          claimBatch: jest.fn().mockResolvedValue([event]),
          markFailed: jest.fn().mockResolvedValue(true),
          markProcessed: jest.fn().mockResolvedValue(true),
          deferWorkoutCompletion: jest.fn(),
        };
        const dispatcher = new OutboxDispatcherService(
          outbox as never,
          registry,
        );
        if (!synchronous) {
          jest
            .spyOn(persistence, 'persist')
            .mockRejectedValueOnce(transientError);
          await dispatcher.drain();
          expect(outbox.markFailed).toHaveBeenCalledWith(event, transientError);
          expect(outbox.markProcessed).not.toHaveBeenCalled();
          expect(outbox.deferWorkoutCompletion).not.toHaveBeenCalled();
          expect(failCandidate).not.toHaveBeenCalled();
          expect(s.job()?.status).toBe(AIJobStatus.PROCESSING);
          expect(s.reversed).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
          const job = s.job();
          if (!job) throw new Error('Expected job');
          job.leaseExpiresAt = new Date(0);
        }
        await dispatcher.drain();
        expect(outbox.markProcessed).toHaveBeenCalledTimes(1);
        expect(s.job()?.id).toBe(originalJobId);
        expect(s.jobStore.create).toHaveBeenCalledTimes(1);
        expect(s.job()?.providerResponseId).toBe('response-0');
        expect(deliveries.size).toBe(1);
      } else {
        commands.deliverWorkoutCompletion.mockRejectedValueOnce(
          new Error('Outbound queue unavailable'),
        );
        await expect(resume().complete(event)).rejects.toThrow(
          'Outbound queue unavailable',
        );
        expect(s.job()?.status).toBe(AIJobStatus.COMPLETED);
        expect(create).toHaveBeenCalledTimes(1);
        expect(deliveries.size).toBe(0);
      }
      const concurrent = await Promise.allSettled([
        resume().complete(event),
        resume().complete(event),
      ]);
      expect(concurrent.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );
      for (const result of concurrent)
        if (result.status === 'rejected')
          expect(result.reason).toBeInstanceOf(DurableTextPendingError);
      await resume().complete(event);
      expect(s.job()?.status).toBe(AIJobStatus.COMPLETED);
      expect(create).toHaveBeenCalledTimes(1);
      expect(deliveries.size).toBe(1);
      expect(commands.deliverWorkoutCompletion).toHaveBeenLastCalledWith(
        expect.objectContaining({ messageId: 'collector-answer-id' }),
      );
      expect([...deliveries.values()][0]).not.toContain('Tive uma falha');
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(
        repair ? 2 : 1,
      );
      expect(s.gateway.retrieveTextResponse).toHaveBeenCalledWith('response-0');
      if (repair)
        expect(s.gateway.retrieveTextResponse).toHaveBeenCalledWith(
          'response-1',
        );
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.usageRows).toHaveLength(1);
      expect(s.reversed).not.toHaveBeenCalled();
    },
  );
  async function seedHistoricalJob(
    s: Awaited<ReturnType<typeof subject>>,
    version: 9 | 10 | 11 = 9,
  ) {
    const definition =
      version === 9
        ? WORKOUT_PLANNING_V2_PROMPT_V9
        : version === 10
          ? WORKOUT_PLANNING_V2_PROMPT_V10
          : WORKOUT_PLANNING_V2_PROMPT_V11;
    const prepared = s.engine.prepare({
      ...s.input,
      recognizedContext:
        version === 9
          ? (s.input.legacyV9RecognizedContext ?? s.input.recognizedContext)
          : s.input.recognizedContext,
    });
    function canonical(value: unknown): string {
      if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(',')}}`;
    }
    const identity = s.input.currentRequest?.requestId
      ? `request:${s.input.currentRequest.requestId}`
      : canonical({
          schemaVersion: 2,
          currentRequest: s.input.currentRequest ?? { text: '' },
          context: prepared.context,
          strategy: prepared.strategy
            ? {
                ...prepared.strategy,
                intensityPolicy: {
                  ...prepared.strategy.intensityPolicy,
                  exactLoadAllowed: false,
                  exactPaceAllowed: false,
                  exactPowerAllowed: false,
                  exactHeartRateAllowed: undefined,
                },
              }
            : null,
          safetyPolicy: {
            noDiagnosis: true,
            noRehabilitation: true,
            noExactLoad: true,
            noExactPace: true,
            noExactPower: true,
          },
        });
    const revision =
      version === 9
        ? 'ai-first-v9-bounded-repair-v1'
        : 'ai-first-v10-weekday-v1';
    const operationKey = `workout-planning-v2:${createHash('sha256').update(`${s.input.userId}:${version}:${revision}:${identity}`).digest('hex')}`;
    await s.ai.createStandaloneJob({
      userId: s.input.userId,
      type: AIJobType.WORKOUT,
      promptName: definition.name,
      operationKey,
      usageEntitlementCode: 'WORKOUT_PLAN_GENERATION',
    });
    const job = s.job();
    if (!job) throw new Error('Missing historical job');
    job.promptVersion = {
      ...definition,
      id: `v${version}`,
      prompt: definition.instructions,
    };
    return job;
  }
  function historicalCandidate() {
    const candidate = plan('CROSSFIT', 3);
    return {
      ...candidate,
      sessions: candidate.sessions.map((session) => {
        const legacy = { ...session };
        delete legacy.weekday;
        legacy.blocks = legacy.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) => {
            const historical = { ...activity };
            delete historical.publicIdentity;
            delete historical.prescription;
            return historical;
          }),
        }));
        return legacy;
      }),
    };
  }
  it.each([null, 'request-id'])(
    'reuses an authentic completed V9 lifecycle with requestId=%s',
    async (requestId) => {
      const s = await subject(
        'Monte Crossfit 3x, segunda, quarta e sexta',
        [historicalCandidate()],
        {},
        [],
        [],
        requestId,
      );
      const job = await seedHistoricalJob(s);
      const first = await s.engine.generateCandidate(s.input);
      expect(first.aiJobId).toBe(job.id);
      expect(first.operationKey).toBe(job.operationKey);
      await s.complete(first);
      const replay = await s.engine.generateCandidate(s.input);
      expect(replay.status).toBe('ALREADY_COMPLETED');
      expect(replay.aiJobId).toBe(job.id);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.jobStore.create).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
    },
  );
  it.each([9, 10, 11] as const)(
    'generates and replays legacy V%s strength without V12 execution fields',
    async (version) => {
      const legacy = plan('GYM_STRENGTH', 3);
      const candidate = {
        ...legacy,
        sessions: legacy.sessions.map((session) => ({
          ...session,
          blocks: session.blocks.map((block) => ({
            ...block,
            activities: block.activities.map((activity) => {
              const historical = { ...activity };
              delete historical.prescription;
              return historical;
            }),
          })),
        })),
      };
      const s = await subject('Monte musculação 3x', [candidate]);
      const job = await seedHistoricalJob(s, version);
      const generated = await s.engine.generateCandidate(s.input);
      expect(generated.aiJobId).toBe(job.id);
      await s.complete(generated);
      const replay = await s.engine.generateCandidate(s.input);
      expect(replay.aiJobId).toBe(job.id);
      expect(replay.status).toBe('ALREADY_COMPLETED');
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    },
  );
  it('recovers the same PROCESSING V9 job without requestId and retrieves the existing provider response', async () => {
    const s = await subject(
      'Monte Crossfit 3x, segunda, quarta e sexta',
      [historicalCandidate()],
      {},
      [],
      [],
      null,
    );
    const job = await seedHistoricalJob(s);
    s.gateway.retrieveTextResponse.mockRejectedValueOnce(
      new Error('Lost poll ACK'),
    );
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      DurableTextPendingError,
    );
    expect(s.job()?.status).toBe('PROCESSING');
    const recovered = await s.engine.generateCandidate(s.input);
    expect(recovered.aiJobId).toBe(job.id);
    expect(recovered.operationKey).toBe(job.operationKey);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(s.reserved).toHaveBeenCalledTimes(1);
  });
  it('keeps FAILED V9 terminal without requestId', async () => {
    const s = await subject(
      'Monte Crossfit 3x, segunda, quarta e sexta',
      [],
      {},
      [],
      [],
      null,
    );
    const job = await seedHistoricalJob(s);
    job.status = AIJobStatus.FAILED;
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.startBackgroundTextResponse).not.toHaveBeenCalled();
    expect(s.jobStore.create).toHaveBeenCalledTimes(1);
  });
  it.each([null, 'request-id'])(
    'preserves V11 operation identity, provider response and accounting across V12 rollout with requestId=%s',
    async (requestId) => {
      const s = await subject(
        'Monte musculação 3x',
        [plan('GYM_STRENGTH', 3)],
        {},
        [],
        [],
        requestId,
      );
      const job = await seedHistoricalJob(s, 11);
      s.gateway.retrieveTextResponse.mockRejectedValueOnce(
        new Error('Lost V11 poll ACK'),
      );
      await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
        DurableTextPendingError,
      );
      const recovered = await s.engine.generateCandidate(s.input);
      expect(recovered.aiJobId).toBe(job.id);
      expect(recovered.operationKey).toBe(job.operationKey);
      expect(
        s.gateway.startBackgroundTextResponse.mock.calls[0][0].instructions,
      ).toBe(WORKOUT_PLANNING_V2_PROMPT_V11.instructions);
      await s.complete(recovered);
      expect((await s.engine.generateCandidate(s.input)).status).toBe(
        'ALREADY_COMPLETED',
      );
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.jobStore.create).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps a terminal FAILED V11 instead of creating a V12 job', async () => {
    const s = await subject('Monte musculação 3x', []);
    const job = await seedHistoricalJob(s, 11);
    job.status = AIJobStatus.FAILED;
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.startBackgroundTextResponse).not.toHaveBeenCalled();
    expect(s.jobStore.create).toHaveBeenCalledTimes(1);
  });
  it('uses V12 for a new no-requestId operation when historical V10/V9 are absent', async () => {
    const s = await subject(
      'Monte Crossfit 3x, segunda, quarta e sexta',
      [plan('CROSSFIT', 3)],
      {},
      [],
      [],
      null,
    );
    await s.engine.generateCandidate(s.input);
    expect(s.job()?.promptVersion).toMatchObject({
      version: 12,
      name: 'workout_planning_v2_v12',
    });
    expect(s.reserved).toHaveBeenCalledTimes(1);
  });
  it.each([null, 'request-id'])(
    'reuses the authentic V10 operation identity and completed replay with requestId=%s',
    async (requestId) => {
      const s = await subject(
        'Monte musculação 3x',
        [plan('GYM_STRENGTH', 3)],
        {},
        [],
        [],
        requestId,
      );
      const job = await seedHistoricalJob(s, 10);
      const generated = await s.engine.generateCandidate(s.input);
      expect(generated.aiJobId).toBe(job.id);
      expect(generated.operationKey).toBe(job.operationKey);
      expect(
        s.gateway.startBackgroundTextResponse.mock.calls[0][0].instructions,
      ).toBe(WORKOUT_PLANNING_V2_PROMPT_V10.instructions);
      await s.complete(generated);
      const replay = await s.engine.generateCandidate(s.input);
      expect(replay.status).toBe('ALREADY_COMPLETED');
      expect(replay.operationKey).toBe(job.operationKey);
      expect(replay.aiJobId).toBe(job.id);
      expect(job.promptVersion.name).toBe(WORKOUT_PLANNING_V2_PROMPT_V10.name);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.jobStore.create).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, 'request-id'])(
    'recovers the same PROCESSING V10 provider response without a duplicate call with requestId=%s',
    async (requestId) => {
      const s = await subject(
        'Monte musculação 3x',
        [plan('GYM_STRENGTH', 3)],
        {},
        [],
        [],
        requestId,
      );
      const job = await seedHistoricalJob(s, 10);
      s.gateway.retrieveTextResponse.mockRejectedValueOnce(
        new Error('Lost V10 poll ACK'),
      );
      await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
        DurableTextPendingError,
      );
      expect(job.status).toBe('PROCESSING');
      const recovered = await s.engine.generateCandidate(s.input);
      expect(recovered.aiJobId).toBe(job.id);
      expect(recovered.operationKey).toBe(job.operationKey);
      await s.complete(recovered);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.jobStore.create).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps a matching FAILED V10 terminal instead of creating V11', async () => {
    const s = await subject('Monte musculação 3x', []);
    const job = await seedHistoricalJob(s, 10);
    job.status = AIJobStatus.FAILED;
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'já falhou',
    );
    expect(s.gateway.startBackgroundTextResponse).not.toHaveBeenCalled();
    expect(s.reserved).toHaveBeenCalledTimes(1);
    expect(s.confirmed).not.toHaveBeenCalled();
    expect(s.jobStore.create).toHaveBeenCalledTimes(1);
  });
  it.each(['PUBLIC_IDENTITY_REQUIRED', 'PUBLIC_IDENTITY_INCOMPLETE'] as const)(
    'repairs %s once through the durable provider with accounting once',
    async (code) => {
      const valid = plan('CROSSFIT', 3);
      const invalid = {
        ...valid,
        sessions: valid.sessions.map((session) => ({
          ...session,
          blocks: session.blocks.map((block) => ({
            ...block,
            activities: block.activities.map((activity) =>
              activity.kind === 'ENDURANCE'
                ? activity
                : {
                    ...activity,
                    movementPattern: 'OTHER' as const,
                    publicIdentity:
                      code === 'PUBLIC_IDENTITY_REQUIRED'
                        ? null
                        : {
                            plane: 'SAGITTAL' as const,
                            targetRegion: 'HIPS' as const,
                            bodyPosition: 'STANDING' as const,
                            jointAction: null,
                          },
                  },
            ),
          })),
        })),
      };
      const s = await subject('Monte Crossfit 3x', [invalid, valid]);
      const generated = await s.engine.generateCandidate(s.input);
      expect(
        JSON.stringify(s.gateway.createTextResponse.mock.calls[1][0].input),
      ).toContain(code);
      await s.complete(generated);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['CROSSFIT', 'GYM_STRENGTH'] as const)(
    'reconciles real V12 null prescriptions in %s 4x, then replays without another provider call',
    async (modality) => {
      const base = plan(modality, 4);
      const candidate = {
        ...base,
        sessions: base.sessions.map((session, index) => ({
          ...session,
          blocks: session.blocks.map((block, blockIndex) => ({
            ...block,
            activities:
              blockIndex === 0
                ? [
                    {
                      activityKey: `${session.sessionKey}-real-walk`,
                      kind: 'TIMED' as const,
                      name:
                        index % 2
                          ? 'Corrida ao ar livre'
                          : 'Caminhada progressiva na esteira',
                      source: 'MODEL_GENERATED' as const,
                      movementPattern: 'LOCOMOTION' as const,
                      equipment: index % 2 ? [] : ['TREADMILL' as const],
                      publicIdentity: null,
                      instruction:
                        'Ajuste o ritmo gradualmente e mantenha passadas confortáveis.',
                      alerts: [],
                      appliedConstraintCodes: [],
                      durationSeconds: modality === 'CROSSFIT' ? 360 : 600,
                      workSeconds: null,
                      recoverySeconds: null,
                      rounds: 1,
                      intensity: 'LIGHT' as const,
                      prescription: {
                        execution: {
                          kind: 'COUNT' as const,
                          minimum: null,
                          maximum: null,
                          perSide: false,
                          alternating: false,
                        },
                        load: null,
                        effort: null,
                        enduranceMetrics: [],
                      },
                    },
                  ]
                : blockIndex === 1
                  ? [
                      {
                        ...strength(`${session.sessionKey}-real-strength`),
                        name:
                          index % 2
                            ? 'Barra fixa strict ou remo invertido na barra'
                            : 'Barra fixa com pausa no topo',
                        equipment: [
                          'PULL_UP_BAR' as const,
                          'BODYWEIGHT' as const,
                        ],
                        movementPattern: 'PULL' as const,
                        publicIdentity: {
                          plane: 'VERTICAL' as const,
                          targetRegion: 'BACK' as const,
                          bodyPosition: 'HANGING' as const,
                          jointAction: null,
                        },
                        repetitions: index % 2 ? '6' : '3-5',
                        prescription: {
                          execution: {
                            kind: 'COUNT' as const,
                            minimum: null,
                            maximum: null,
                            perSide: false,
                            alternating: false,
                          },
                          load: null,
                          effort: null,
                          enduranceMetrics: [],
                        },
                      },
                    ]
                  : block.activities.map((activity) => ({
                      ...activity,
                      prescription: {
                        execution: {
                          kind: 'SECONDS' as const,
                          minimum: null,
                          maximum: null,
                          perSide: false,
                          alternating: false,
                        },
                        load: null,
                        effort: null,
                        enduranceMetrics: [],
                      },
                    })),
          })),
        })),
      };
      const s = await subject(
        modality === 'CROSSFIT'
          ? 'Monte Crossfit 4 vezes por semana'
          : 'Monte musculação 4 vezes por semana',
        [candidate],
        { availableEquipment: knownDatum(['PULL_UP_BAR', 'TREADMILL']) },
      );
      const output = await s.engine.generateCandidate(s.input);
      expect(output.output.sessions).toHaveLength(4);
      expect(
        output.output.validation.issues.filter(
          (issue) => issue.severity === 'ERROR',
        ),
      ).toEqual([]);
      expect(
        output.output.sessions[0].blocks[1].activities[0].prescription
          ?.execution,
      ).toMatchObject({ minimum: 3, maximum: 5 });
      expect(
        output.output.sessions[1].blocks[1].activities[0].prescription
          ?.execution,
      ).toMatchObject({ minimum: 6, maximum: 6 });
      expect(
        output.output.sessions[0].blocks[0].activities[0].prescription
          ?.execution,
      ).toBeNull();
      expect(
        new WorkoutPlanV2Formatter().format(output.output).join('\n'),
      ).toContain('Caminhada progressiva na esteira');
      const presentation = new WorkoutPlanV2Formatter()
        .format(output.output)
        .join('\n');
      expect(presentation).toContain('Corrida ao ar livre');
      expect(presentation).toContain(
        'Ajuste o ritmo gradualmente e mantenha passadas confortáveis.',
      );
      await s.complete(output);
      const reader = new CurrentWorkoutPlanReaderService(
        {
          workoutPlan: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'persisted-v12',
              userId: s.input.userId,
              title: output.output.title,
              user: { preferences: { timezone: 'America/Sao_Paulo' } },
              days: output.output.sessions.map((session) => ({
                dayNumber: session.sequence,
                weekday: session.weekday,
                title: session.label,
                exercises: [],
              })),
              aiJob: {
                id: output.aiJobId,
                userId: s.input.userId,
                type: AIJobType.WORKOUT,
                status: AIJobStatus.COMPLETED,
                promptVersion: { name: WORKOUT_PLANNING_V2_PROMPT.name },
                result: { acceptedOutput: output.output },
              },
            }),
          },
        } as never,
        new WorkoutPlanV2StoredDocumentParser(),
      );
      expect((await reader.read(s.input.userId, true)).status).toBe(
        'AVAILABLE',
      );
      expect(
        await reader.present(
          s.input.userId,
          'sessão 1',
          s.input.referenceDate,
          true,
        ),
      ).toContain('Caminhada');
      const replay = await s.engine.generateCandidate(s.input);
      expect(replay.status).toBe('ALREADY_COMPLETED');
      expect(replay.output.sessions).toEqual(output.output.sessions);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps a genuine prescription conflict terminal instead of repairing generic INVALID_PARAMETER', async () => {
    const base = plan('GYM_STRENGTH', 3);
    const candidate = {
      ...base,
      sessions: base.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) =>
            activity.kind === 'STRENGTH'
              ? {
                  ...activity,
                  repetitions: '3-5',
                  prescription: {
                    execution: {
                      kind: 'COUNT' as const,
                      minimum: 6,
                      maximum: 6,
                      perSide: false,
                      alternating: false,
                    },
                    load: null,
                    effort: null,
                    enduranceMetrics: [],
                  },
                }
              : activity,
          ),
        })),
      })),
    };
    const s = await subject('Monte musculação 3x', [candidate]);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'INVALID_PARAMETER',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(s.confirmed).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHORIZED_EQUIPMENT_REFERENCE', 'Use bike e remo'],
    ['UNAUTHORIZED_EXACT_LOAD', 'Use 20 kg'],
    ['UNAUTHORIZED_EXACT_PACE', 'Corra a 5:00 min/km'],
    ['UNAUTHORIZED_EXACT_POWER', 'Pedale a 250 W'],
    ['UNAUTHORIZED_EXACT_LOAD', 'Use 85% de 1RM'],
    ['UNAUTHORIZED_EXACT_LOAD', 'Use 70% do seu máximo'],
    ['UNAUTHORIZED_EXACT_PACE', 'Corra a 4:30/km'],
    ['UNAUTHORIZED_EXACT_HEART_RATE', 'Mantenha 170 bpm'],
  ])(
    'repairs public %s once and charges the entitlement once',
    async (code, instruction) => {
      const valid = plan('CROSSFIT', 3);
      const invalid = {
        ...valid,
        sessions: valid.sessions.map((session) => ({
          ...session,
          blocks: session.blocks.map((block) => ({
            ...block,
            activities: block.activities.map((activity) => ({
              ...activity,
              instruction,
            })),
          })),
        })),
      };
      const s = await subject('Monte Crossfit 3x', [invalid, valid]);
      const result = await s.engine.generateCandidate(s.input);
      expect(
        JSON.stringify(s.gateway.createTextResponse.mock.calls[1][0].input),
      ).toContain(code);
      await s.complete(result);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
      expect(s.confirmed).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
    },
  );
  it('repairs an unpublishable strength repetition once with durable usage and entitlement once', async () => {
    const valid = plan('GYM_STRENGTH', 3);
    const invalid = {
      ...valid,
      sessions: valid.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) =>
            activity.kind === 'STRENGTH'
              ? {
                  ...activity,
                  repetitions: 'conforme necessário',
                  prescription: null,
                }
              : activity,
          ),
        })),
      })),
    };
    const s = await subject('Monte musculação 3x', [invalid, valid]);
    const generated = await s.engine.generateCandidate(s.input);
    expect(
      JSON.stringify(s.gateway.createTextResponse.mock.calls[1][0].input),
    ).toContain('PUBLIC_REPETITIONS_REQUIRED');
    await s.complete(generated);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
    expect(s.confirmed).toHaveBeenCalledTimes(1);
    expect(s.reserved).toHaveBeenCalledTimes(1);
  });
  it('rejects an invalid numeric repair without publishing, persisting or making a third call', async () => {
    const candidate = plan('CROSSFIT', 3);
    const invalid = {
      ...candidate,
      sessions: candidate.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) => ({
            ...activity,
            instruction: 'Use 85% de 1RM e mantenha 170 bpm',
          })),
        })),
      })),
    };
    const s = await subject('Monte Crossfit 3x', [invalid, invalid]);
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'Treino V2 reprovado',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
    expect(s.job()?.status).toBe('FAILED');
    expect(s.confirmed).not.toHaveBeenCalled();
  });
  it('replays a completed V9 operation without weekday, a new job, usage or provider call', async () => {
    const s = await subject('Monte um treino de Crossfit 4x', [
      plan('CROSSFIT', 4),
    ]);
    const generated = await s.engine.generateCandidate(s.input);
    await s.complete(generated);
    const job = s.job();
    if (
      !job ||
      !job.result ||
      typeof job.result !== 'object' ||
      Array.isArray(job.result)
    )
      throw new Error('Missing completed fixture');
    const legacy = plan('CROSSFIT', 4);
    const sessions = legacy.sessions.map((session) => {
      const legacySession = { ...session };
      delete legacySession.weekday;
      return legacySession;
    });
    job.operationKey = `workout-planning-v2:${createHash('sha256').update(`${s.input.userId}:9:ai-first-v9-bounded-repair-v1:request:request-id`).digest('hex')}`;
    job.promptVersion = {
      ...WORKOUT_PLANNING_V2_PROMPT_V9,
      id: 'v9',
      prompt: WORKOUT_PLANNING_V2_PROMPT_V9.instructions,
    };
    job.result = {
      ...job.result,
      candidateOutput: JSON.stringify({ ...legacy, sessions }),
    };
    const replay = await s.engine.generateCandidate(s.input);
    expect(replay.status).toBe('ALREADY_COMPLETED');
    expect(replay.operationKey).toBe(job.operationKey);
    expect(
      replay.output.sessions.every((session) => session.weekday === undefined),
    ).toBe(true);
    expect(s.jobStore.create).toHaveBeenCalledTimes(1);
    expect(s.reserved).toHaveBeenCalledTimes(1);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
    expect(s.usageRows).toHaveLength(1);
  });
  it('repairs duplicate V10 weekdays once through the durable engine', async () => {
    const valid = plan('CROSSFIT', 4);
    const invalid = {
      ...valid,
      sessions: valid.sessions.map((session) => ({
        ...session,
        weekday: 'MONDAY' as const,
      })),
    };
    const s = await subject('Monte um treino de Crossfit 4x', [invalid, valid]);
    const result = await s.engine.generateCandidate(s.input);
    expect(
      new Set(result.output.sessions.map((session) => session.weekday)).size,
    ).toBe(4);
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(s.gateway.createTextResponse.mock.calls[1][0].input).repair
        .validationIssues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_WEEKDAY' }),
      ]),
    );
    await s.complete(result);
    expect(s.confirmed).toHaveBeenCalledTimes(1);
    expect(s.usageRows).toHaveLength(1);
  });
  it('repairs the complete 7599936e production candidate once without authorizing unknown 1RM, bike or Saturday', async () => {
    const raw = new WorkoutPlanV2Parser().parse(
      readFileSync(
        join(__dirname, 'fixtures/workout-7599936e-candidate.json'),
        'utf8',
      ),
    );
    // Controlled repair response, not an observed production completion.
    // Keep the model's other names, doses, instructions and equipment intact.
    const repaired: GeneratedWorkoutPlanV2Candidate = {
      ...raw,
      sessions: raw.sessions.map((session) => ({
        ...session,
        weekday: session.weekday === 'SATURDAY' ? 'FRIDAY' : session.weekday,
        sessionKey:
          session.weekday === 'SATURDAY' ? 'FRIDAY' : session.sessionKey,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) => {
            if (activity.activityKey === 'CF_W1_WU_1')
              return {
                ...activity,
                name: 'Caminhada progressiva na esteira',
                equipment: ['TREADMILL'],
                instruction:
                  'Aumente o ritmo aos poucos na esteira, sem chegar ofegante.',
              };
            if (
              activity.activityKey === 'CF_W2_WU_1' ||
              activity.activityKey === 'CF_W3_WU_1'
            )
              return {
                ...activity,
                instruction:
                  'Caminhe leve para subir a temperatura sem fadiga.',
              };
            return activity.prescription?.load?.kind === 'PERCENT_1RM'
              ? {
                  ...activity,
                  prescription: { ...activity.prescription, load: null },
                }
              : activity;
          }),
        })),
      })),
    };
    const s = await subject(
      'Monte um treino de CrossFit 4 vezes por semana',
      [raw, repaired],
      { weeklyFrequency: knownDatum(4) },
      [],
      ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    );
    const result = await s.engine.generateCandidate(s.input);
    const repairPayload: {
      repair: {
        validationIssues: { code: string; path: string; severity: string }[];
      };
    } = JSON.parse(s.gateway.createTextResponse.mock.calls[1][0].input);
    const errors: { code: string; path: string; severity: string }[] =
      repairPayload.repair.validationIssues.filter(
        (issue: { severity: string }) => issue.severity === 'ERROR',
      );
    expect(
      errors
        .filter((issue) => issue.code === 'UNAUTHORIZED_EXACT_LOAD')
        .map((issue) => issue.path),
    ).toEqual([
      'CF_W1_STR_1.prescription.load.referenceId',
      'CF_W1_STR_2.prescription.load.referenceId',
      'CF_W2_STR_1.prescription.load.referenceId',
      'CF_W3_STR_1.prescription.load.referenceId',
      'CF_W3_STR_2.prescription.load.referenceId',
      'CF_W4_STR_1.prescription.load.referenceId',
    ]);
    expect(
      errors
        .filter((issue) => issue.code === 'UNAUTHORIZED_EQUIPMENT_REFERENCE')
        .map((issue) => issue.path),
    ).toEqual(['CF_W1_WU_1', 'CF_W2_WU_1', 'CF_W3_WU_1']);
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'WEEKDAY_UNAVAILABLE',
        path: 'SATURDAY',
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'PUBLIC_IDENTITY_REQUIRED',
        path: 'CF_W1_WU_1',
      }),
    );
    expect(errors.some((issue) => issue.code === 'INVALID_PARAMETER')).toBe(
      false,
    );
    const activities = result.output.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.activities),
    );
    expect(
      result.output.sessions.map(({ weekday, sessionKey, sequence }) => ({
        weekday,
        sessionKey,
        sequence,
      })),
    ).toEqual([
      { weekday: 'MONDAY', sessionKey: 'MONDAY', sequence: 1 },
      { weekday: 'WEDNESDAY', sessionKey: 'WEDNESDAY', sequence: 2 },
      { weekday: 'THURSDAY', sessionKey: 'THURSDAY', sequence: 3 },
      { weekday: 'FRIDAY', sessionKey: 'FRIDAY', sequence: 4 },
    ]);
    expect(activities.map((activity) => activity.activityKey)).toEqual(
      raw.sessions.flatMap((session) =>
        session.blocks.flatMap((block) =>
          block.activities.map((activity) => activity.activityKey),
        ),
      ),
    );
    expect(result.output.substitutions).toEqual(raw.substitutions);
    expect(
      activities.find((activity) => activity.activityKey === 'CF_W4_STR_2')
        ?.prescription?.execution,
    ).toEqual({
      kind: 'SECONDS',
      minimum: 20,
      maximum: 30,
      perSide: false,
      alternating: false,
    });
    expect(
      result.output.validation.issues.filter(
        (issue) => issue.severity === 'ERROR',
      ),
    ).toEqual([]);
    expect(
      new WorkoutPlanV2Formatter().format(result.output).join('\n'),
    ).toContain('Caminhada progressiva na esteira');
    await s.complete(result);
    expect((await s.engine.generateCandidate(s.input)).status).toBe(
      'ALREADY_COMPLETED',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
    expect(s.confirmed).toHaveBeenCalledTimes(1);
  });
  it('repairs the supplied Bike/MACHINE representation and unavailable Saturday once using confirmed synthetic context', async () => {
    // Only Bike leve/MACHINE and the weekday sequence are supplied incident excerpts.
    // The rest of the candidate and profile are local synthetic fixtures, not production snapshots.
    const days = ['MONDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
    const base = plan('CROSSFIT', 4);
    const valid = {
      ...base,
      sessions: base.sessions.map((session, index) => ({
        ...session,
        weekday: days[index],
      })),
    };
    const invalid = {
      ...valid,
      sessions: valid.sessions.map((session, index) => ({
        ...session,
        weekday: index === 3 ? ('SATURDAY' as const) : session.weekday,
        blocks: session.blocks.map((block, blockIndex) =>
          index === 0 && blockIndex === 0
            ? {
                ...block,
                activities: [
                  {
                    activityKey: 'CF_W1_WU_1',
                    kind: 'TIMED' as const,
                    name: 'Bike leve',
                    source: 'MODEL_GENERATED' as const,
                    movementPattern: 'LOCOMOTION' as const,
                    equipment: ['MACHINE' as const],
                    publicIdentity: null,
                    instruction: 'Mantenha esforço confortável.',
                    alerts: [],
                    appliedConstraintCodes: [],
                    durationSeconds: 360,
                    workSeconds: null,
                    recoverySeconds: null,
                    rounds: 1,
                    intensity: 'LIGHT' as const,
                  },
                ],
              }
            : block,
        ),
      })),
    };
    const s = await subject(
      'Monte um treino de CrossFit 4 vezes por semana',
      [invalid, valid],
      {},
      [],
      days,
    );
    const output = await s.engine.generateCandidate(s.input);
    expect(output.output.sessions.map((session) => session.weekday)).toEqual(
      days,
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(
      s.gateway.createTextResponse.mock.calls[1][0].input,
    ).repair;
    expect(repair.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WEEKDAY_UNAVAILABLE',
          severity: 'ERROR',
        }),
        expect.objectContaining({
          code: 'UNAUTHORIZED_EQUIPMENT_REFERENCE',
          severity: 'ERROR',
        }),
        expect.objectContaining({
          code: 'PUBLIC_IDENTITY_REQUIRED',
          severity: 'ERROR',
        }),
      ]),
    );
    await s.complete(output);
    expect((await s.engine.generateCandidate(s.input)).status).toBe(
      'ALREADY_COMPLETED',
    );
    expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(2);
  });
  it.each(WORKOUT_V10_QUALITY_CORPUS)(
    'V10 quality corpus $id: $modality',
    async (entry) => {
      const base = plan(entry.modality, entry.count);
      const duration = entry.duration ?? 60;
      const chosen =
        entry.id === 'C'
          ? (['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY'] as const)
          : base.sessions.map((session) => session.weekday!);
      const candidate: GeneratedWorkoutPlanV2Candidate = {
        ...base,
        objective:
          entry.id === 'G'
            ? 'HYPERTROPHY'
            : entry.id === 'J' || entry.id === 'L'
              ? 'COMPLETE_DISTANCE'
              : base.objective,
        sessions: base.sessions.map((session, index) => ({
          ...session,
          weekday: chosen[index],
          estimatedDurationMinutes: duration,
          label: `${entry.modality}: ${index % 2 ? 'técnica e recuperação' : 'desenvolvimento e condicionamento'}`,
          blocks:
            entry.modality === 'HOME_WORKOUT' ||
            entry.modality === 'GYM_STRENGTH'
              ? [
                  {
                    blockKey: `${session.sessionKey}-strength`,
                    type: 'STRENGTH',
                    title: 'Força com equipamentos disponíveis',
                    estimatedDurationMinutes: duration,
                    activities: [
                      {
                        ...strength(`${session.sessionKey}-strength-1`),
                        prescription: {
                          execution: {
                            kind: 'COUNT',
                            minimum: 8,
                            maximum: 12,
                            perSide: false,
                            alternating: false,
                          },
                          load: null,
                          effort: null,
                          enduranceMetrics: [],
                        },
                        sets: 3,
                        restSeconds: 60,
                        equipment: entry.equipment ?? ['BODYWEIGHT'],
                      },
                    ],
                  },
                ]
              : entry.modality === 'RUNNING'
                ? session.blocks.map((block) => ({
                    ...block,
                    type: 'ENDURANCE' as const,
                  }))
                : session.blocks,
        })),
      };
      const s = await subject(
        entry.text,
        [candidate],
        {
          experienceLevel: knownDatum(entry.experience),
          sessionDurationMinutes: knownDatum(duration),
          ...(entry.equipment
            ? { availableEquipment: knownDatum(entry.equipment) }
            : {}),
          ...(entry.modality === 'HOME_WORKOUT'
            ? { environment: knownDatum('HOME') }
            : {}),
          ...(entry.modality === 'RUNNING'
            ? {
                currentRunningDistanceKm: knownDatum(
                  entry.experience === 'BEGINNER' ? 1 : 5,
                ),
              }
            : {}),
          ...(entry.id === 'G'
            ? { primaryGoal: knownDatum('MUSCLE_GAIN') }
            : {}),
        },
        [],
        entry.days,
      );
      const result = await s.engine.generateCandidate(s.input);
      const prepared = s.engine.prepare(s.input);
      expect(result.output.modality).toBe(entry.modality);
      expect(result.output.sessions).toHaveLength(entry.count);
      expect(
        new Set(result.output.sessions.map((session) => session.weekday)).size,
      ).toBe(entry.count);
      expect(result.output.sessions.map((session) => session.weekday)).toEqual(
        chosen,
      );
      expect(
        result.output.validation.issues.filter(
          (issue) => issue.severity === 'ERROR',
        ),
      ).toEqual([]);
      for (const session of result.output.sessions)
        for (const block of session.blocks)
          for (const activity of block.activities) {
            expect(
              activity.equipment.every((equipment) =>
                prepared.strategy?.authorizedEquipment.includes(equipment),
              ),
            ).toBe(true);
            expect(activity.instruction).not.toMatch(
              /\d+\s*(?:kg|km\/h|bpm)|\d+:\d+\s*min\/km/iu,
            );
            if (entry.modality === 'WALKING' && activity.kind === 'ENDURANCE')
              expect(activity.mode).toBe('WALK');
          }
      if (entry.days)
        expect(chosen.every((day) => entry.days?.includes(day))).toBe(true);
      if (entry.id === 'C')
        expect(chosen).not.toEqual(entry.days?.slice(0, entry.count));
      if (entry.id === 'D') {
        expect(prepared.context?.training.scheduledTrainingDays).toEqual({
          status: 'CONFIRMED',
          value: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
        });
        expect(chosen).toEqual(['MONDAY', 'WEDNESDAY', 'FRIDAY']);
      }
      if (entry.id === 'J' || entry.id === 'L')
        expect(prepared.context?.training.targetDistanceKm).toMatchObject({
          value: 10,
        });
      if (entry.id === 'L')
        expect(prepared.context?.training.targetEventDate).toMatchObject({
          value: '2026-12-20',
        });
      if (entry.modality === 'CROSSFIT')
        expect(
          result.output.sessions.every((session) =>
            session.blocks.some((block) => block.type === 'CONDITIONING'),
          ),
        ).toBe(true);
      if (entry.modality === 'RUNNING')
        expect(
          result.output.sessions.every((session) =>
            session.blocks.some((block) => block.type === 'ENDURANCE'),
          ),
        ).toBe(true);
      if (entry.modality === 'HOME_WORKOUT')
        expect(prepared.strategy?.environment).toMatchObject({ value: 'HOME' });
      if (entry.id === 'G') expect(result.output.objective).toBe('HYPERTROPHY');
      expect(prepared.strategy?.sessionFocuses).toEqual([]);
      await s.complete(result);
      expect(s.gateway.startBackgroundTextResponse).toHaveBeenCalledTimes(1);
      expect(s.reserved).toHaveBeenCalledTimes(1);
    },
  );
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
