import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import type { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { PrismaService } from '../../prisma/prisma.service';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import type { WorkoutProgressEvidence } from './workout-planning-context.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import type { AIService } from '../../ai/ai.service';
import {
  historicalWorkoutContext,
  historicalWorkoutPlan,
  longitudinalWorkoutSnapshot,
} from './workout-longitudinal.fixtures';

describe('Workout longitudinal history', () => {
  const referenceDate = new Date('2026-08-18T12:00:00Z');
  function setup(
    owner: string | null = 'user-id',
    observations: readonly object[] = [],
  ) {
    const previousPlan = historicalWorkoutPlan();
    const reader = {
      readPrevious: jest
        .fn()
        .mockResolvedValue(
          owner ? { userId: owner, document: previousPlan } : null,
        ),
      read: jest.fn().mockResolvedValue(
        owner
          ? {
              status: 'AVAILABLE',
              plan: { userId: owner, document: previousPlan },
            }
          : { status: 'NO_PLAN', plan: null },
      ),
    };
    const prisma = {
      fitnessCheckIn: { findMany: jest.fn().mockResolvedValue(observations) },
    };
    const builder = new GenerateWorkoutPlanV2InputBuilder(
      {} as CoachProfileSnapshotBuilder,
      prisma as unknown as PrismaService,
      reader as unknown as CurrentWorkoutPlanReaderService,
    );
    const build = (
      currentMessage: string,
      extra: Partial<Parameters<typeof builder.build>[0]> = {},
    ) =>
      builder.build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot: longitudinalWorkoutSnapshot(),
        referenceDate,
        currentMessage,
        ...extra,
      });
    return { previousPlan, reader, prisma, build };
  }
  it('A/G: leaves absent history and evidence absent', async () => {
    const result = await setup(null).build('Quero um treino novo');
    expect(result.generationInput.previousPlan).toBeUndefined();
    expect(result.generationInput.progressEvidence).toBeUndefined();
  });
  it.each([
    'Refaça meu treino',
    'Quero um treino novo',
    'Monte outro treino para mim',
    'Quero continuar evoluindo meu treino',
    'Quero mudar meu treino de academia',
  ])('B: attaches the owned previous plan for %s', async (message) => {
    const subject = setup();
    expect((await subject.build(message)).generationInput.previousPlan).toBe(
      subject.previousPlan,
    );
    expect(subject.reader.readPrevious).toHaveBeenCalledWith(
      'user-id',
      referenceDate,
    );
  });
  it('C: permits complete replacement without requiring the old split', async () => {
    const input = (
      await setup().build('Quero um treino completamente diferente')
    ).generationInput;
    const context = new WorkoutPlanningContextBuilder().build({
      ...input,
      artifactType: 'WEEKLY_PLAN',
      modality: 'GYM_STRENGTH',
    });
    expect(context.previousPlanPolicy).toBe('REPLACE_FREELY');
    const strategy = new WorkoutPlanningStrategyService().build(context);
    expect(strategy.sessionFocuses).not.toEqual(
      context.previousPlan?.sessionLabels,
    );
    expect(strategy.progressionPolicy.initialState).toBe('REASSESS');
  });
  it.each([
    ['Agora só posso treinar em casa 3x', 3, 'HOME'],
    ['Agora quero treinar 4x', 4, 'FULL_GYM'],
    ['Agora treino 3x em vez de 5x', 3, 'FULL_GYM'],
  ])(
    'D/E: current declaration prevails: %s',
    async (message, frequency, environment) => {
      const input = (await setup().build(message)).generationInput;
      const context = new WorkoutPlanningContextBuilder().build({
        ...input,
        artifactType: 'WEEKLY_PLAN',
        modality: 'GYM_STRENGTH',
      });
      expect(context.training.weeklyFrequency).toMatchObject({
        value: frequency,
      });
      expect(context.training.environment).toMatchObject({
        value: environment,
      });
      expect(context.previousPlan?.sessionCount).toBe(5);
      if (environment === 'HOME')
        expect(context.training.equipment).toMatchObject({
          value: ['BODYWEIGHT'],
        });
    },
  );
  it('F/H: loads only real owned check-ins and carries their provenance', async () => {
    const observations = ['user-id', 'other-user'].map((userId) => ({
      userId,
      profileId: 'profile-id',
      createdAt: new Date('2026-08-16T12:00:00Z'),
      adherenceScore: 30,
    }));
    const subject = setup('user-id', observations);
    const input = (await subject.build('Refaça meu treino')).generationInput;
    expect(subject.prisma.fitnessCheckIn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-id',
          profileId: 'profile-id',
          profile: { userId: 'user-id' },
        }),
      }),
    );
    expect(input.progressEvidence).toEqual([
      {
        source: 'FITNESS_CHECK_IN',
        observedAt: '2026-08-16T12:00:00.000Z',
        adherenceScore: 30,
        perceivedEffort: null,
        completedSessions: null,
        expectedSessions: null,
      },
    ]);
    const context = new WorkoutPlanningContextBuilder().build({
      ...input,
      artifactType: 'WEEKLY_PLAN',
      modality: 'GYM_STRENGTH',
    });
    const strategy = new WorkoutPlanningStrategyService().build(context);
    expect(context.progressEvidence).toEqual(input.progressEvidence);
    expect(strategy.personalizationFactors).toContain('PROGRESS_EVIDENCE');
    expect(strategy.progressionPolicy.initialState).toBe('REASSESS');
  });
  it('F: sends canonical history and deterministic strategy to the OpenAI boundary', async () => {
    const subject = setup('user-id', [
      {
        userId: 'user-id',
        profileId: 'profile-id',
        createdAt: new Date('2026-08-16T12:00:00Z'),
        adherenceScore: 30,
      },
    ]);
    const input = (
      await subject.build('Refaça meu treino', {
        recognizedContext: historicalWorkoutContext,
      })
    ).generationInput;
    const ai = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        promptVersionId: 'prompt-id',
        status: 'PENDING',
      }),
      runTextJob: jest
        .fn()
        .mockRejectedValue(new Error('controlled OpenAI boundary')),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = new WorkoutPlanningEngineV2Service(
      new WorkoutArtifactResolverService(),
      new WorkoutPlanningReadinessService(),
      new WorkoutPlanningContextBuilder(),
      new WorkoutPlanningStrategyService(),
      new WorkoutPlanningSafetyService(),
      new WorkoutPlanV2Validator(),
      ai as unknown as AIService,
    );
    await expect(engine.generateCandidate(input)).rejects.toThrow(
      'controlled OpenAI boundary',
    );
    expect(ai.runTextJob).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(ai.runTextJob.mock.calls[0][1].input) as {
      context: WorkoutPlanningContext;
      strategy: WorkoutPlanningStrategy;
    };
    expect(payload.context.previousPlan?.sessionCount).toBe(5);
    expect(
      payload.context.previousPlan?.sessionDetails?.[0].blocks[0].activities[0],
    ).toMatchObject({ name: 'Supino', sets: 3, repetitions: '10' });
    expect(payload.context.previousPlan?.strategy?.sessionCount).toBe(5);
    expect(payload.context.progressEvidence).toEqual(input.progressEvidence);
    expect(payload.strategy.progressionPolicy.initialState).toBe('REASSESS');
    expect(
      payload.strategy.progressionPolicy.maximumWeeklyIncreasePercent,
    ).toBe(0);
  });

  it('keeps saved energy and feedback without manufacturing workout performance', async () => {
    const input = (
      await setup('user-id', [
        {
          userId: 'user-id',
          profileId: 'profile-id',
          createdAt: referenceDate,
          adherenceScore: 95,
          energyLevel: 'LOW',
          notes: 'Senti os treinos difíceis nesta semana',
        },
      ]).build('Refaça meu treino')
    ).generationInput;
    expect(input.progressEvidence).toMatchObject([
      {
        energyLevel: 'LOW',
        feedback: 'Senti os treinos difíceis nesta semana',
        perceivedEffort: null,
        completedSessions: null,
        expectedSessions: null,
      },
    ]);
    const context = new WorkoutPlanningContextBuilder().build({
      ...input,
      artifactType: 'WEEKLY_PLAN',
      modality: 'GYM_STRENGTH',
    });
    expect(
      new WorkoutPlanningStrategyService().build(context).progressionPolicy
        .initialState,
    ).toBe('REASSESS');
  });

  it('ignores future, stale, invalid and foreign-profile check-ins', async () => {
    const observations = [
      {
        userId: 'user-id',
        profileId: 'profile-id',
        createdAt: new Date('2026-08-19'),
        adherenceScore: 80,
      },
      {
        userId: 'user-id',
        profileId: 'profile-id',
        createdAt: new Date('2025-08-18'),
        adherenceScore: 80,
      },
      {
        userId: 'user-id',
        profileId: 'profile-id',
        createdAt: referenceDate,
        adherenceScore: 101,
      },
      {
        userId: 'user-id',
        profileId: 'other-profile',
        createdAt: referenceDate,
        adherenceScore: 80,
      },
    ];
    expect(
      (await setup('user-id', observations).build('Refaça meu treino'))
        .generationInput.progressEvidence,
    ).toBeUndefined();
  });

  it('H: cannot attach a foreign previous plan or injected foreign evidence', async () => {
    const subject = setup('other-user');
    const result = await subject.build('Refaça meu treino', {
      progressEvidence: [
        {
          observedAt: referenceDate.toISOString(),
          adherenceScore: 100,
          perceivedEffort: 1,
          completedSessions: 100,
          expectedSessions: 100,
        },
      ],
    });
    expect(result.generationInput.previousPlan).toBeUndefined();
    expect(result.generationInput.progressEvidence).toBeUndefined();
    await expect(
      subject.build('Refaça meu treino', {
        previousPlan: historicalWorkoutPlan('foreign-job'),
      }),
    ).rejects.toThrow('não corresponde');
  });
  it.each([
    ['MAINTAIN', null, null, null, null, []],
    ['PROGRESS', 90, 6, 5, 5, []],
    ['REGRESS', 60, 8, 1, 5, []],
    ['DELOAD', 90, 9, 5, 5, []],
    ['REASSESS', 30, null, null, null, []],
    ['PAUSE', 90, 6, 5, 5, ['ACUTE_PAIN']],
  ] as const)(
    'chooses %s deterministically',
    (
      state,
      adherenceScore,
      perceivedEffort,
      completedSessions,
      expectedSessions,
      safetySignals,
    ) => {
      const evidence: WorkoutProgressEvidence = {
        observedAt: referenceDate.toISOString(),
        adherenceScore,
        perceivedEffort,
        completedSessions,
        expectedSessions,
      };
      const context = new WorkoutPlanningContextBuilder().build({
        snapshot: longitudinalWorkoutSnapshot(),
        artifactType: 'WEEKLY_PLAN',
        modality: 'GYM_STRENGTH',
        recognizedContext: { ...historicalWorkoutContext, safetySignals },
        referenceDate,
        previousPlan: historicalWorkoutPlan(),
        progressEvidence: [evidence],
      });
      const strategy = new WorkoutPlanningStrategyService().build(context);
      expect(strategy.progressionPolicy.initialState).toBe(state);
      if (state === 'DELOAD' || state === 'REGRESS' || state === 'PAUSE')
        expect(strategy.intensityPolicy.qualitativeLevel).toBe('LIGHT');
    },
  );
});
