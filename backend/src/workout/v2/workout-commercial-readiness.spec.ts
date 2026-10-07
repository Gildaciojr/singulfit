import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { WorkoutWeekday } from '@prisma/client';
import { ConversationModule } from '../../conversation/conversation.module';
import { ConversationUnderstandingService } from '../../conversation/understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../../conversation/routing/conversation-routing-decision.service';
import {
  understandingInput,
  historyEntry,
} from '../../conversation/tests/conversation-understanding.fixtures';
import {
  routingSnapshot,
  knownDatum,
  goalPreparationInput,
} from '../../conversation/tests/conversation-routing.fixtures';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { estimateWorkoutSession } from './workout-duration-estimator';
import { chunkWorkoutWhatsApp } from './workout-whatsapp.chunker';
import {
  qualityCandidate,
  qualityPlan,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';
import type { WorkoutModality } from './workout-planning-artifact.contract';
import type {
  WorkoutEnvironment,
  WorkoutEquipment,
} from './workout-planning-context.contract';
import type {
  WorkoutSessionV2,
  WorkoutActivityV2,
  WorkoutBlockV2,
  WorkoutActivityBase,
} from './workout-plan-v2.contract';
import { OpenAIGateway } from '../../ai/openai.gateway';
import { isExplicitWorkoutPlanAdjustment } from './workout-plan-adjustment-request.policy';
import { ConversationExecutionBridgeService } from '../../conversation/runtime/conversation-execution-bridge.service';
import { ConversationProfileConsentService } from '../../conversation/runtime/conversation-profile-consent.service';
import { ConversationResponsePayloadBuilder } from '../../conversation/runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../../conversation/runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../../conversation/runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../../conversation/runtime/conversation-response-validator.service';
import type { WorkoutMovementConstraint } from './workout-planning-context.contract';

describe('Commercial hard safety uses execution facts', () => {
  it.each([
    'Não quero mudar meu treino',
    'Eu não preciso alterar meu treino',
    'Posso ajustar meu treino?',
    'Quero mudar minha dieta',
    'Explique como ajustar meu treino',
  ])('does not authorize an adjustment from %s', (text) => {
    expect(isExplicitWorkoutPlanAdjustment(text)).toBe(false);
  });
  it.each<readonly [WorkoutMovementConstraint['code'], WorkoutActivityV2]>([
    ['KNEE_LOAD', strength()],
    [
      'OVERHEAD',
      {
        ...strength(),
        name: 'Empurrada vertical',
        movementPattern: 'PUSH',
        publicIdentity: {
          targetRegion: 'SHOULDERS',
          plane: 'VERTICAL',
          bodyPosition: 'SEATED',
          jointAction: null,
        },
      },
    ],
    [
      'SPINAL_LOAD',
      {
        ...strength(),
        name: 'Terra romeno com barra',
        movementPattern: 'HINGE',
        equipment: ['BARBELL'],
        publicIdentity: {
          targetRegion: 'HIPS',
          plane: 'SAGITTAL',
          bodyPosition: 'STANDING',
          jointAction: null,
        },
      },
    ],
  ])(
    'blocks confirmed %s independently of the human alias',
    (code, activity) => {
      const original = qualityContext(['MONDAY']);
      const context = {
        ...original,
        movementConstraints: [
          { code, label: 'Limitação confirmada', status: 'CONFIRMED' as const },
        ],
      };
      const strategy = {
        ...new WorkoutPlanningStrategyService().build(context),
        authorizedEquipment: ['BODYWEIGHT', 'BARBELL'] as const,
      };
      expect(
        new WorkoutPlanV2Validator().validate(
          qualityCandidate([qualitySession('limited', [activity])]),
          context,
          strategy,
          true,
        ).issues,
      ).toContainEqual(
        expect.objectContaining({
          code: 'LIMITATION_CONFLICT',
          severity: 'ERROR',
        }),
      );
    },
  );
});

interface CommercialCase {
  readonly modality: WorkoutModality;
  readonly request: string;
  readonly frequency: number;
  readonly minutes: number;
  readonly environment: WorkoutEnvironment;
  readonly equipment: readonly WorkoutEquipment[];
}
const cases: readonly CommercialCase[] = [
  ...(
    [
      [2, 30],
      [3, 45],
      [4, 60],
      [5, 60],
    ] as const
  ).map(([frequency, minutes]) => ({
    modality: 'GYM_STRENGTH' as const,
    request: 'musculação',
    frequency,
    minutes,
    environment: 'FULL_GYM' as const,
    equipment: ['BARBELL', 'DUMBBELL', 'CABLE'] as const,
  })),
  ...(
    [
      [2, 30],
      [4, 60],
    ] as const
  ).map(([frequency, minutes]) => ({
    modality: 'CROSSFIT' as const,
    request: 'CrossFit',
    frequency,
    minutes,
    environment: 'CROSSFIT_BOX' as const,
    equipment: ['DUMBBELL'] as const,
  })),
  ...(
    [
      [3, 30],
      [4, 45],
    ] as const
  ).map(([frequency, minutes]) => ({
    modality: 'RUNNING' as const,
    request: 'corrida',
    frequency,
    minutes,
    environment: 'STREET' as const,
    equipment: ['BODYWEIGHT'] as const,
  })),
  ...(
    [
      [2, 20],
      [3, 30],
    ] as const
  ).map(([frequency, minutes]) => ({
    modality: 'HOME_WORKOUT' as const,
    request: 'treino em casa sem equipamentos',
    frequency,
    minutes,
    environment: 'HOME' as const,
    equipment: ['BODYWEIGHT'] as const,
  })),
  {
    modality: 'WALKING',
    request: 'caminhada',
    frequency: 3,
    minutes: 30,
    environment: 'STREET',
    equipment: ['BODYWEIGHT'],
  },
  {
    modality: 'CYCLING',
    request: 'ciclismo',
    frequency: 3,
    minutes: 45,
    environment: 'OUTDOOR_BIKE',
    equipment: ['BIKE'],
  },
  {
    modality: 'FUNCTIONAL',
    request: 'treino funcional',
    frequency: 3,
    minutes: 30,
    environment: 'HOME',
    equipment: ['BODYWEIGHT'],
  },
  {
    modality: 'CARDIO_CONDITIONING',
    request: 'treino cardio',
    frequency: 3,
    minutes: 30,
    environment: 'STREET',
    equipment: ['BODYWEIGHT'],
  },
];

// Authored provider candidates exercise contracts; no production programming is generated here.
function sessionsFor(item: CommercialCase): readonly WorkoutSessionV2[] {
  const base = (key: string): WorkoutActivityBase => {
    const {
      activityKey,
      name,
      source,
      movementPattern,
      publicIdentity,
      equipment,
      instruction,
      alerts,
      appliedConstraintCodes,
    } = strength(key);
    return {
      activityKey,
      name,
      source,
      movementPattern,
      publicIdentity,
      equipment,
      instruction,
      alerts,
      appliedConstraintCodes,
    };
  };
  const days = [
    WorkoutWeekday.MONDAY,
    WorkoutWeekday.THURSDAY,
    WorkoutWeekday.TUESDAY,
    WorkoutWeekday.FRIDAY,
    WorkoutWeekday.WEDNESDAY,
  ];
  return Array.from({ length: item.frequency }, (_, index) => {
    const prefix = `commercial-${index}`;
    const locomotion = (
      key: string,
      minutes: number,
      mode: 'WALK' | 'RUN' | 'CYCLE',
    ): WorkoutActivityV2 => ({
      ...base(key),
      kind: 'ENDURANCE',
      mode,
      name: { WALK: 'Caminhada', RUN: 'Corrida', CYCLE: 'Ciclismo' }[mode],
      movementPattern: 'LOCOMOTION',
      equipment: mode === 'CYCLE' ? ['BIKE'] : ['BODYWEIGHT'],
      durationMinutes: minutes,
      distanceKm: null,
      intensity: 'CONVERSATIONAL',
    });
    const mobility: WorkoutActivityV2 = {
      ...base(`${prefix}-mobility`),
      kind: 'MOBILITY',
      movementPattern: 'MOBILITY',
      name: 'Mobilidade final',
      repetitions: null,
      holdSeconds: null,
      durationSeconds: 120,
      publicIdentity: {
        targetRegion: 'WHOLE_BODY',
        bodyPosition: 'STANDING',
        plane: 'NONE',
        jointAction: null,
      },
    };
    const blocks: WorkoutBlockV2[] = [
      {
        blockKey: `${prefix}-warm`,
        type: 'WARM_UP',
        title: 'Aquecimento',
        estimatedDurationMinutes: 2,
        activities: [locomotion(`${prefix}-warm-walk`, 2, 'WALK')],
      },
    ];
    const mainMinutes = item.minutes - 4;
    if (item.modality === 'GYM_STRENGTH' || item.modality === 'HOME_WORKOUT') {
      const count =
        item.minutes <= 20
          ? 3
          : item.minutes <= 30
            ? 4
            : item.minutes <= 45
              ? 5
              : 6;
      const sets = item.minutes <= 30 ? 3 : 4;
      const names = [
        'Agachamento livre',
        'Flexão de braços',
        'Ponte de quadril',
      ];
      const patterns = ['SQUAT', 'PUSH', 'HINGE'] as const;
      const identities = [
        {
          targetRegion: 'HIPS',
          bodyPosition: 'STANDING',
          plane: 'SAGITTAL',
          jointAction: null,
        },
        {
          targetRegion: 'CHEST',
          bodyPosition: 'PRONE',
          plane: 'HORIZONTAL',
          jointAction: null,
        },
        {
          targetRegion: 'HIPS',
          bodyPosition: 'LYING',
          plane: 'SAGITTAL',
          jointAction: 'EXTENSION',
        },
      ] as const;
      blocks.push({
        blockKey: `${prefix}-main`,
        type: 'STRENGTH',
        title: 'Principal',
        estimatedDurationMinutes: mainMinutes,
        activities: Array.from({ length: count }, (_, n) => ({
          ...strength(`${prefix}-lift-${n}`),
          name: names[n % 3],
          movementPattern: patterns[n % 3],
          publicIdentity: identities[n % 3],
          sets,
          repetitions: '10',
          restSeconds: item.minutes <= 30 ? 60 : 90,
          instruction: 'Mantenha a técnica. Use RPE 6-7.',
        })),
      });
    } else if (item.modality === 'CROSSFIT' || item.modality === 'FUNCTIONAL') {
      const activity: WorkoutActivityV2 = {
        ...base(`${prefix}-wod`),
        kind: 'TIMED',
        intensity: 'MODERATE',
        durationSeconds: mainMinutes * 60,
        workSeconds: null,
        recoverySeconds: null,
        rounds: 1,
      };
      blocks.push({
        blockKey: `${prefix}-main`,
        type: 'CONDITIONING',
        title: 'Condicionamento',
        estimatedDurationMinutes: mainMinutes,
        activities: [
          activity,
          {
            ...activity,
            activityKey: `${prefix}-wod-push`,
            name: 'Flexão de braços',
            movementPattern: 'PUSH',
            publicIdentity: {
              targetRegion: 'CHEST',
              bodyPosition: 'PRONE',
              plane: 'HORIZONTAL',
              jointAction: null,
            },
          },
        ],
        work: {
          format: 'AMRAP',
          rounds: null,
          durationSeconds: mainMinutes * 60,
          intervalSeconds: null,
          movementActivityKeys: [activity.activityKey, `${prefix}-wod-push`],
        },
      });
    } else {
      blocks.push({
        blockKey: `${prefix}-main`,
        type: 'ENDURANCE',
        title: 'Condicionamento',
        estimatedDurationMinutes: mainMinutes,
        activities: [
          locomotion(
            `${prefix}-main-locomotion`,
            mainMinutes,
            item.modality === 'CYCLING'
              ? 'CYCLE'
              : item.modality === 'WALKING'
                ? 'WALK'
                : 'RUN',
          ),
        ],
      });
    }
    blocks.push({
      blockKey: `${prefix}-cool`,
      type: 'COOLDOWN',
      title: 'Desaceleração',
      estimatedDurationMinutes: 2,
      activities: [mobility],
    });
    return {
      sessionKey: prefix,
      sequence: index + 1,
      weekday: days[index],
      label: 'Corpo inteiro',
      estimatedDurationMinutes: item.minutes,
      blocks,
    };
  });
}

describe('Commercial modality matrix without provider calls', () => {
  let module: TestingModule;
  const provider = jest
    .spyOn(OpenAIGateway.prototype, 'createTextResponse')
    .mockRejectedValue(new Error('Commercial matrix must not call provider'));
  const logger = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
  });
  afterAll(async () => {
    await module.close();
    provider.mockRestore();
    logger.mockRestore();
  });
  it.each([
    ['Monte um treino novo', 'GENERATE_PLAN'],
    ['Quero um treino de corrida', 'GENERATE_PLAN'],
    ['Qual é meu treino atual?', 'PRESENT_CURRENT_PLAN'],
    ['Troque esse exercício por outro.', 'SUBSTITUTE_ITEM'],
    ['Não tenho barra hoje.', 'ANSWER'],
    ['Hoje só tenho 20 minutos.', 'ANSWER'],
    ['Estou muito cansado hoje.', 'ANSWER'],
    ['Não quero treinar perna hoje.', 'ANSWER'],
    ['Posso fazer esse treino amanhã?', 'PROVIDE_GUIDANCE'],
    ['Quero mudar meu treino para 3 vezes por semana.', 'UPDATE_PLAN'],
    ['Quero ajustar meu treino atual para 3 vezes por semana.', 'UPDATE_PLAN'],
    ['Quero treinar em casa essa semana.', 'GENERATE_PLAN'],
    ['Esse exercício está difícil.', 'ANSWER'],
    ['Já fiz meu treino hoje.', 'ANSWER'],
    ['Monte outro treino considerando meu perfil.', 'GENERATE_PLAN'],
  ])('audits existing conversation path for %s', async (text, operation) => {
    const result = await module
      .get(ConversationUnderstandingService)
      .understand(
        understandingInput(text, {
          targetPlan: 'WORKOUT',
          workoutAvailable: true,
          recentHistory: [
            historyEntry(
              'Seu treino atual: Agachamento livre. Faça 3 séries de 10.',
            ),
          ],
        }),
      );
    expect(result.operation).toBe(operation);
    const route = module.get(ConversationRoutingDecisionService).decide(
      goalPreparationInput(result, {
        snapshot: routingSnapshot({ workoutAvailable: true }),
      }),
    ).executionRoute;
    if (operation === 'UPDATE_PLAN')
      expect(route.kind).toBe('WORKOUT_PLAN_UPDATE');
    if (operation === 'ANSWER' || operation === 'PROVIDE_GUIDANCE')
      expect(route.kind).not.toMatch(/PLAN_GENERATION|PLAN_UPDATE/u);
  });
  it.each([
    'Hoje só tenho 20 minutos',
    'Não tenho barra hoje',
    'Estou muito cansado hoje',
    'Quero treinar em casa essa semana',
  ])('does not authorize a permanent profile update from %s', async (text) => {
    // The pure consent classifier does not access its persistence dependencies.
    expect(ConversationProfileConsentService.prototype.accepts(text)).toBe(
      false,
    );
    expect(isExplicitWorkoutPlanAdjustment(text)).toBe(false);
    const result = await module
      .get(ConversationUnderstandingService)
      .understand(
        understandingInput(text, {
          targetPlan: 'WORKOUT',
          workoutAvailable: true,
          recentHistory: [historyEntry('Seu treino atual: Agachamento livre.')],
        }),
      );
    const decision = module.get(ConversationRoutingDecisionService).decide(
      goalPreparationInput(result, {
        snapshot: routingSnapshot({ workoutAvailable: true }),
      }),
    );
    if (text.includes('essa semana')) {
      // A requested weekly plan can be generated; it is not profile consent.
      expect(decision.executionRoute.kind).toBe('WORKOUT_PLAN_GENERATION');
    } else {
      // The real bridge completes these turns without delegating to planning.
      expect(decision.executionRoute.kind).toBe('ANSWER_MESSAGE');
      const bridge = new ConversationExecutionBridgeService(
        new ConversationResponsePayloadBuilder(),
        new ConversationLanguageRealizerService(),
        new ConversationResponseFormatterService(),
        new ConversationResponseValidatorService(),
      );
      await expect(bridge.execute(decision)).resolves.toMatchObject({
        status: 'COMPLETED',
        routeKind: 'ANSWER_MESSAGE',
      });
    }
  });
  it.each(cases)(
    '$modality $frequency x $minutes preserves current request through validator and WhatsApp',
    async (item) => {
      const original = routingSnapshot();
      const snapshot = {
        ...original,
        routine: {
          ...original.routine,
          availableTrainingDays: knownDatum([
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
          ]),
        },
        training: {
          ...original.training,
          weeklyFrequency: knownDatum(5),
          sessionDurationMinutes: knownDatum(60),
          preferredModality: knownDatum('RUNNING'),
          availableEquipment: knownDatum(item.equipment),
          environment: knownDatum(item.environment),
          experienceLevel: knownDatum('INTERMEDIATE'),
        },
      };
      const text = `Monte um ${item.request} para mim, ${item.frequency} vezes por semana, com ${item.minutes} minutos por treino.`;
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(
          understandingInput(text, {
            recentHistory: [
              historyEntry(
                'Seu treino anterior é corrida 5 vezes por semana com 60 minutos.',
              ),
            ],
          }),
        );
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide(goalPreparationInput(understanding, { snapshot })).goalDecision;
      const built = await new GenerateWorkoutPlanV2InputBuilder(
        {} as never,
        { fitnessCheckIn: { findMany: () => Promise.resolve([]) } } as never,
      ).build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot,
        decision,
        currentMessage: text,
        referenceDate: new Date(snapshot.referenceDate),
      });
      const context = new WorkoutPlanningContextBuilder().build({
        ...built.generationInput,
        artifactType: 'WEEKLY_PLAN',
        modality: item.modality,
      });
      expect(context.modality).toEqual({
        status: 'CONFIRMED',
        value: item.modality,
      });
      expect(built.generationInput.recognizedContext?.modality).toEqual({
        status: 'CONFIRMED',
        value: item.modality,
      });
      expect(context.resolvedFacts?.weeklyFrequency.source).toBe(
        'CURRENT_EXPLICIT',
      );
      expect(context.resolvedFacts?.sessionDurationMinutes.source).toBe(
        'CURRENT_EXPLICIT',
      );
      const strategy = new WorkoutPlanningStrategyService().build(context);
      expect(strategy.sessionCount).toBe(item.frequency);
      expect(strategy.environment).toEqual({
        status: 'CONFIRMED',
        value: item.environment,
      });
      expect(strategy.experience).toEqual({
        status: 'CONFIRMED',
        value: 'INTERMEDIATE',
      });
      expect(context.training.availableTrainingDays).toEqual({
        status: 'CONFIRMED',
        value: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      });
      expect(strategy.authorizedEquipment).toEqual(
        expect.arrayContaining(item.equipment),
      );
      expect(strategy.sessionDurationMinutes).toEqual({
        status: 'CONFIRMED',
        value: item.minutes,
      });
      const authored = {
        ...qualityCandidate([...sessionsFor(item)]),
        modality: item.modality,
        objective:
          strategy.objective.status === 'NOT_SET'
            ? 'GENERAL_HEALTH'
            : strategy.objective.value,
      };
      const candidate = new WorkoutPlanV2Parser().parse(
        JSON.stringify(authored),
      );
      const validation = new WorkoutPlanV2Validator().validate(
        candidate,
        context,
        strategy,
        true,
      );
      expect(
        validation.issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(new Set(candidate.sessions.map((s) => s.weekday)).size).toBe(
        item.frequency,
      );
      for (const session of candidate.sessions) {
        const estimate = estimateWorkoutSession(session);
        expect(estimate.minimumMinutes).toBeLessThanOrEqual(item.minutes * 1.2);
        expect(estimate.maximumMinutes).toBeGreaterThanOrEqual(
          item.minutes * 0.8,
        );
      }
      const plan = { ...qualityPlan(), ...candidate, strategy, validation };
      const before = JSON.stringify(plan);
      const messages = new WorkoutPlanV2Formatter().format(plan);
      const output = messages.join('\n');
      expect(output).toContain(`Frequência:* ${item.frequency}x`);
      expect(output).toContain(`${item.minutes} min por sessão`);
      expect(output).not.toMatch(
        /NOT_SET|CURRENT_EXPLICIT|BODYWEIGHT|movementPattern|AIJob|Padrão de|Movimento de empurrar/u,
      );
      expect(
        chunkWorkoutWhatsApp(output).every((chunk) => chunk.length <= 3500),
      ).toBe(true);
      expect(JSON.stringify(plan)).toBe(before);
      expect(provider).not.toHaveBeenCalled();
    },
  );
});
