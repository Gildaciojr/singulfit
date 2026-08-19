import { AIJobStatus, AIJobType, FitnessGoal, Prisma } from '@prisma/client';
import type { AIService } from '../../../ai/ai.service';
import type { AuditService } from '../../../observability/audit.service';
import type { WorkoutPlanV2 } from '../workout-plan-v2.contract';
import type {
  CompletedWorkoutPlanningGenerationResult,
  PendingWorkoutPlanningGenerationResult,
} from '../workout-planning-generation.contract';
import type { PersistWorkoutPlanV2Input } from './workout-plan-v2-persistence.contract';
import { WorkoutPlanV2PersistenceService } from './workout-plan-v2-persistence.service';
import { WorkoutPlanV2PersistenceValidator } from './workout-plan-v2-persistence.validator';
import type {
  PersistedWorkoutPlanRecord,
  WorkoutPlanV2Repository,
} from './workout-plan-v2.repository';

const transaction = Object.freeze({
  marker: true,
}) as unknown as Prisma.TransactionClient;
const generatedAt = '2026-08-07T12:00:00.000Z';

function document(reused = false): WorkoutPlanV2 {
  return {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    modality: 'HOME_WORKOUT',
    objective: 'GENERAL_HEALTH',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: 'Plano semanal V2',
    referenceDate: '2026-08-07',
    strategy: {
      schemaVersion: 2,
      artifactType: 'WEEKLY_PLAN',
      modality: 'HOME_WORKOUT',
      objective: { status: 'CONFIRMED', value: 'GENERAL_HEALTH' },
      experience: { status: 'CONFIRMED', value: 'BEGINNER' },
      sessionCount: 1,
      sessionDurationMinutes: { status: 'CONFIRMED', value: 30 },
      environment: { status: 'CONFIRMED', value: 'HOME' },
      authorizedEquipment: ['BODYWEIGHT'],
      requiredBlocks: ['STRENGTH'],
      optionalBlocks: [],
      maximumActivitiesPerSession: 8,
      technicalMovementsAllowed: false,
      intensityPolicy: {
        scale: 'RPE',
        minimum: 4,
        maximum: 7,
        qualitativeLevel: 'MODERATE',
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      },
      progressionPolicy: {
        initialState: 'MAINTAIN',
        maximumWeeklyIncreasePercent: 5,
        simultaneousVariablesAllowed: 1,
        requiresCompletedSessions: true,
        blocksOnSafetyFlag: true,
      },
      appliedConstraints: [],
      personalizationFactors: ['MODALITY'],
    },
    sessions: [
      {
        sessionKey: 'session-1',
        sequence: 1,
        label: 'Sessão 1',
        estimatedDurationMinutes: 30,
        blocks: [
          {
            blockKey: 'block-1',
            type: 'STRENGTH',
            title: 'Força',
            estimatedDurationMinutes: 20,
            activities: [
              {
                activityKey: 'activity-1',
                name: 'Agachamento livre',
                source: 'MODEL_GENERATED',
                movementPattern: 'SQUAT',
                equipment: ['BODYWEIGHT'],
                instruction: 'Execute com controle.',
                alerts: [],
                appliedConstraintCodes: [],
                kind: 'STRENGTH',
                sets: 3,
                repetitions: '10',
                restSeconds: 60,
                intensity: 'MODERATE',
              },
            ],
          },
        ],
      },
    ],
    progression: [],
    substitutions: [],
    adaptationRules: [],
    appliedConstraints: [],
    personalizationFactors: ['MODALITY'],
    safetyFlags: [],
    generationMetadata: {
      engineVersion: 2,
      promptVersionId: 'prompt-id',
      aiJobId: 'job-id',
      operationKey: 'operation-key',
      model: 'model-id',
      generatedAt,
      reused,
    },
    validation: { status: 'VALID', issues: [] },
  };
}

function pendingGeneration(): PendingWorkoutPlanningGenerationResult {
  const output = document(false);
  const storedResult = {
    candidateOutput: JSON.stringify({ title: output.title }),
    model: 'model-id',
  };
  const response = {
    responseId: 'response-id',
    model: 'model-id',
    outputText: storedResult.candidateOutput,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  };
  return {
    status: 'PENDING_COMPLETION',
    output,
    aiJobId: 'job-id',
    operationKey: 'operation-key',
    storedResult,
    reused: false,
    completion: {
      userId: 'user-id',
      aiJobId: 'job-id',
      jobType: AIJobType.WORKOUT,
      response,
      result: storedResult,
    },
  };
}

function completedGeneration(): CompletedWorkoutPlanningGenerationResult {
  const output = document(true);
  return {
    status: 'ALREADY_COMPLETED',
    output,
    aiJobId: 'job-id',
    operationKey: 'operation-key',
    storedResult: {
      candidateOutput: JSON.stringify({ title: output.title }),
      model: 'model-id',
    },
    reused: true,
    completion: null,
  };
}

function persisted(): PersistedWorkoutPlanRecord {
  return {
    id: 'plan-id',
    userId: 'user-id',
    profileId: 'profile-id',
    aiJobId: 'job-id',
    title: 'Plano semanal V2',
    objective: FitnessGoal.MAINTENANCE,
    status: 'ACTIVE',
    generatedAt: new Date(generatedAt),
    createdAt: new Date(generatedAt),
    updatedAt: new Date(generatedAt),
    days: [
      {
        id: 'day-id',
        workoutPlanId: 'plan-id',
        dayNumber: 1,
        title: 'Sessão 1',
        exercises: [
          {
            id: 'exercise-id',
            workoutDayId: 'day-id',
            exerciseName: 'Agachamento livre',
            sets: 3,
            reps: '10',
            restSeconds: 60,
            notes: JSON.stringify({
              schemaVersion: 2,
              sessionKey: 'session-1',
              blockKey: 'block-1',
              blockType: 'STRENGTH',
              blockTitle: 'Força',
              activity: document().sessions[0].blocks[0].activities[0],
            }),
          },
        ],
      },
    ],
  };
}

function input(
  generation:
    | PendingWorkoutPlanningGenerationResult
    | CompletedWorkoutPlanningGenerationResult = pendingGeneration(),
): PersistWorkoutPlanV2Input {
  return {
    generation,
    ownership: { userId: 'user-id', profileId: 'profile-id' },
    executionContext: { correlationId: 'correlation-id' },
  };
}

function setup(options?: {
  readonly status?: AIJobStatus;
  readonly existing?: PersistedWorkoutPlanRecord | null;
}) {
  const order: string[] = [];
  const repository = {
    inTransaction: jest.fn(
      async <T>(
        operation: (client: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => operation(transaction),
    ),
    acquireUserLock: jest.fn().mockResolvedValue(undefined),
    findOwnership: jest.fn().mockResolvedValue({
      profile: { goal: FitnessGoal.MAINTENANCE },
      aiJob: {
        id: 'job-id',
        userId: 'user-id',
        type: AIJobType.WORKOUT,
        status: options?.status ?? AIJobStatus.PROCESSING,
        promptVersionId: 'prompt-id',
        operationKey: 'operation-key',
      },
    }),
    findByAIJobId: jest.fn().mockResolvedValue(options?.existing ?? null),
    archiveActive: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation(() => {
      order.push('persist');
      return Promise.resolve(persisted());
    }),
  } as unknown as jest.Mocked<WorkoutPlanV2Repository>;
  const audit = {
    recordInTransaction: jest.fn().mockImplementation(() => {
      order.push('audit');
      return Promise.resolve({ id: 'audit-id' });
    }),
  } as unknown as jest.Mocked<AuditService>;
  const ai = {
    completeJobInTransaction: jest.fn().mockImplementation(() => {
      order.push('complete');
      return Promise.resolve({ id: 'usage-id' });
    }),
  } as unknown as jest.Mocked<AIService>;
  const service = new WorkoutPlanV2PersistenceService(
    repository,
    new WorkoutPlanV2PersistenceValidator(),
    audit,
    ai,
  );
  return { service, repository, audit, ai, order };
}

describe('WorkoutPlanV2PersistenceService', () => {
  it('persists once and completes the AIJob after accepted persistence in one transaction', async () => {
    const test = setup();
    await expect(test.service.persist(input())).resolves.toMatchObject({
      persistence: 'CREATED',
      aiJobCompleted: true,
      aggregate: { id: 'plan-id', document: { schemaVersion: 2 } },
    });
    expect(test.repository.inTransaction.mock.calls).toHaveLength(1);
    expect(test.repository.archiveActive.mock.calls).toEqual([
      [transaction, 'user-id'],
    ]);
    expect(test.repository.create.mock.calls).toHaveLength(1);
    expect(test.order).toEqual(['persist', 'audit', 'complete']);
    expect(test.ai.completeJobInTransaction.mock.calls).toEqual([
      [
        transaction,
        expect.objectContaining({
          aiJobId: 'job-id',
          result: expect.objectContaining({
            candidateOutput: expect.any(String),
            model: 'model-id',
            acceptedOutput: expect.objectContaining({ schemaVersion: 2 }),
          }),
        }),
      ],
    ]);
  });

  it('maps session order to explicit weekdays without interpreting dayNumber as weekday', async () => {
    const test = setup();
    await test.service.persist({
      ...input(),
      calendarWeekdays: ['THURSDAY'],
    });

    expect(test.repository.create.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        days: [expect.objectContaining({ dayNumber: 1, weekday: 'THURSDAY' })],
      }),
    );
  });

  it('does not complete the AIJob when canonical persistence fails', async () => {
    const test = setup();
    test.repository.create.mockRejectedValue(new Error('persistence failed'));
    await expect(test.service.persist(input())).rejects.toThrow(
      'persistence failed',
    );
    expect(test.ai.completeJobInTransaction.mock.calls).toHaveLength(0);
  });

  it('does not commit a partial plan when AIJob completion fails', async () => {
    const test = setup();
    let committed = false;
    test.repository.inTransaction.mockImplementation(
      async <T>(
        operation: (client: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        const result = await operation(transaction);
        committed = true;
        return result;
      },
    );
    test.ai.completeJobInTransaction.mockRejectedValue(
      new Error('completion failed'),
    );
    await expect(test.service.persist(input())).rejects.toThrow(
      'completion failed',
    );
    expect(test.repository.create.mock.calls).toHaveLength(1);
    expect(committed).toBe(false);
  });

  it('reuses a completed persisted plan without duplication or completion', async () => {
    const test = setup({
      status: AIJobStatus.COMPLETED,
      existing: persisted(),
    });
    await expect(
      test.service.persist(input(completedGeneration())),
    ).resolves.toMatchObject({ persistence: 'REUSED', aiJobCompleted: true });
    expect(test.repository.archiveActive.mock.calls).toHaveLength(0);
    expect(test.repository.create.mock.calls).toHaveLength(0);
    expect(test.audit.recordInTransaction.mock.calls).toHaveLength(0);
    expect(test.ai.completeJobInTransaction.mock.calls).toHaveLength(0);
  });

  it('rejects a persisted plan whose AIJob is still PROCESSING', async () => {
    const test = setup({ existing: persisted() });
    await expect(test.service.persist(input())).rejects.toThrow(
      'AIJob ainda não concluído',
    );
    expect(test.repository.create.mock.calls).toHaveLength(0);
    expect(test.ai.completeJobInTransaction.mock.calls).toHaveLength(0);
  });

  it('rejects a completed AIJob without its canonical plan', async () => {
    const test = setup({ status: AIJobStatus.COMPLETED });
    await expect(
      test.service.persist(input(completedGeneration())),
    ).rejects.toThrow('AIJob concluído sem plano');
    expect(test.repository.create.mock.calls).toHaveLength(0);
  });

  it('does not apply a conversational artifact as an active canonical plan', async () => {
    const test = setup();
    const generation = pendingGeneration();
    const invalid: PendingWorkoutPlanningGenerationResult = {
      ...generation,
      output: {
        ...generation.output,
        artifactType: 'POINT_GUIDANCE',
        strategy: {
          ...generation.output.strategy,
          artifactType: 'POINT_GUIDANCE',
        },
      },
    };
    await expect(test.service.persist(input(invalid))).rejects.toThrow(
      'não aplicável como plano canônico',
    );
    expect(test.repository.inTransaction.mock.calls).toHaveLength(0);
  });

  it('archives the old active plan and persists an exercise substitution as the new active V2 plan', async () => {
    const test = setup();
    const generation = pendingGeneration();
    const substitution: PendingWorkoutPlanningGenerationResult = {
      ...generation,
      output: {
        ...generation.output,
        artifactType: 'EXERCISE_SUBSTITUTION',
        lifecycleReason: 'ADAPTATION',
        strategy: {
          ...generation.output.strategy,
          artifactType: 'EXERCISE_SUBSTITUTION',
        },
      },
    };

    await expect(
      test.service.persist(input(substitution)),
    ).resolves.toMatchObject({
      persistence: 'CREATED',
      aggregate: {
        status: 'ACTIVE',
        document: { artifactType: 'EXERCISE_SUBSTITUTION' },
      },
    });
    expect(test.repository.archiveActive.mock.calls).toEqual([
      [transaction, 'user-id'],
    ]);
    expect(test.repository.create.mock.calls).toEqual([
      [
        transaction,
        expect.objectContaining({ userId: 'user-id', status: 'ACTIVE' }),
      ],
    ]);
  });
});
