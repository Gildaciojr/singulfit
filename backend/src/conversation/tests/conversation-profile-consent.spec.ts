import {
  CoachProfileAcquisitionField as Field,
  CoachProfileFieldValue,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileAcquisitionAuthorizationService } from '../../context/profile-acquisition/profile-acquisition-authorization.service';
import { SubscriptionAccessService } from '../../subscriptions/subscription-access.service';
import { CoachProfileFieldRegistryService } from '../../context/profile-acquisition/coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from '../../context/profile-acquisition/profile-answer-recognizer.service';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from '../../context/profile-acquisition/coach-profile-mutation.service';
import { ProfileAcquisitionOperationalConfigService } from '../../context/profile-acquisition/profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalEligibilityService } from '../../context/profile-acquisition/profile-acquisition-internal-eligibility.service';
import { ProfileAcquisitionInternalRolloutService } from '../../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import { ConversationPlanReferenceService } from '../understanding/conversation-plan-reference.service';
import {
  ConversationProfileConsentService,
  FOOD_PREFERENCE_CONFIRMATION,
} from '../runtime/conversation-profile-consent.service';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import { CoachProfileAcquisitionProjectionService } from '../../context/profile-acquisition/coach-profile-acquisition-projection.service';
import { PersonalizedCoachContextService } from '../runtime/personalized-coach-context.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';
import { ProfileQuestionSpecificationService } from '../../context/profile-acquisition/profile-question.service';
import { CoachAdaptiveProfileCollectorService } from '../../context/coach-adaptive-profile-collector.service';
import { routingSnapshot, unknownDatum } from './conversation-routing.fixtures';

describe('ConversationProfileConsentService through the canonical writer', () => {
  const at = new Date('2026-10-02T15:00:00Z');
  function setup(
    content = 'quero que você lembre disso',
    antecedent = 'não gosto de peixe',
  ) {
    const records: CoachProfileFieldValue[] = [];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      coachProfileFieldValue: {
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id?: string; userId?: string };
            data: Partial<CoachProfileFieldValue>;
          }) => {
            const rows = records.filter((row) =>
              Object.entries(where).every(
                ([key, value]) =>
                  row[key as keyof CoachProfileFieldValue] === value,
              ),
            );
            rows.forEach((row) => Object.assign(row, data));
            return Promise.resolve({ count: rows.length });
          },
        ),
        findUnique: jest.fn(({ where }: { where: { operationKey: string } }) =>
          Promise.resolve(
            records.find((row) => row.operationKey === where.operationKey) ??
              null,
          ),
        ),
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { userId: string; field: Field; isActive: boolean };
          }) =>
            Promise.resolve(
              records.find(
                (row) =>
                  row.userId === where.userId &&
                  row.field === where.field &&
                  row.isActive,
              ) ?? null,
            ),
        ),
        create: jest.fn(
          ({
            data,
          }: {
            data: Prisma.CoachProfileFieldValueUncheckedCreateInput;
          }) => {
            const row = {
              ...data,
              id: `value-${records.length + 1}`,
              createdAt: at,
              updatedAt: at,
            } as unknown as CoachProfileFieldValue;
            records.push(row);
            return Promise.resolve(row);
          },
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<CoachProfileFieldValue>;
          }) => {
            const row = records.find((value) => value.id === where.id);
            if (row) Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      userPreferences: { upsert: jest.fn() },
    };
    let queue = Promise.resolve();
    const inbound = {
      id: 'consent',
      content,
      timestamp: at,
      replyToExternalMessageId: null,
      conversation: { id: 'conversation', userId: 'user' },
    };
    const previous = [
      {
        id: 'declaration',
        content: antecedent,
        timestamp: new Date(at.getTime() - 2000),
        conversation: inbound.conversation,
      },
    ];
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue(inbound),
        findMany: jest.fn().mockResolvedValue(previous),
      },
      $transaction: jest.fn(
        <T>(operation: (transaction: typeof tx) => Promise<T>) => {
          const result = queue.then(() => operation(tx));
          queue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      ),
      coachProfileFieldValue: {
        findMany: jest.fn(async () => records.filter((row) => row.isActive)),
        findFirst: tx.coachProfileFieldValue.findFirst,
      },
      fitnessCheckIn: { findMany: jest.fn().mockResolvedValue([]) },
      scheduledMessage: { findMany: jest.fn().mockResolvedValue([]) },
      conversationMemory: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn(async () => ({
          id: 'user',
          isActive: true,
          name: 'Ana',
          onboardingCompleted: true,
          fitnessProfile: null,
          nutritionProfile: null,
          preferences: null,
          coachProfile: null,
          goalClassification: null,
          behavioralProfile: null,
          behavioralSnapshots: [],
          fitnessCheckIns: [],
          progressSnapshots: [],
          longitudinalProfiles: [],
          foodPreferenceSnapshots: [],
          nutritionEvolution: [],
          goalProgression: [],
          coachAdaptations: [],
          dietPlans: [],
          workoutPlans: [],
          conversationMemories: [],
          coachProfileFieldValues: records.filter((row) => row.isActive),
        })),
      },
    };
    const registry = new CoachProfileFieldRegistryService();
    const recognizer = new ProfileAnswerRecognizerService(registry);
    const factory = new CoachProfileMutationCommandFactoryService(registry);
    const config = { get: jest.fn().mockReturnValue({ mode: 'INTERNAL' }) };
    const authorization = new ProfileAcquisitionAuthorizationService(
      prisma as unknown as PrismaService,
      config as unknown as ProfileAcquisitionOperationalConfigService,
      {
        evaluate: async () => ({ eligible: true }),
      } as unknown as ProfileAcquisitionInternalEligibilityService,
      new SubscriptionAccessService({
        subscription: {
          findFirst: async () => ({
            userId: 'user',
            status: 'ACTIVE',
            plan: { isActive: true },
            currentPeriodEnd: new Date('2030-01-01'),
            endedAt: null,
            cancelAtPeriodEnd: false,
          }),
        },
      } as unknown as PrismaService),
    );
    const writer = new CoachProfileMutationService(
      prisma as unknown as PrismaService,
      registry,
      config as unknown as ProfileAcquisitionOperationalConfigService,
      authorization,
    );
    const execute = jest.spyOn(writer, 'execute');
    const eligibility = {
      evaluate: jest.fn().mockResolvedValue({ internal: true, eligible: true }),
    };
    const rollout = {
      requestProductiveClarification: jest
        .fn()
        .mockResolvedValue({ questionCreated: true }),
    };
    const references = {
      recentAssistant: jest
        .fn()
        .mockResolvedValue(FOOD_PREFERENCE_CONFIRMATION),
    };
    const service = new ConversationProfileConsentService(
      prisma as unknown as PrismaService,
      registry,
      recognizer,
      factory,
      writer,
      config as unknown as ProfileAcquisitionOperationalConfigService,
      eligibility as unknown as ProfileAcquisitionInternalEligibilityService,
      rollout as unknown as ProfileAcquisitionInternalRolloutService,
      references as unknown as ConversationPlanReferenceService,
      authorization,
    );
    const input = {
      userId: 'user',
      conversationId: 'conversation',
      messageId: 'consent',
      referenceDate: at,
    };
    return {
      service,
      records,
      tx,
      prisma,
      inbound,
      previous,
      execute,
      writer,
      factory,
      registry,
      config,
      eligibility,
      rollout,
      references,
      input,
    };
  }
  it.each(new CoachProfileFieldRegistryService().all())(
    'keeps commercial USER field $field reachable through its typed canonical writer',
    async (definition) => {
      const s = setup();
      s.config.get.mockReturnValue({ mode: 'PRODUCTIVE' });
      const questions = new ProfileQuestionSpecificationService(s.registry);
      const spec = questions.forField(
        definition.field,
        'MISSING_CONTEXTUAL_FIELD',
      );
      const samples: Partial<Record<Field, string>> = {
        PHYSICAL_LIMITATIONS: 'nenhuma',
        FOOD_INTOLERANCES: 'nenhuma',
        ALLERGIES: 'nenhuma',
        MEDICAL_CONDITIONS: 'nenhuma',
        DECLARED_FOOD_PREFERENCES: 'arroz',
        DECLARED_FOOD_REJECTIONS: 'peixe',
        REPORTED_SUPPLEMENTATION: 'creatina',
        MEAL_TIMES: '08:00 e 12:00',
        TRAINING_TIME: '18:00',
        DAILY_TRAINING_WINDOWS: 'manhã',
        TARGET_DISTANCE: '5 km',
        CURRENT_RUNNING_DISTANCE: '2 km',
      };
      const answer = new ProfileAnswerRecognizerService(s.registry).recognize(
        spec,
        samples[definition.field] ??
          (definition.valueType === 'BOOLEAN'
            ? 'sim'
            : definition.valueType === 'INTEGER'
              ? String(definition.minimum)
              : definition.allowedOptions[0]),
      );
      expect(answer.disposition).toBe('RECOGNIZED');
      const command = s.factory.create({
        userId: 'user',
        answer,
        source: 'USER_REPORTED',
        referenceDate: at.toISOString(),
        sourceOperationKey: `registry:${definition.field}`,
        reason: 'PROFILE_UPDATE',
      });
      expect(command).not.toBeNull();
      await expect(s.writer.execute(command!)).resolves.toMatchObject({
        status: answer.confirmationRequired
          ? 'REQUIRES_CONFIRMATION'
          : 'CREATED',
      });
      expect(s.records[0]).toMatchObject({
        field: definition.field,
        valueType: definition.valueType,
        userId: 'user',
      });
      if (answer.confirmationRequired) {
        await expect(
          s.writer.resolvePendingConfirmation({
            userId: 'user',
            field: definition.field,
            action: 'CONFIRM',
            sourceOperationKey: `confirm:${definition.field}`,
            referenceDate: at.toISOString(),
          }),
        ).resolves.toMatchObject({ status: 'UPDATED' });
        expect(s.records.find((row) => row.isActive)).toMatchObject({
          status: 'CONFIRMED',
          confirmationState: 'CONFIRMED',
        });
      }
      const base = routingSnapshot();
      const snapshot = {
        ...base,
        restrictions: {
          ...base.restrictions,
          allergies: unknownDatum<readonly string[]>(),
          medicalConditions: unknownDatum<readonly string[]>(),
          physicalLimitations: unknownDatum<readonly string[]>(),
        },
      };
      const collector = new CoachAdaptiveProfileCollectorService();
      const decisions = ['GYM', 'RUNNING'].map((value) =>
        collector.decide({
          snapshot,
          intent: 'COMBINED_PLAN_REQUEST',
          memory: { interactions: [] },
          recentHistory: { currentLogicalTurn: 1, interactions: [] },
          conversationContext: {
            requiresWorkoutCalendar: true,
            requiresRunningDistanceProfile: true,
            modality: {
              value: value as 'GYM' | 'RUNNING',
              evidence: 'EXPLICIT',
            },
          },
        }),
      );
      const field = questions.toCollectorField(definition.field);
      expect(field).toBeDefined();
      expect(
        decisions.some((d) =>
          d.orderedCandidates.some((c) => c.field === field),
        ),
      ).toBe(true);
      expect(s.eligibility.evaluate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sou alérgico a amendoim', Field.ALLERGIES],
    ['tenho intolerância a lactose', Field.FOOD_INTOLERANCES],
    ['tenho uma limitação no joelho', Field.PHYSICAL_LIMITATIONS],
    ['tenho hipertensão', Field.MEDICAL_CONDITIONS],
  ])(
    'routes commercial sensitive consent through structured acquisition: %s',
    async (declaration, field) => {
      const s = setup('pode guardar isso', declaration);
      s.config.get.mockReturnValue({ mode: 'PRODUCTIVE' });
      expect(await s.service.process(s.input)).toContain(
        'confirmação específico',
      );
      expect(s.rollout.requestProductiveClarification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user',
          preselectedQuestion: { selectedProfileField: field, logicalTurn: 1 },
        }),
      );
      expect(s.records).toHaveLength(0);
      expect(s.eligibility.evaluate).not.toHaveBeenCalled();
    },
  );

  it('writes a commercial USER preference through the canonical PRODUCTIVE writer', async () => {
    const s = setup();
    s.config.get.mockReturnValue({ mode: 'PRODUCTIVE' });
    expect(await s.service.process(s.input)).toContain('Registrei');
    expect(s.records).toHaveLength(1);
  });
  it('recognizes não curto peixe but waits for permanent consent and preserves idempotence', async () => {
    const declaration = setup('não curto peixe');
    expect(await declaration.service.process(declaration.input)).toBe(
      FOOD_PREFERENCE_CONFIRMATION,
    );
    expect(declaration.records).toHaveLength(0);
    const confirmation = setup(
      'quero que você lembre disso',
      'não curto peixe',
    );
    expect(await confirmation.service.process(confirmation.input)).toContain(
      'Registrei',
    );
    await confirmation.service.process(confirmation.input);
    expect(confirmation.records).toHaveLength(1);
    expect(confirmation.records[0].textListValue).toEqual(['peixe']);
  });

  it('does not permanently write the initial declaration', async () => {
    const s = setup('não gosto de peixe');
    expect(await s.service.process(s.input)).toBe(FOOD_PREFERENCE_CONFIRMATION);
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.records).toHaveLength(0);
  });
  it.each([
    'quero que você lembre disso',
    'quero que lembre disso',
    'pode guardar isso',
    'salva isso no meu perfil',
    'sim, quero que lembre',
    'considere isso daqui pra frente',
  ])('persists rejection once using explicit consent: %s', async (content) => {
    const s = setup(content);
    expect(await s.service.process(s.input)).toContain('Registrei');
    expect(s.execute).toHaveBeenCalledTimes(1);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({
      userId: 'user',
      field: Field.DECLARED_FOOD_REJECTIONS,
      textListValue: ['peixe'],
      status: 'CONFIRMED',
      source: 'USER_CONFIRMED',
      confirmationState: 'CONFIRMED',
      isActive: true,
    });
  });
  it('reuses the same canonical operation, list and audit on retry and concurrent reprocessing', async () => {
    const s = setup();
    await Promise.all([s.service.process(s.input), s.service.process(s.input)]);
    await s.service.process(s.input);
    expect(s.records).toHaveLength(1);
    expect(s.tx.auditLog.create).toHaveBeenCalledTimes(1);
    const keys = s.execute.mock.calls.map(([command]) => command.operationKey);
    expect(new Set(keys).size).toBe(1);
  });
  it('persists the supported positive food preference', async () => {
    const s = setup('pode guardar isso', 'gosto muito de frango');
    await s.service.process(s.input);
    expect(s.records[0]).toMatchObject({
      field: Field.DECLARED_FOOD_PREFERENCES,
      textListValue: ['frango'],
      status: 'CONFIRMED',
    });
  });
  it('does not write a temporary refusal of persistence', async () => {
    const s = setup('não, era só hoje');
    expect(await s.service.process(s.input)).toBeNull();
    expect(s.execute).not.toHaveBeenCalled();
  });
  it.each([
    'meu irmão não gosta de peixe',
    'meu amigo não gosta de peixe',
    'minha esposa é alérgica a amendoim',
    'e se eu não gostasse de peixe?',
    'acho que talvez eu não goste',
    'não sei se gosto',
    'não gosto de peixe hoje',
  ])(
    'never saves a third-party, hypothetical, uncertain or temporary antecedent: %s',
    async (previous) => {
      const s = setup('lembre disso', previous);
      expect(await s.service.process(s.input)).toContain('Qual preferência');
      expect(s.execute).not.toHaveBeenCalled();
    },
  );
  it('clarifies absent, unrelated or multiple candidate antecedents', async () => {
    const s = setup('lembre disso');
    s.prisma.message.findMany.mockResolvedValue([]);
    expect(await s.service.process(s.input)).toContain('Qual preferência');
    s.prisma.message.findMany.mockResolvedValue([
      { ...s.previous[0], content: 'o que é hipertrofia?' },
    ]);
    expect(await s.service.process(s.input)).toContain('Qual preferência');
    s.prisma.message.findMany.mockResolvedValue([
      s.previous[0],
      {
        ...s.previous[0],
        id: 'older',
        content: 'gosto de frango',
        timestamp: new Date(at.getTime() - 3000),
      },
    ]);
    expect(await s.service.process(s.input)).toContain('Qual preferência');
    expect(s.execute).not.toHaveBeenCalled();
  });
  it('rejects an intervening assistant response that breaks the reference', async () => {
    const s = setup();
    s.references.recentAssistant.mockResolvedValue(
      'Vamos falar de treino agora.',
    );
    expect(await s.service.process(s.input)).toContain('Qual preferência');
    expect(s.execute).not.toHaveBeenCalled();
  });
  it.each([
    'INBOUND_USER',
    'INBOUND_CONVERSATION',
    'PREVIOUS_USER',
    'PREVIOUS_CONVERSATION',
    'FUTURE',
  ])(
    'blocks foreign or future reference records returned by mocks: %s',
    async (variant) => {
      const s = setup();
      if (variant.startsWith('INBOUND'))
        s.prisma.message.findFirst.mockResolvedValue({
          ...s.inbound,
          conversation: {
            id: variant === 'INBOUND_CONVERSATION' ? 'other' : 'conversation',
            userId: variant === 'INBOUND_USER' ? 'other' : 'user',
          },
        });
      else
        s.prisma.message.findMany.mockResolvedValue([
          {
            ...s.previous[0],
            timestamp:
              variant === 'FUTURE'
                ? new Date(at.getTime() + 1)
                : s.previous[0].timestamp,
            conversation: {
              id:
                variant === 'PREVIOUS_CONVERSATION' ? 'other' : 'conversation',
              userId: variant === 'PREVIOUS_USER' ? 'other' : 'user',
            },
          },
        ]);
      expect(await s.service.process(s.input)).toContain('segurança');
      expect(s.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['sou alérgico a amendoim', Field.ALLERGIES],
    ['tenho intolerância a lactose', Field.FOOD_INTOLERANCES],
    ['tenho uma condição médica', Field.MEDICAL_CONDITIONS],
    ['tenho limitação física', Field.PHYSICAL_LIMITATIONS],
    ['treino em casa', Field.TRAINING_ENVIRONMENT],
  ] as const)(
    'routes %s to its own canonical acquisition instead of casual food preference writes',
    async (previous, field) => {
      const s = setup('lembre disso', previous);
      expect(await s.service.process(s.input)).toContain(
        'confirmação específico',
      );
      expect(s.rollout.requestProductiveClarification).toHaveBeenCalledWith(
        expect.objectContaining({
          preselectedQuestion: { selectedProfileField: field, logicalTurn: 1 },
        }),
      );
      expect(s.execute).not.toHaveBeenCalled();
    },
  );
  it('does not hijack a contextual mutation, but accepts a subsequent explicit permanent declaration', async () => {
    const s = setup('troque o peixe do jantar, não gosto de peixe');
    expect(s.service.accepts(s.inbound.content)).toBe(false);
    expect(await s.service.process(s.input)).toBeNull();
    expect(s.execute).not.toHaveBeenCalled();
    s.prisma.message.findFirst.mockResolvedValue({
      ...s.inbound,
      content: 'e quero que você lembre que não gosto de peixe',
    });
    expect(await s.service.process(s.input)).toContain('Registrei');
    expect(s.execute).toHaveBeenCalledTimes(1);
  });
  it.each(['OFF', 'SHADOW', 'INELIGIBLE'])(
    'preserves the acquisition authorization gate: %s',
    async (mode) => {
      const s = setup();
      if (mode === 'INELIGIBLE')
        s.eligibility.evaluate.mockResolvedValue({
          internal: false,
          eligible: false,
        });
      else s.config.get.mockReturnValue({ mode });
      expect(await s.service.process(s.input)).toContain('Não posso registrar');
      expect(s.execute).not.toHaveBeenCalled();
    },
  );
  it('routes explicit inline allergy consent to structured acquisition', async () => {
    const s = setup('lembre que sou alérgico a amendoim');
    await s.service.process(s.input);
    expect(s.rollout.requestProductiveClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        preselectedQuestion: expect.objectContaining({
          selectedProfileField: Field.ALLERGIES,
        }),
      }),
    );
    expect(s.execute).not.toHaveBeenCalled();
  });
  it('does not keep a contradictory positive preference and rejection under the shared writer lock', async () => {
    const s = setup('e quero que você lembre que gosto de peixe');
    await s.service.process(s.input);
    s.prisma.message.findFirst.mockResolvedValue({
      ...s.inbound,
      id: 'second',
      content: 'quero que você lembre disso',
    });
    expect(
      await s.service.process({ ...s.input, messageId: 'second' }),
    ).toContain('conflita');
    expect(s.records).toHaveLength(1);
    expect(s.records[0].field).toBe(Field.DECLARED_FOOD_PREFERENCES);
  });
  it('makes the persisted confirmed rejection available to QA in a future conversation using real snapshot/projection', async () => {
    const s = setup();
    await s.service.process(s.input);
    const future = new Date(at.getTime() + 86400000);
    s.prisma.message.findFirst.mockResolvedValue({
      ...s.inbound,
      id: 'qa',
      timestamp: future,
      content: 'você lembra que eu não gosto de peixe?',
      conversation: { id: 'future-conversation', userId: 'user' },
    });
    s.prisma.message.findMany.mockResolvedValue([]);
    const nutrition = { getCurrent: jest.fn().mockResolvedValue(null) };
    const snapshots = new CoachProfileSnapshotBuilder(
      s.prisma as unknown as PrismaService,
      new CoachProfileAcquisitionProjectionService(),
      nutrition as unknown as CurrentNutritionPlanReaderService,
    );
    const personal = new PersonalizedCoachContextService(
      s.prisma as unknown as PrismaService,
      snapshots,
      nutrition as unknown as CurrentNutritionPlanReaderService,
      {
        read: jest.fn().mockResolvedValue({ status: 'NO_PLAN', plan: null }),
      } as unknown as CurrentWorkoutPlanReaderService,
      {
        summarize: jest.fn().mockResolvedValue({
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          mealCount: 0,
          periodStart: at,
          periodEnd: future,
        }),
      } as unknown as NutritionConsumptionSummaryService,
    );
    const context = await personal.build({
      userId: 'user',
      conversationId: 'future-conversation',
      messageId: 'qa',
      referenceDate: future,
    });
    expect(context).toMatchObject({
      nutrition: {
        declaredFoodRejections: { status: 'KNOWN', value: ['peixe'] },
      },
      profileFields: [
        {
          field: Field.DECLARED_FOOD_REJECTIONS,
          status: 'CONFIRMED',
          value: ['peixe'],
        },
      ],
      memories: [],
      recentConversation: [],
    });
    expect(
      personal.answer(
        context,
        [{ kind: 'PROFILE_FIELD', field: Field.DECLARED_FOOD_REJECTIONS }],
        'você lembra que eu não gosto de peixe?',
      ),
    ).toBe('No seu perfil, tenho confirmado: peixe.');
  });
});
