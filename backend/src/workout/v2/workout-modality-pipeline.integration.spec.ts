import { Test, type TestingModule } from '@nestjs/testing';
import { AIService } from '../../ai/ai.service';
import { PromptService } from '../../ai/prompt.service';
import { ConversationModule } from '../../conversation/conversation.module';
import { ConversationUnderstandingService } from '../../conversation/understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../../conversation/routing/conversation-routing-decision.service';
import { understandingInput } from '../../conversation/tests/conversation-understanding.fixtures';
import {
  routingSnapshot,
  knownDatum,
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
    conditioning: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW',
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
      physical: { ...original.physical, ageYears: knownDatum(34) },
      nutrition: {
        ...original.nutrition,
        primaryGoal: knownDatum('WEIGHT_LOSS'),
      },
      training: {
        ...original.training,
        primaryGoal: knownDatum('WEIGHT_LOSS'),
        preferredModality: knownDatum('GYM_STRENGTH'),
        experienceLevel: knownDatum(experience),
        perceivedConditioning: knownDatum(conditioning),
        availableEquipment: knownDatum(equipment),
        environment: knownDatum(
          text.includes('crossfit') ? 'CROSSFIT_BOX' : 'STREET',
        ),
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
        sessionDurationMinutes: { status: 'CONFIRMED' as const, value: 30 },
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
        events.push('activate-v8');
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
    };
  }
  function plan(
    strategy: WorkoutPlanningStrategy,
    level: WorkoutExperienceLevel,
  ): GeneratedWorkoutPlanV2Candidate {
    const crossfit = strategy.modality === 'CROSSFIT';
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
      sessions: strategy.sessionFocuses.map((label, index) => ({
        sessionKey: `s${index}`,
        sequence: index + 1,
        label,
        estimatedDurationMinutes: 30,
        blocks: strategy.requiredBlocks.map((type, b) => {
          const minutes =
            strategy.requiredBlocks.length === 4
              ? b === 0 || b === 3
                ? 5
                : 10
              : b === 1
                ? 20
                : 5;
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
      expect(output).toContain(
        level === 'BEGINNER'
          ? 'scaling'
          : level === 'INTERMEDIATE'
            ? 'Thruster'
            : 'Clean',
      );
      expect(s.strategy.technicalMovementsAllowed).toBe(level !== 'BEGINNER');
      expect(s.events).toEqual(['activate-v8', 'create-job', 'provider']);
      expect(s.legacy.version).toBe(7);
      expect(s.legacy.name).not.toBe(WORKOUT_PLANNING_V2_PROMPT.name);
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
  it('keeps the latest delivered Walking referent after dinner, CrossFit and Running, and clarifies without a provider', async () => {
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
      const generated = await s.engine.generateCandidate(s.input);
      const source = {
        id: `source-${index}`,
        content: text,
        timestamp: new Date(`2026-08-01T10:${10 + index * 10}:00Z`),
      };
      sourceMessages.push(source);
      const content = new WorkoutPlanV2Formatter().format(generated.output);
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
        result: { candidateOutput: JSON.stringify(s.candidate) },
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
  });
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
      expect(new Set(s.strategy.sessionFocuses).size).toBe(5);
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
