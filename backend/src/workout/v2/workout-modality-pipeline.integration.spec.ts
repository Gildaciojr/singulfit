import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CoachAdaptiveProfileCollectorService } from '../../context/coach-adaptive-profile-collector.service';
import { WorkoutApplicationExecutorService } from './execution/workout-application-executor.service';
import { CoachPlanningExecutionDispatcherService } from '../../automation/coach-planning-execution-dispatcher.service';
import type {
  PersistWorkoutPlanV2Input,
  PersistWorkoutPlanV2Result,
} from './persistence/workout-plan-v2-persistence.contract';
import { AIService } from '../../ai/ai.service';
import { PromptService } from '../../ai/prompt.service';
import { ConversationModule } from '../../conversation/conversation.module';
import { ConversationUnderstandingService } from '../../conversation/understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../../conversation/routing/conversation-routing-decision.service';
import { understandingInput } from '../../conversation/tests/conversation-understanding.fixtures';
import {
  routingSnapshot,
  knownDatum,
  unknownDatum,
  goalPreparationInput,
} from '../../conversation/tests/conversation-routing.fixtures';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import {
  WorkoutPlanningEngineV2Service,
  WorkoutPostGenerationValidationError,
} from './workout-planning-engine-v2.service';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V7,
} from './workout-planning-v2.prompt.definition';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import type {
  WorkoutPlanningStrategy,
  WorkoutBlockType,
} from './workout-planning-strategy.contract';
import type {
  WorkoutEquipment,
  WorkoutExperienceLevel,
} from './workout-planning-context.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import { ConversationQAFollowUpContextService } from '../../conversation/runtime/conversation-qa-follow-up-context.service';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';
import { ConversationExecutionBridgeService } from '../../conversation/runtime/conversation-execution-bridge.service';
import { ConversationResponsePayloadBuilder } from '../../conversation/runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../../conversation/runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../../conversation/runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../../conversation/runtime/conversation-response-validator.service';
import { CoachConversationHumanContextBuilder } from '../../context/coach-conversation-human-context.builder';
import {
  readOnlyFollowUp,
  referentCompatibility,
} from '../../conversation/runtime/conversation-read-only-referent.policy';

describe('Understanding → builder → engine → parser/validator → formatter', () => {
  let module: TestingModule;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
  });
  afterAll(() => module.close());
  async function subject(
    text: string,
    experience: WorkoutExperienceLevel = 'BEGINNER',
    conditioning: 'LOW' | 'MODERATE' | 'HIGH' | null = 'LOW',
    trainingOverrides: Partial<CoachProfileSnapshot['training']> = {},
  ) {
    const original = routingSnapshot();
    const equipment: readonly WorkoutEquipment[] = [
      'BODYWEIGHT',
      'DUMBBELL',
      'BARBELL',
      'BIKE',
      'ROW_ERGOMETER',
    ];
    const snapshot: CoachProfileSnapshot = {
      ...original,
      physical: {
        ...original.physical,
        ageYears: knownDatum(34),
        heightCm: knownDatum(175),
        currentWeightKg: knownDatum(80),
        activityLevel: knownDatum('MODERATE'),
      },
      nutrition: {
        ...original.nutrition,
        primaryGoal: knownDatum('WEIGHT_LOSS'),
      },
      training: {
        ...original.training,
        primaryGoal: knownDatum('WEIGHT_LOSS'),
        preferredModality: knownDatum('GYM_STRENGTH'),
        experienceLevel: knownDatum(experience),
        perceivedConditioning: conditioning
          ? knownDatum(conditioning)
          : unknownDatum(),
        availableEquipment: knownDatum(equipment),
        environment: knownDatum(
          text.includes('crossfit') ? 'CROSSFIT_BOX' : 'STREET',
        ),
        ...trainingOverrides,
      },
    };
    const understood = await module
      .get(ConversationUnderstandingService)
      .understand(understandingInput(text));
    const decision = module
      .get(ConversationRoutingDecisionService)
      .decide(goalPreparationInput(understood, { snapshot }));
    const built = await new GenerateWorkoutPlanV2InputBuilder(
      {} as never,
      {} as never,
    ).build({
      userId: 'user-id',
      profileId: 'profile-id',
      currentMessage: text,
      snapshot,
      decision: decision.goalDecision,
      referenceDate: new Date(snapshot.referenceDate),
    });
    const input = {
      ...built.generationInput,
      recognizedContext: {
        ...built.generationInput.recognizedContext,
        sessionDurationMinutes: {
          status: 'CONFIRMED' as const,
          value:
            trainingOverrides.sessionDurationMinutes &&
            'value' in trainingOverrides.sessionDurationMinutes
              ? trainingOverrides.sessionDurationMinutes.value
              : 30,
        },
      },
    };
    const events: string[] = [];
    let active: { name: string; version: number; prompt: string } | null = null;
    const legacy = {
      name: WORKOUT_PLANNING_V2_PROMPT_V7.name,
      version: 7,
      prompt: WORKOUT_PLANNING_V2_PROMPT_V7.instructions,
    };
    const prompts = {
      getActive: jest.fn(() => Promise.resolve(active)),
      createVersion: jest.fn((definition: typeof legacy) => {
        events.push('activate-v9');
        active = definition;
        return Promise.resolve(definition);
      }),
      activate: jest.fn(),
    };
    const activation = new WorkoutPromptActivationService(
      prompts as unknown as PromptService,
      {
        promptVersion: { findUnique: jest.fn().mockResolvedValue(null) },
      } as never,
    );
    const ai = {
      createStandaloneJob: jest.fn(() => {
        events.push('create-job');
        return Promise.resolve({
          id: 'job',
          status: 'PENDING',
          promptVersionId: 'v8',
          promptVersion: active,
        });
      }),
      runTextJob: jest.fn(),
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
      undefined,
      activation,
    );
    const prepared = engine.prepare(input);
    if (!prepared.strategy || !prepared.context)
      throw new Error('Expected planning context');
    const candidate = plan(prepared.strategy, experience);
    ai.runTextJob.mockImplementation(() => {
      events.push('provider');
      return Promise.resolve({
        outputText: JSON.stringify(candidate),
        responseId: 'r',
        model: 'structured-provider-double',
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
      });
    });
    return {
      engine,
      input,
      ai,
      candidate,
      strategy: prepared.strategy,
      context: prepared.context,
      events,
      legacy,
      prompts,
      snapshot,
      understood,
    };
  }
  function plan(
    strategy: WorkoutPlanningStrategy,
    level: WorkoutExperienceLevel,
  ): GeneratedWorkoutPlanV2Candidate {
    const crossfit = strategy.modality === 'CROSSFIT';
    const duration =
      strategy.sessionDurationMinutes.status === 'NOT_SET'
        ? 30
        : strategy.sessionDurationMinutes.value;
    const base = (key: string) => ({
      activityKey: key,
      source: 'MODEL_GENERATED' as const,
      equipment: ['BODYWEIGHT' as const],
      alerts: [],
      appliedConstraintCodes: [],
      instruction: 'Mantenha controle e esforço compatível com seu nível.',
    });
    const activity = (
      key: string,
      type: WorkoutBlockType,
      minutes: number,
      focus: string,
      sessionIndex: number,
    ): WorkoutActivityV2 => {
      if (!crossfit)
        return {
          ...base(key),
          kind: 'ENDURANCE',
          name:
            strategy.modality === 'WALKING'
              ? `Caminhada: ${focus}`
              : type === 'ENDURANCE'
                ? 'Corrida leve'
                : 'Caminhada leve',
          mode:
            strategy.modality === 'WALKING' || type !== 'ENDURANCE'
              ? 'WALK'
              : 'RUN',
          movementPattern: 'LOCOMOTION',
          durationMinutes: minutes,
          distanceKm: null,
          intensity:
            strategy.modality === 'WALKING' && type === 'ENDURANCE'
              ? sessionIndex % 2 === 0
                ? 'LIGHT'
                : 'MODERATE'
              : 'CONVERSATIONAL',
        };
      if (type === 'WARM_UP' || type === 'COOLDOWN')
        return {
          ...base(key),
          kind: 'MOBILITY',
          name: 'Mobilidade de quadril e ombros',
          movementPattern: 'MOBILITY',
          publicIdentity: {
            plane: 'TRANSVERSE',
            targetRegion: 'HIPS',
            bodyPosition: 'STANDING',
            jointAction: 'ROTATION',
          },
          durationSeconds: minutes * 60,
          holdSeconds: null,
          repetitions: null,
        };
      return {
        ...base(key),
        kind: 'TIMED',
        name:
          level === 'BEGINNER'
            ? 'Agachamento com apoio e scaling'
            : level === 'INTERMEDIATE'
              ? 'Thruster com halteres'
              : 'Clean técnico com barra',
        equipment:
          level === 'BEGINNER'
            ? ['BODYWEIGHT']
            : level === 'INTERMEDIATE'
              ? ['DUMBBELL']
              : ['BARBELL'],
        movementPattern: 'SQUAT',
        publicIdentity: {
          plane: 'SAGITTAL',
          targetRegion: 'HIPS',
          bodyPosition: 'STANDING',
          jointAction: null,
        },
        durationSeconds: minutes * 60,
        workSeconds: null,
        recoverySeconds: null,
        rounds: 1,
        intensity:
          level === 'BEGINNER'
            ? 'LIGHT'
            : level === 'INTERMEDIATE'
              ? 'MODERATE'
              : 'HIGH',
      };
    };
    return {
      artifactType: 'WEEKLY_PLAN',
      modality: strategy.modality,
      objective: 'WEIGHT_LOSS',
      title: 'Planejamento personalizado',
      sessions: Array.from(
        { length: strategy.sessionCount },
        (_, index) => `Sessão técnica ${index + 1}`,
      ).map((label, index) => ({
        sessionKey: `s${index}`,
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
        label,
        estimatedDurationMinutes: duration,
        blocks: (crossfit
          ? (['WARM_UP', 'TECHNIQUE', 'CONDITIONING', 'COOLDOWN'] as const)
          : (['WARM_UP', 'ENDURANCE', 'COOLDOWN'] as const)
        ).map((type, b) => {
          const minutes =
            ((crossfit ? (b === 0 || b === 3 ? 5 : 10) : b === 1 ? 20 : 5) *
              duration) /
            30;
          return {
            blockKey: `b${index}-${b}`,
            type,
            title: type,
            estimatedDurationMinutes: minutes,
            activities: [
              activity(`a${index}-${b}`, type, minutes, label, index),
            ],
          };
        }),
      })),
      progression: [],
      substitutions: [],
      adaptationRules: [],
      safetyFlags: [],
    };
  }
  it.each([
    ['quero começar no crossfit 3x por semana', 'BEGINNER', 'LOW', 3],
    ['faço crossfit 4x por semana', 'INTERMEDIATE', 'MODERATE', 4],
    ['quero crossfit 5x por semana', 'ADVANCED', 'HIGH', 5],
  ] as const)(
    'validates and formats %s for %s/%s',
    async (text, level, conditioning, count) => {
      const s = await subject(text, level, conditioning);
      const result = await s.engine.generateCandidate(s.input);
      expect(result.output.modality).toBe('CROSSFIT');
      expect(result.output.sessions).toHaveLength(count);
      expect(result.output.validation.status).not.toBe('INVALID');
      const output = new WorkoutPlanV2Formatter()
        .format(result.output)
        .join('\n');
      expect(output).toMatch(/agachamento em pé/iu);
      expect(output).toContain(
        level === 'BEGINNER'
          ? 'peso corporal'
          : level === 'INTERMEDIATE'
            ? 'halteres'
            : 'barra',
      );
      expect(s.strategy.technicalMovementsAllowed).toBe(level !== 'BEGINNER');
      expect(s.events).toEqual(['activate-v9', 'create-job', 'provider']);
      expect(s.legacy.version).toBe(7);
      expect(s.legacy.name).not.toBe(WORKOUT_PLANNING_V2_PROMPT.name);
    },
  );
  it.each([
    ['BEGINNER', null],
    ['INTERMEDIATE', null],
    ['ADVANCED', 'HIGH'],
  ] as const)(
    'executes the production CrossFit request with %s/%s and the canonical gym profile',
    async (level, conditioning) => {
      const text =
        'Monte um treino de Crossfit para mim, 4 vezes por semana, considerando meu perfil e meu nível atual.';
      const equipment: readonly WorkoutEquipment[] = [
        'BARBELL',
        'BENCH',
        'CABLE',
        'DUMBBELL',
        'MACHINE',
        'PULL_UP_BAR',
        'TREADMILL',
      ];
      const s = await subject(text, level, conditioning, {
        preferredModality: knownDatum('RUNNING'),
        weeklyFrequency: knownDatum(5),
        environment: knownDatum('FULL_GYM'),
        availableEquipment: knownDatum(equipment),
        sessionDurationMinutes: knownDatum(60),
      });
      const collector = new CoachAdaptiveProfileCollectorService().decide({
        snapshot: s.snapshot,
        intent: 'WORKOUT_PLAN_REQUEST',
        conversationContext: {
          modality: { value: 'CROSSFIT', evidence: 'EXPLICIT' },
        },
        memory: { interactions: [] },
        recentHistory: { currentLogicalTurn: 10, interactions: [] },
      });
      expect(s.understood.intent).toBe('WORKOUT_PLAN_REQUEST');
      expect(s.understood.metadata.workoutModalityResolution?.modality).toBe(
        'CROSSFIT',
      );
      expect(collector.shouldAsk).toBe(false);
      expect(
        collector.readiness.find((item) => item.plan === 'WORKOUT'),
      ).toEqual(expect.objectContaining({ blockingFields: [], ready: true }));
      const decision = module.get(ConversationRoutingDecisionService).decide(
        goalPreparationInput(s.understood, {
          snapshot: s.snapshot,
          adaptiveDecision: collector,
        }),
      );
      expect(decision.goalDecision).toEqual(
        expect.objectContaining({
          goal: 'GENERATE_WORKOUT_PLAN',
          selectedProfileField: null,
          canExecute: true,
        }),
      );
      const builder = new GenerateWorkoutPlanV2InputBuilder(
        {} as never,
        {} as never,
      );
      const built = await builder.build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot: s.snapshot,
        currentMessage: text,
        decision: decision.goalDecision,
        declaredContext: await builder.resolveDeclaredContext(
          text,
          s.understood.metadata.workoutModalityResolution,
        ),
        referenceDate: new Date(s.snapshot.referenceDate),
      });
      const persist = jest.fn(
        ({
          generation,
        }: PersistWorkoutPlanV2Input): Promise<PersistWorkoutPlanV2Result> =>
          Promise.resolve({
            persistence: 'CREATED',
            aiJobCompleted: true,
            aggregate: {
              id: 'plan',
              userId: 'user-id',
              profileId: 'profile-id',
              aiJobId: generation.aiJobId,
              title: generation.output.title,
              objective: 'WEIGHT_LOSS',
              status: 'ACTIVE',
              document: generation.output,
              days: generation.output.sessions.map((session) => ({
                id: session.sessionKey,
                dayNumber: session.sequence,
                weekday: null,
                title: session.label,
                exercises: [],
              })),
              generatedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
      );
      const application = new WorkoutApplicationExecutorService(s.engine, {
        persist,
      } as never);
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      try {
        const preflight = application.preflight(built.generationInput);
        expect(preflight.kind).toBe('READY');
        if (preflight.kind !== 'READY')
          throw new Error('Production profile should be ready');
        expect(preflight.prepared.resolution.modality).toBe('CROSSFIT');
        expect(preflight.prepared.context?.modality).toEqual({
          status: 'CONFIRMED',
          value: 'CROSSFIT',
        });
        expect(preflight.prepared.context?.training).toEqual(
          expect.objectContaining({
            weeklyFrequency: { status: 'CONFIRMED', value: 4 },
            environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
            equipment: { status: 'CONFIRMED', value: equipment },
            experience: { status: 'CONFIRMED', value: level },
            sessionDurationMinutes: { status: 'CONFIRMED', value: 60 },
            perceivedConditioning: conditioning
              ? { status: 'CONFIRMED', value: conditioning }
              : { status: 'NOT_SET' },
          }),
        );
        expect(preflight.prepared.strategy?.technicalMovementsAllowed).toBe(
          level !== 'BEGINNER',
        );
        const dispatcher = new CoachPlanningExecutionDispatcherService(
          {} as never,
          {} as never,
          {} as never,
          undefined,
          undefined,
          application,
          new WorkoutPlanV2Formatter(),
        );
        const result = await dispatcher.dispatchStructured({
          userId: 'user-id',
          legacyIntent: 'WORKOUT',
          decision: decision.goalDecision,
          workoutV2: {
            generationInput: built.generationInput,
            profileId: 'profile-id',
            correlationId: 'incident',
          },
        });
        expect(result).toEqual(
          expect.objectContaining({
            executor: 'WORKOUT_V2',
            generationCompleted: true,
            workoutDisposition: 'PLAN',
          }),
        );
        expect(result.content).toMatch(/CrossFit/i);
        expect(s.ai.createStandaloneJob).toHaveBeenCalledTimes(1);
        expect(s.ai.createStandaloneJob).toHaveBeenCalledWith(
          expect.objectContaining({
            promptName: WORKOUT_PLANNING_V2_PROMPT.name,
          }),
        );
        expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(s.events).toEqual(['activate-v9', 'create-job', 'provider']);
        expect(
          persist.mock.calls[0][0].generation.output.sessions,
        ).toHaveLength(4);
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining('"workoutPreflightKind":"READY"'),
        );
        const entry = log.mock.calls.find(
          ([value]) =>
            typeof value === 'string' &&
            value.startsWith('Workout preflight: '),
        )?.[0];
        expect(entry).toBe(
          `Workout preflight: ${JSON.stringify({
            workoutPreflightKind: 'READY',
            workoutResolutionReason: 'EXPLICIT_REQUEST',
            workoutReadinessStatus: 'READY',
            workoutMissingFields: [],
            workoutConfirmationRequiredFields: [],
            workoutSafetyOutcome: 'ALLOWED',
            workoutSafetyReasonCodes: ['NO_SAFETY_RESTRICTION'],
            resolvedWorkoutModality: 'CROSSFIT',
          })}`,
        );
        expect(entry).not.toContain(text);
        expect(entry).not.toContain('user-id');
      } finally {
        log.mockRestore();
      }
    },
  );
  it('does not treat unknown conditioning as a blanket technical prohibition', async () => {
    const s = await subject(
      'Monte um treino de Crossfit 4 vezes por semana',
      'ADVANCED',
      null,
      { environment: knownDatum('FULL_GYM') },
    );
    const preflight = new WorkoutApplicationExecutorService(
      s.engine,
      {} as never,
    ).preflight(s.input);
    expect(preflight.kind).toBe('READY');
    expect(s.strategy.technicalMovementsAllowed).toBe(true);
    expect(s.context.training.perceivedConditioning).toEqual({
      status: 'NOT_SET',
    });
    await expect(s.engine.generateCandidate(s.input)).resolves.toMatchObject({
      status: 'PENDING_COMPLETION',
    });
    expect(s.ai.failJob).not.toHaveBeenCalled();
  });
  it.each([
    ['MISSING_LIMITATIONS', 'CLARIFICATION', 'READINESS_BLOCKED'],
    ['ACUTE_PAIN', 'BLOCKED', 'ACUTE_PAIN'],
  ] as const)(
    'reports %s safely and does not call the provider',
    async (signal, kind, reason) => {
      const s = await subject(
        'Monte um treino de Crossfit 4 vezes por semana',
        'INTERMEDIATE',
        null,
        { environment: knownDatum('FULL_GYM') },
      );
      const generationInput = {
        ...s.input,
        snapshot:
          signal === 'MISSING_LIMITATIONS'
            ? {
                ...s.snapshot,
                restrictions: {
                  ...s.snapshot.restrictions,
                  physicalLimitations: unknownDatum(),
                },
              }
            : s.snapshot,
        recognizedContext: {
          ...s.input.recognizedContext,
          safetySignals: signal === 'ACUTE_PAIN' ? ['ACUTE_PAIN' as const] : [],
        },
      };
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      try {
        const application = new WorkoutApplicationExecutorService(
          s.engine,
          {} as never,
        );
        const result = await application.execute({
          generationInput,
          ownership: { userId: 'user-id', profileId: 'profile-id' },
        });
        expect(result.kind).toBe(kind);
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining(`"workoutSafetyReasonCodes":["${reason}"]`),
        );
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining(`"workoutPreflightKind":"${kind}"`),
        );
        expect(s.ai.createStandaloneJob).not.toHaveBeenCalled();
        expect(s.ai.runTextJob).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );
  it('rejects an advanced skill for a beginner before persistence', async () => {
    const s = await subject('quero começar no crossfit 3x por semana');
    const candidate = {
      ...s.candidate,
      sessions: s.candidate.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) => ({
            ...activity,
            name: 'Muscle-up avançado',
          })),
        })),
      })),
    };
    s.ai.runTextJob.mockResolvedValue({
      outputText: JSON.stringify(candidate),
      responseId: 'r',
      model: 'double',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      WorkoutPostGenerationValidationError,
    );
    expect(s.ai.failJob).toHaveBeenCalledTimes(1);
  });
  it('accepts run, walk, bike, row, strength and gymnastics as coherent CrossFit conditioning components', async () => {
    const s = await subject(
      'faço crossfit 4x por semana',
      'INTERMEDIATE',
      'MODERATE',
    );
    const base = {
      activityKey: 'component',
      source: 'MODEL_GENERATED' as const,
      equipment: ['BODYWEIGHT' as const],
      alerts: [],
      appliedConstraintCodes: [],
      instruction: 'Mantenha esforço moderado e controle.',
    };
    const activities: readonly WorkoutActivityV2[] = [
      ...(['RUN', 'WALK', 'CYCLE'] as const).map((mode, index) => ({
        ...base,
        activityKey: `component-${index}`,
        kind: 'ENDURANCE' as const,
        mode,
        name:
          mode === 'CYCLE'
            ? 'Pedalada'
            : mode === 'RUN'
              ? 'Corrida leve'
              : 'Caminhada',
        equipment:
          mode === 'CYCLE' ? ['BIKE' as const] : ['BODYWEIGHT' as const],
        movementPattern: 'LOCOMOTION' as const,
        durationMinutes: 1,
        distanceKm: null,
        intensity: 'MODERATE' as const,
      })),
      {
        ...base,
        activityKey: 'row',
        kind: 'TIMED',
        name: 'Remo ergométrico',
        equipment: ['ROW_ERGOMETER'],
        movementPattern: 'PULL',
        publicIdentity: {
          plane: 'HORIZONTAL',
          targetRegion: 'BACK',
          bodyPosition: 'SEATED',
          jointAction: null,
        },
        durationSeconds: 60,
        workSeconds: null,
        recoverySeconds: null,
        rounds: 1,
        intensity: 'MODERATE',
      },
      {
        ...base,
        activityKey: 'strength',
        kind: 'STRENGTH',
        name: 'Agachamento controlado',
        movementPattern: 'SQUAT',
        publicIdentity: {
          plane: 'SAGITTAL',
          targetRegion: 'HIPS',
          bodyPosition: 'STANDING',
          jointAction: null,
        },
        sets: 1,
        repetitions: '8',
        restSeconds: 0,
        intensity: 'MODERATE',
      },
      {
        ...base,
        activityKey: 'gymnastics',
        kind: 'TIMED',
        name: 'Apoio ginástico no solo',
        movementPattern: 'PUSH',
        publicIdentity: {
          plane: 'HORIZONTAL',
          targetRegion: 'CHEST',
          bodyPosition: 'PRONE',
          jointAction: null,
        },
        durationSeconds: 60,
        workSeconds: null,
        recoverySeconds: null,
        rounds: 1,
        intensity: 'MODERATE',
      },
    ];
    const candidate = {
      ...s.candidate,
      sessions: s.candidate.sessions.map((session, index) => ({
        ...session,
        blocks: session.blocks.map((block) =>
          block.type !== 'CONDITIONING'
            ? block
            : {
                ...block,
                activities: activities.map((activity) => ({
                  ...activity,
                  activityKey: `${index}-${activity.activityKey}`,
                })),
              },
        ),
      })),
    };
    s.ai.runTextJob.mockResolvedValue({
      outputText: JSON.stringify(candidate),
      responseId: 'r',
      model: 'double',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });
    const result = await s.engine.generateCandidate(s.input);
    expect(result.output.validation.status).not.toBe('INVALID');
  });
  it('rejects a V7 job before calling the provider, even after V8 activation', async () => {
    const s = await subject('quero caminhada 5x');
    s.ai.createStandaloneJob.mockResolvedValue({
      id: 'job',
      status: 'PENDING',
      promptVersionId: 'v7',
      promptVersion: s.legacy,
    });
    await expect(s.engine.generateCandidate(s.input)).rejects.toThrow(
      'WORKOUT_PROMPT_VERSION_MISMATCH',
    );
    expect(s.ai.runTextJob).not.toHaveBeenCalled();
    expect(s.ai.failJob).toHaveBeenCalledTimes(1);
  });
  async function assertDeliveredWalkingReferent(projectedLabels: boolean) {
    const conversationId = 'conversation-id';
    const userId = 'user-id';
    const sourceMessages = [
      {
        id: 'dinner',
        content: 'Me sugira um jantar',
        timestamp: new Date('2026-08-01T10:00:00Z'),
      },
    ];
    const deliveries = [
      {
        id: 'dinner-sent',
        userId,
        conversationId,
        content: 'Sopa de lentilhas com legumes.',
        context: {
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'dinner',
          partCount: 1,
          partIndex: 0,
        },
        sentAt: new Date('2026-08-01T10:01:00Z'),
      },
    ];
    const jobs: {
      userId: string;
      result: { candidateOutput: string };
      createdAt: Date;
      completedAt: Date;
    }[] = [];
    for (const [index, text] of [
      'quero começar no crossfit 3x por semana',
      'quero correr na rua 3x',
      'monte um treino de caminhada para mim, 5 vezes por semana',
    ].entries()) {
      const s = await subject(text);
      const candidate = projectedLabels
        ? {
            ...s.candidate,
            sessions: s.candidate.sessions.map((session) => ({
              ...session,
              label: `Sessão no HyperCable9000 ${session.sequence}`,
            })),
          }
        : s.candidate;
      if (projectedLabels)
        s.ai.runTextJob.mockResolvedValue({
          outputText: JSON.stringify(candidate),
          responseId: 'r',
          model: 'structured-provider-double',
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        });
      const generated = await s.engine.generateCandidate(s.input);
      const source = {
        id: `source-${index}`,
        content: text,
        timestamp: new Date(`2026-08-01T10:${10 + index * 10}:00Z`),
      };
      sourceMessages.push(source);
      const content = new WorkoutPlanV2Formatter().format(generated.output);
      expect(content.join('\n')).not.toContain('HyperCable9000');
      content.forEach((part, partIndex) =>
        deliveries.push({
          id: `sent-${index}-${partIndex}`,
          userId,
          conversationId,
          content: part,
          context: {
            source: 'WHATSAPP_COACH_COMMAND',
            sourceMessageId: source.id,
            partCount: content.length,
            partIndex,
          },
          sentAt: new Date(
            source.timestamp.getTime() + 120_000 + partIndex * 1000,
          ),
        }),
      );
      jobs.push({
        userId,
        result: { candidateOutput: JSON.stringify(candidate) },
        createdAt: new Date(source.timestamp.getTime() + 1000),
        completedAt: new Date(source.timestamp.getTime() + 60_000),
      });
    }
    const current = {
      id: 'other',
      timestamp: new Date('2026-08-01T11:00:00Z'),
      replyToExternalMessageId: null,
    };
    const prisma = {
      message: {
        findFirst: jest.fn((query: { where: { id?: string } }) =>
          Promise.resolve(
            query.where.id === current.id
              ? current
              : (sourceMessages.find(
                  (source) => source.id === query.where.id,
                ) ?? null),
          ),
        ),
      },
      scheduledMessage: {
        findFirst: jest.fn(() => Promise.resolve(deliveries.at(-1))),
        findMany: jest.fn((query: { where: { context: { equals: string } } }) =>
          Promise.resolve(
            deliveries.filter(
              (delivery) =>
                delivery.context.sourceMessageId === query.where.context.equals,
            ),
          ),
        ),
      },
      aIJob: {
        findFirst: jest.fn(
          (query: { where: { type: string; createdAt?: { gte: Date } } }) =>
            Promise.resolve(
              query.where.type === 'TEXT'
                ? null
                : (jobs.find(
                    (job) => job.createdAt >= query.where.createdAt!.gte,
                  ) ?? null),
            ),
        ),
      },
      pendingConversationAction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const followUp = new ConversationQAFollowUpContextService(
      prisma as never,
      new ConversationPublicAnswerBoundaryService(),
    );
    const referent = await followUp.findReferent({
      userId,
      conversationId,
      messageId: current.id,
    });
    expect(referent).toMatchObject({
      source: 'DELIVERED_WORKOUT',
      sourceMessageId: 'source-2',
      domain: 'WORKOUT',
      workoutModality: 'WALKING',
      nutrition: null,
    });
    const understanding = await module
      .get(ConversationUnderstandingService)
      .understand(understandingInput('Outra opção'));
    const decision = module
      .get(ConversationRoutingDecisionService)
      .decide(goalPreparationInput(understanding));
    const provider = { execute: jest.fn() };
    const bridge = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      provider as never,
    );
    const humanContext = {
      ...new CoachConversationHumanContextBuilder().build(routingSnapshot(), {
        currentMessage: 'Outra opção',
      }),
      currentReadOnlyReferent: referent,
    };
    const result = await bridge.execute(decision, humanContext, {
      userId,
      conversationId,
      messageId: current.id,
    });
    expect(result).toMatchObject({
      status: 'COMPLETED',
      content:
        'Você quer uma alternativa para qual sessão do treino de caminhada?',
    });
    expect(provider.execute).not.toHaveBeenCalled();
    const explicitRunning = readOnlyFollowUp('Me dá outra opção de corrida');
    if (!referent || !explicitRunning)
      throw new Error('Expected current-turn evidence');
    expect(referentCompatibility(explicitRunning.currentTurn, referent)).toBe(
      'CURRENT_ENTITY',
    );
    prisma.aIJob.findFirst.mockResolvedValue(null);
    expect(
      await followUp.findReferent({
        userId,
        conversationId,
        messageId: current.id,
      }),
    ).toBeNull();
    expect(prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(2);
  }
  it('keeps the latest delivered Walking referent after dinner, CrossFit and Running, and clarifies without a provider', () =>
    assertDeliveredWalkingReferent(false));
  it('preserves the delivered Workout referent when unknown labels have been projected safely', () =>
    assertDeliveredWalkingReferent(true));
  it.each([
    'quero correr na rua 3x',
    'monte um treino de caminhada para mim, 5 vezes por semana',
  ])('validates and formats %s', async (text) => {
    const s = await subject(text);
    const result = await s.engine.generateCandidate(s.input);
    expect(result.output.validation.status).not.toBe('INVALID');
    expect(
      new WorkoutPlanV2Formatter().format(result.output).length,
    ).toBeGreaterThan(0);
    if (result.output.modality === 'WALKING') {
      expect(s.strategy.sessionFocuses).toEqual([]);
      expect(JSON.stringify(result.output)).not.toMatch(
        /"mode":"RUN"|trote|corrida|run\/walk|jogging|sprint/iu,
      );
    } else
      expect(s.context.training.environment).toEqual({
        status: 'CONFIRMED',
        value: 'STREET',
      });
  });
});
