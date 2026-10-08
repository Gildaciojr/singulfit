import { PersonalizedCoachContextService } from '../runtime/personalized-coach-context.service';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationCurrentNutritionContextService } from '../runtime/conversation-current-nutrition-context.service';
import { AIService } from '../../ai/ai.service';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';

describe('PersonalizedCoachContextService', () => {
  const at = new Date('2026-08-24T03:30:00Z');
  const known = (value: unknown) => ({
    status: 'KNOWN',
    value,
    sources: ['PROFILE_ACQUISITION'],
  });
  function setup() {
    const snapshot = {
      identity: {
        userId: { status: 'KNOWN', value: 'user', sources: ['USER'] },
        displayName: {
          status: 'KNOWN',
          value: '  Gildacio   Junior ',
          sources: ['USER'],
        },
      },
      training: {
        primaryGoal: known('WEIGHT_LOSS'),
        environment: known('HOME'),
        availableEquipment: known(['HALTERES']),
        weeklyFrequency: known(3),
        targetDistanceKm: known(10),
        currentRunningDistanceKm: known(2),
      },
      nutrition: {
        declaredFoodRejections: known(['peixe']),
        foodIntolerances: known([{ description: 'lactose' }]),
      },
      restrictions: {
        allergies: { status: 'UNKNOWN' },
        physicalLimitations: { status: 'UNKNOWN' },
      },
      routine: {},
      preferences: {},
      conflicts: [],
      conversation: { timezone: known('America/Sao_Paulo') },
    };
    const snapshots = {
      build: jest
        .fn()
        .mockResolvedValue(snapshot as unknown as CoachProfileSnapshot),
    };
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'inbound',
          content: 'essa semana só consigo treinar em casa 3x',
          timestamp: at,
          conversation: { id: 'conversation', userId: 'user' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      coachProfileFieldValue: { findMany: jest.fn().mockResolvedValue([]) },
      fitnessCheckIn: { findMany: jest.fn().mockResolvedValue([]) },
      scheduledMessage: { findMany: jest.fn().mockResolvedValue([]) },
      conversationMemory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const nutrition = { getCurrent: jest.fn().mockResolvedValue(null) };
    const workout = {
      read: jest.fn().mockResolvedValue({ status: 'NO_PLAN', plan: null }),
      readPrevious: jest.fn().mockResolvedValue(null),
    };
    const consumption = {
      summarize: jest.fn().mockResolvedValue({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        mealCount: 0,
        periodStart: new Date('2026-08-24T03:00:00Z'),
        periodEnd: new Date('2026-08-31T03:00:00Z'),
      }),
    };
    const service = new PersonalizedCoachContextService(
      prisma as unknown as PrismaService,
      snapshots as unknown as CoachProfileSnapshotBuilder,
      nutrition as unknown as CurrentNutritionPlanReaderService,
      workout as unknown as CurrentWorkoutPlanReaderService,
      consumption as unknown as NutritionConsumptionSummaryService,
    );
    const input = {
      userId: 'user',
      conversationId: 'conversation',
      messageId: 'inbound',
      referenceDate: at,
    };
    return {
      service,
      prisma,
      snapshots,
      snapshot,
      nutrition,
      workout,
      consumption,
      input,
    };
  }
  it('exposes only the canonical first name in personalized identity', async () => {
    const s = setup();
    const context = await s.service.build(s.input);
    expect(context).toMatchObject({ identity: { preferredName: 'Gildacio' } });
    s.snapshot.identity.displayName.value = '  ';
    expect(await s.service.build(s.input)).toMatchObject({
      identity: { preferredName: null },
    });
  });
  it.each([
    ['WEIGHT_LOSS', 1800, 110],
    ['MUSCLE_GAIN', 2600, 150],
  ] as const)(
    'projects the actual %s nutrition strategy and separates today from the week',
    async (goal, calories, protein) => {
      const s = setup();
      s.snapshots.build.mockResolvedValue({
        ...s.snapshot,
        nutrition: { ...s.snapshot.nutrition, primaryGoal: known(goal) },
      } as unknown as CoachProfileSnapshot);
      s.nutrition.getCurrent.mockResolvedValue({
        userId: 'user',
        implementation: 'LEGACY',
        title: 'Plano alimentar',
        objective: goal,
        dailyCaloriesTarget: calories,
        proteinTarget: protein,
        carbsTarget: 220,
        fatTarget: 60,
        meals: [],
      });
      s.consumption.summarize.mockImplementation(
        (request: { period: string }) =>
          Promise.resolve({
            calories: request.period === 'TODAY' ? 400 : 1200,
            protein: request.period === 'TODAY' ? 30 : 90,
            carbs: 50,
            fat: 10,
            mealCount: request.period === 'TODAY' ? 1 : 3,
            periodStart: at,
            periodEnd: at,
          }),
      );
      const context = await s.service.build(s.input);
      expect(context).toMatchObject({
        goals: { nutrition: { status: 'KNOWN', value: goal } },
        activeNutritionPlan: {
          objective: goal,
          dailyCaloriesTarget: calories,
          proteinTarget: protein,
        },
        relevantProgress: {
          recordedMealConsumptionToday: { calories: 400, analyzedMealCount: 1 },
          recordedMealConsumption: { calories: 1200, analyzedMealCount: 3 },
        },
      });
      expect(s.consumption.summarize).toHaveBeenCalledWith({
        userId: 'user',
        period: 'TODAY',
        referenceDate: at,
        timezone: 'America/Sao_Paulo',
      });
    },
  );
  it.each([
    ['qual é meu objetivo?', 'emagrecimento'],
    ['onde eu disse que treino?', 'em casa'],
    ['quais equipamentos eu tenho?', 'halteres'],
    ['quantas vezes por semana eu disse que posso treinar?', '3 vezes'],
    ['qual distância eu quero correr?', '10 km'],
    ['qual foi a distância que eu disse que corro hoje?', '2 km'],
    ['eu disse que não gosto de peixe?', 'peixe'],
    ['eu disse que tenho intolerância a lactose?', 'lactose'],
    ['você lembra que treino em casa?', 'em casa'],
  ])(
    'answers %s using the canonical entity recognizer and confirmed facts',
    async (request, expected) => {
      const s = setup();
      const context = await s.service.build(s.input);
      const entities = new ConversationEntityRecognizerService().recognize(
        new ConversationMessageNormalizerService().normalize(request),
      ).entities;
      expect(s.service.answer(context, entities, request)).toContain(expected);
    },
  );
  it('does not invent allergy memory, knee injury, completion, expenditure or progression', async () => {
    const s = setup();
    const context = await s.service.build(s.input);
    const request = 'eu sou alérgico a amendoim?';
    const entities = new ConversationEntityRecognizerService().recognize(
      new ConversationMessageNormalizerService().normalize(request),
    ).entities;
    expect(s.service.answer(context, entities, request)).toContain(
      'Não tenho essa informação confirmada',
    );
    expect(context).toMatchObject({
      safety: { physicalLimitations: { status: 'UNKNOWN' } },
      previousWorkoutPlan: null,
      activeWorkoutPlan: null,
      relevantProgress: {
        recordedMealConsumption: { analyzedMealCount: 0 },
        checkIns: [],
        reminders: [],
      },
      policy: { noExpenditureSource: true },
    });
  });
  it.each([
    'Você é alérgico a amendoim.',
    'Você tem uma lesão no joelho.',
    'Você consumiu 1500 kcal.',
    'Você completou seu treino.',
    'Você queimou 600 kcal.',
    'Seu treino progrediu nesta semana.',
    'Seu próximo treino será às 18h.',
  ])('rejects unsupported provider assertion: %s', async (answer) => {
    const s = setup();
    expect(
      s.service.validatesAnswer(await s.service.build(s.input), answer),
    ).toBe(false);
  });
  it('accepts an explicit absence of recorded progress without fabricating results', async () => {
    const s = setup();
    expect(
      s.service.validatesAnswer(
        await s.service.build(s.input),
        'Não há consumo ou conclusão de treino registrados nesta semana.',
      ),
    ).toBe(true);
  });
  it('clarifies an isolated dislike before any permanent preference or contextual mutation', async () => {
    const s = setup();
    expect(
      s.service.answer(
        await s.service.build(s.input),
        [],
        'não gosto de peixe',
      ),
    ).toContain('registrar essa preferência');
  });
  it.each([
    'INFERRED',
    'ANSWERED_UNCONFIRMED',
    'CONFLICTED',
    'UNKNOWN',
    'DECLINED',
    'DEFERRED',
    'NOT_APPLICABLE',
  ])('does not call %s information confirmed', async (status) => {
    const s = setup();
    s.prisma.coachProfileFieldValue.findMany.mockResolvedValue([
      {
        userId: 'user',
        field: 'TRAINING_ENVIRONMENT',
        status,
        referenceDate: at,
        textValue: 'HOME',
        isActive: true,
      },
    ]);
    const context = await s.service.build(s.input);
    expect(
      s.service.answer(
        context,
        [{ kind: 'PROFILE_FIELD', field: 'TRAINING_ENVIRONMENT' }],
        'onde treino?',
      ),
    ).toMatch(/não tenho|conflitantes/iu);
  });
  it('keeps confirmed before inferred, current declaration separate and deeply immutable', async () => {
    const s = setup();
    s.prisma.coachProfileFieldValue.findMany.mockResolvedValue([
      {
        userId: 'user',
        field: 'TRAINING_ENVIRONMENT',
        status: 'INFERRED',
        referenceDate: at,
        textValue: 'FULL_GYM',
        isActive: true,
      },
      {
        userId: 'user',
        field: 'TRAINING_ENVIRONMENT',
        status: 'CONFIRMED',
        referenceDate: at,
        textValue: 'HOME',
        isActive: true,
      },
    ]);
    const context = await s.service.build(s.input);
    expect(context).toMatchObject({
      currentDeclaration: 'essa semana só consigo treinar em casa 3x',
      profileFields: [
        { field: 'TRAINING_ENVIRONMENT', status: 'CONFIRMED', value: 'HOME' },
      ],
      policy: { currentDeclarationDoesNotUpdateProfile: true },
    });
    expect(Object.isFrozen(context)).toBe(true);
    if (!context || typeof context !== 'object' || Array.isArray(context))
      throw new Error('Invalid context');
    expect(Object.isFrozen(context.training)).toBe(true);
  });
  it('rejects a foreign inbound or snapshot before using it', async () => {
    const s = setup();
    s.prisma.message.findFirst.mockResolvedValue({
      id: 'inbound',
      timestamp: at,
      conversation: { id: 'conversation', userId: 'other' },
    });
    await expect(s.service.build(s.input)).rejects.toThrow('ownership');
    expect(s.snapshots.build).not.toHaveBeenCalled();
    const other = setup();
    other.snapshot.identity.userId = known('other');
    await expect(other.service.build(other.input)).rejects.toThrow('ownership');
  });
  it('filters foreign plans, facts, progress, memory and foreign/future conversation rows returned by mocks', async () => {
    const s = setup();
    s.nutrition.getCurrent.mockResolvedValue({
      userId: 'other',
      implementation: 'V2',
      title: 'foreign plan',
    });
    s.workout.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: { userId: 'other', document: {} },
    });
    s.prisma.coachProfileFieldValue.findMany.mockResolvedValue([
      {
        userId: 'other',
        referenceDate: at,
        field: 'ALLERGIES',
        textValue: 'foreign allergy',
      },
    ]);
    s.prisma.conversationMemory.findMany.mockResolvedValue([
      { userId: 'other', generatedAt: at, summary: 'foreign memory' },
    ]);
    s.prisma.fitnessCheckIn.findMany.mockResolvedValue([
      { userId: 'other', createdAt: at, profile: { userId: 'other' } },
    ]);
    s.prisma.scheduledMessage.findMany.mockResolvedValue([
      {
        userId: 'other',
        conversationId: 'conversation',
        scheduledFor: at,
        sentAt: at,
        content: 'foreign scheduled',
        context: { secret: 'foreign context' },
      },
    ]);
    s.prisma.message.findMany.mockResolvedValue([
      {
        content: 'foreign conversation',
        timestamp: at,
        conversation: { id: 'other', userId: 'other' },
      },
      {
        content: 'future message',
        timestamp: new Date(at.getTime() + 1),
        conversation: { id: 'conversation', userId: 'user' },
      },
    ]);
    const context = await s.service.build(s.input);
    expect(JSON.stringify(context)).not.toMatch(/foreign|future message/iu);
    expect(context).toMatchObject({
      activeNutritionPlan: null,
      activeWorkoutPlan: null,
      memories: [],
      recentConversation: [],
    });
    const ai = {
      createJob: jest
        .fn()
        .mockResolvedValue({ id: 'qa-job', userId: 'user', status: 'PENDING' }),
      runTextJob: jest
        .fn()
        .mockRejectedValue(new Error('controlled provider stub')),
      failJob: jest.fn(),
    };
    const qa = new ConversationQAExecutorService(
      ai as unknown as AIService,
      s.prisma as unknown as PrismaService,
      {
        read: () => Promise.resolve({ status: 'UNAVAILABLE', plan: null }),
      } as unknown as ConversationCurrentNutritionContextService,
      new ConversationPublicAnswerBoundaryService(),
      undefined,
      s.service,
    );
    await qa.execute({
      ...s.input,
      route: {
        kind: 'ANSWER_MESSAGE',
        operation: 'PROVIDE_GUIDANCE',
      } as ConversationExecutionRoute,
      humanContext: {
        currentMessage: 'Como posso ajustar minha rotina com segurança?',
        recentConversation: [
          { direction: 'USER', text: 'foreign unverified history' },
        ],
      } as unknown as CoachConversationHumanContext,
    });
    expect(ai.runTextJob).toHaveBeenCalledTimes(1);
    const payload = ai.runTextJob.mock.calls[0][1].input as string;
    expect(payload).not.toMatch(/foreign|future message/iu);
    expect(payload).toContain('WEIGHT_LOSS');
    expect(payload).toContain('HOME');
  });
});
