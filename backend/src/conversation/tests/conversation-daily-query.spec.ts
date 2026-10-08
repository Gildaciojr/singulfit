import { ConversationDailyQueryService } from '../runtime/conversation-daily-query.service';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ConversationDailyQueryService', () => {
  const meal = (
    period: string,
    name: string,
    suggestedTime: string | null,
  ) => ({
    period,
    name,
    suggestedTime,
    items: [
      {
        quantity: '120 g',
        foodName: name === 'Almoço domingo' ? 'Frango' : 'Peixe',
      },
    ],
  });
  function subject() {
    const prisma = {
      userPreferences: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
      message: { findFirst: jest.fn().mockResolvedValue(null) },
      scheduledMessage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const consumption = {
      summarize: jest.fn().mockResolvedValue({
        calories: 500,
        protein: 35,
        carbs: 50,
        fat: 10,
        mealCount: 2,
      }),
    };
    const current = {
      userId: 'user',
      implementation: 'V2',
      document: {
        artifactType: 'WEEKLY_PLAN',
        days: [
          {
            label: 'Domingo',
            dayNumber: 1,
            meals: [
              meal('LUNCH', 'Almoço domingo', '12:00'),
              meal('DINNER', 'Jantar domingo', '19:00'),
            ],
          },
          {
            label: 'Segunda-feira',
            dayNumber: 2,
            meals: [
              meal('LUNCH', 'Almoço segunda', '13:00'),
              meal('DINNER', 'Jantar segunda', '20:00'),
            ],
          },
        ],
      },
    };
    const nutrition = { getCurrent: jest.fn().mockResolvedValue(current) };
    const service = new ConversationDailyQueryService(
      prisma as unknown as PrismaService,
      consumption as unknown as NutritionConsumptionSummaryService,
      nutrition as unknown as CurrentNutritionPlanReaderService,
    );
    const input = {
      userId: 'user',
      conversationId: 'conversation',
      messageId: 'message',
      referenceDate: new Date('2026-08-24T14:00:00Z'),
    };
    return { service, prisma, consumption, nutrition, current, input };
  }

  function targets(
    implementation: 'V2' | 'LEGACY',
    days = [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ],
  ) {
    return implementation === 'LEGACY'
      ? {
          userId: 'user',
          implementation,
          dailyCaloriesTarget: 2200,
          proteinTarget: 130,
          carbsTarget: 270,
          fatTarget: 65,
        }
      : {
          userId: 'user',
          implementation,
          document: {
            artifactType: 'WEEKLY_PLAN',
            days: days.map((label) => ({ label })),
            strategy: {
              dayCount: days.length,
              energyTargetKcal: { status: 'ESTIMATED', value: 2200 },
              macroTargets: {
                status: 'ESTIMATED',
                value: {
                  proteinGrams: 130,
                  carbohydrateGrams: 270,
                  fatGrams: 65,
                },
              },
            },
          },
        };
  }
  it.each(['V2', 'LEGACY'] as const)(
    'reads daily targets from the owned %s plan, not previous workout or intake',
    async (implementation) => {
      const s = subject();
      s.nutrition.getCurrent.mockResolvedValue(targets(implementation));
      for (const [text, expected] of [
        ['Qual minha meta calórica diária?', '2.200 kcal'],
        ['Quanto de proteína consta como meta diária?', '130 g'],
        ['Qual a meta de carboidratos?', '270 g'],
        ['Qual minha meta de gorduras?', '65 g'],
        ['Quais minhas metas de macronutrientes?', '130 g'],
        ['Quais minhas metas de calorias e proteína?', '2.200 kcal'],
      ]) {
        expect(s.service.accepts(text)).toBe(true);
        expect(await s.service.answer({ ...s.input, text })).toContain(
          expected,
        );
      }
      expect(s.consumption.summarize).not.toHaveBeenCalled();
      expect(s.prisma.message.findFirst).not.toHaveBeenCalled();
    },
  );
  it('keeps clinical safety ahead of daily targets', async () => {
    const s = subject();
    expect(
      await s.service.answer({
        ...s.input,
        text: 'Qual minha meta de calorias? Desmaiei e tenho dor no peito.',
      }),
    ).toBeNull();
    expect(s.nutrition.getCurrent).not.toHaveBeenCalled();
    expect(s.consumption.summarize).not.toHaveBeenCalled();
  });
  it('uses all seven explicit weekdays for the weekly target and compares only analyzed intake', async () => {
    const s = subject();
    s.nutrition.getCurrent.mockResolvedValue(targets('V2'));
    expect(
      await s.service.answer({
        ...s.input,
        text: 'Qual minha meta de calorias para a semana?',
      }),
    ).toContain('15.400 kcal');
    const answer = await s.service.answer({
      ...s.input,
      text: 'Quanto consumi em relação à meta de calorias nesta semana?',
    });
    expect(answer).toContain('500 kcal');
    expect(answer).toContain('15.400 kcal');
    expect(answer).toContain('não comprova seu consumo total');
    expect(s.consumption.summarize).toHaveBeenCalledWith({
      userId: 'user',
      period: 'THIS_WEEK',
      referenceDate: s.input.referenceDate,
      timezone: 'America/Sao_Paulo',
    });
  });
  it.each([
    targets('LEGACY'),
    targets('V2', ['Dia 1', 'Dia 2']),
    targets('V2', [
      'Segunda-feira',
      'Segunda-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]),
  ])(
    'does not invent a seven-day target without an unambiguous weekly calendar',
    async (plan) => {
      const s = subject();
      s.nutrition.getCurrent.mockResolvedValue(plan);
      const answer = await s.service.answer({
        ...s.input,
        text: 'Qual minha meta de calorias para a semana?',
      });
      expect(answer).toContain('2.200 kcal');
      expect(answer).not.toContain('15.400');
      expect(s.consumption.summarize).not.toHaveBeenCalled();
    },
  );
  it("does not disclose another user's target or fabricate an absent target", async () => {
    const s = subject();
    s.nutrition.getCurrent.mockResolvedValue({
      ...targets('LEGACY'),
      userId: 'someone-else',
    });
    expect(
      await s.service.answer({
        ...s.input,
        text: 'Qual minha meta de proteína?',
      }),
    ).not.toContain('130');
    s.nutrition.getCurrent.mockResolvedValue({
      ...targets('LEGACY'),
      proteinTarget: null,
    });
    expect(
      await s.service.answer({
        ...s.input,
        text: 'Qual minha meta de proteína?',
      }),
    ).toContain('não está disponível');
    s.nutrition.getCurrent.mockResolvedValue(targets('V2'));
    s.consumption.summarize.mockResolvedValue({
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      mealCount: 0,
    });
    expect(
      await s.service.answer({
        ...s.input,
        text: 'Quanto consumi em relação à meta de calorias hoje?',
      }),
    ).toContain('ausente ou incompleto');
  });

  it('selects the named afternoon snack even when a morning snack also exists', async () => {
    const s = subject();
    s.current.document.days[0].meals.push(
      meal('MORNING_SNACK', 'Lanche da manhã', '10:00'),
      meal('AFTERNOON_SNACK', 'Lanche da tarde', '16:00'),
    );
    const content = await s.service.answer({
      userId: 'user',
      conversationId: 'conversation',
      messageId: 'message',
      text: 'Qual meu lanche da tarde?',
      referenceDate: new Date('2026-06-07T18:00:00Z'),
    });
    expect(content).toContain('Lanche da tarde');
    expect(content).not.toContain('Lanche da manhã');
  });
  it.each([
    'Qual minha próxima refeição?',
    'Não mandei sobre treino. Perguntei QUAL A MINHA PRÓXIMA REFEIÇÃO DE HOJE',
    'não perguntei de treino, perguntei minha próxima refeição',
    'O que posso comer no jantar?',
  ])(
    'routes explicit meal read %s to the current nutrition plan',
    async (text) => {
      const s = subject();
      expect(s.service.accepts(text)).toBe(true);
      expect(await s.service.answer({ ...s.input, text })).toMatch(
        /Almoço segunda|Jantar segunda/u,
      );
      expect(s.nutrition.getCurrent).toHaveBeenCalledWith('user');
      expect(s.consumption.summarize).not.toHaveBeenCalled();
    },
  );
  it.each([
    'quanto gastei hoje?',
    'quanto gastei essa semana?',
    'quantas calorias queimei hoje?',
    'quantas calorias queimei essa semana?',
  ])(
    'fails closed for %s without querying a plan or consumption or AI',
    async (text) => {
      const s = subject();
      const answer = await s.service.answer({ ...s.input, text });
      expect(answer).toContain('não tenho uma fonte confiável');
      expect(answer).not.toMatch(/500|meta|kcal|estimad/iu);
      expect(s.nutrition.getCurrent).not.toHaveBeenCalled();
      expect(s.consumption.summarize).not.toHaveBeenCalled();
      expect(s.prisma.userPreferences.findUnique).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['quantas calorias consumi hoje?', 'TODAY', '500 kcal'],
    ['quanto de proteína consumi hoje?', 'TODAY', '35 g'],
    ['quanto consumi essa semana?', 'THIS_WEEK', '500 kcal'],
  ] as const)(
    'reads recorded consumption for %s',
    async (text, period, value) => {
      const s = subject();
      expect(await s.service.answer({ ...s.input, text })).toContain(value);
      expect(s.consumption.summarize).toHaveBeenCalledWith({
        userId: 'user',
        period,
        timezone: 'America/Sao_Paulo',
        referenceDate: s.input.referenceDate,
      });
      expect(await s.service.answer({ ...s.input, text })).toContain(
        'registrou e foram analisadas',
      );
      expect(s.nutrition.getCurrent).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['qual meu almoço de hoje?', 'Almoço segunda'],
    ['qual meu jantar de hoje?', 'Jantar segunda'],
    ['qual minha próxima refeição?', 'Almoço segunda'],
    ['o que eu como agora?', 'Almoço segunda'],
    ['qual refeição vem depois?', 'Almoço segunda'],
  ])(
    'selects the explicit local day and meal for %s',
    async (text, expected) => {
      const s = subject();
      const answer = await s.service.answer({ ...s.input, text });
      expect(answer).toContain(expected);
      expect(answer).not.toContain('domingo');
    },
  );
  it('selects dinner after lunch and does not invent the following day after dinner', async () => {
    const s = subject();
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
        referenceDate: new Date('2026-08-24T18:00:00Z'),
      }),
    ).toContain('Jantar segunda');
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
        referenceDate: new Date('2026-08-25T02:30:00Z'),
      }),
    ).toContain('já passaram');
  });
  it('does not invent missing times or a weekday from dayNumber', async () => {
    const s = subject();
    s.current.document.days[1].meals[0].suggestedTime = null;
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
      }),
    ).toContain('horários de hoje não estão completos');
    s.current.document.days[1].label = 'Dia 2';
    expect(
      await s.service.answer({ ...s.input, text: 'qual meu almoço de hoje?' }),
    ).toContain('não identifica com segurança');
  });
  it('uses tomorrow only when its weekday is explicit in the plan', async () => {
    const s = subject();
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
        referenceDate: new Date('2026-08-24T02:30:00Z'),
      }),
    ).toContain('amanhã: *Almoço segunda*');
    s.current.document.days[1].label = 'Dia 2';
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
        referenceDate: new Date('2026-08-24T02:30:00Z'),
      }),
    ).toContain('já passaram');
  });
  it('does not mistake reminder confirmations for consumption queries', async () => {
    const s = subject();
    for (const text of ['já comi', 'comi', 'não comi', 'comi outra coisa'])
      expect(await s.service.answer({ ...s.input, text })).toBeNull();
    expect(s.consumption.summarize).not.toHaveBeenCalled();
  });
  function lunchReminder() {
    return {
      userId: 'user',
      conversationId: 'conversation',
      conversation: { id: 'conversation', userId: 'user' },
      status: 'SENT',
      scheduledFor: new Date('2026-08-24T13:30:00Z'),
      respondedAt: new Date('2026-08-24T13:45:00Z'),
      responseOutcome: 'PARTIAL',
      context: { source: 'COACH_PROACTIVE_V1', intent: 'LUNCH_CHECK' },
    };
  }
  it.each(['PARTIAL', 'COMPLETED', 'SKIPPED'])(
    'does not offer the same resolved lunch as next after %s, even before its planned time',
    async (responseOutcome) => {
      const s = subject();
      s.prisma.scheduledMessage.findMany.mockResolvedValue([
        { ...lunchReminder(), responseOutcome },
      ]);
      const answer = await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
      });
      expect(answer).toContain('Jantar segunda');
      expect(answer).not.toContain('Almoço segunda');
      expect(s.prisma.scheduledMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user' }),
        }),
      );
      expect(s.consumption.summarize).not.toHaveBeenCalled();
    },
  );
  it.each([
    'DEFERRED',
    'UNKNOWN',
    'FOREIGN',
    'FUTURE',
    'YESTERDAY',
    'OTHER_SOURCE',
    'GENERAL_PLAN',
    'UNSENT',
  ])(
    'does not silently remove lunch from the plan using %s evidence',
    async (variant) => {
      const s = subject();
      const row = lunchReminder();
      if (variant === 'DEFERRED' || variant === 'UNKNOWN')
        row.responseOutcome = variant;
      if (variant === 'FOREIGN') row.conversation.userId = 'other';
      if (variant === 'FUTURE')
        row.respondedAt = new Date('2026-08-24T16:00:00Z');
      if (variant === 'YESTERDAY')
        row.scheduledFor = new Date('2026-08-23T13:30:00Z');
      if (variant === 'OTHER_SOURCE') row.context.source = 'UNVERIFIED';
      if (variant === 'GENERAL_PLAN') row.context.intent = 'MEAL_PLAN_CHECK';
      if (variant === 'UNSENT') row.status = 'PENDING';
      s.prisma.scheduledMessage.findMany.mockResolvedValue([row]);
      expect(
        await s.service.answer({
          ...s.input,
          text: 'qual minha próxima refeição?',
        }),
      ).toContain('Almoço segunda');
    },
  );
  it('clarifies a resolved period with multiple meals rather than removing both', async () => {
    const s = subject();
    s.current.document.days[1].meals.push(
      meal('LUNCH', 'Segundo almoço', '14:00'),
    );
    s.prisma.scheduledMessage.findMany.mockResolvedValue([lunchReminder()]);
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual minha próxima refeição?',
      }),
    ).toContain('Qual delas');
  });
  it('does not turn a partial meal reminder into observed consumption', async () => {
    const s = subject();
    s.prisma.scheduledMessage.findMany.mockResolvedValue([lunchReminder()]);
    s.consumption.summarize.mockResolvedValue({
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      mealCount: 0,
    });
    const answer = await s.service.answer({
      ...s.input,
      text: 'quanto consumi hoje?',
    });
    expect(answer).toContain('Sem essa análise');
    expect(answer).not.toMatch(/\d+\s*(kcal|g)|500|120/iu);
    expect(s.nutrition.getCurrent).not.toHaveBeenCalled();
    expect(s.prisma.scheduledMessage.findMany).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-08-24T02:30:00Z', 'Almoço domingo'],
    ['2026-08-24T03:30:00Z', 'Almoço segunda'],
  ])('uses the local weekday at %s', async (referenceDate, expected) => {
    const s = subject();
    expect(
      await s.service.answer({
        ...s.input,
        text: 'qual meu almoço de hoje?',
        referenceDate: new Date(referenceDate),
      }),
    ).toContain(expected);
  });
  it('reuses only the metric of the immediately preceding consumption request', async () => {
    const s = subject();
    s.prisma.message.findFirst.mockResolvedValue({
      content: 'quanto de proteína consumi hoje?',
      timestamp: new Date(s.input.referenceDate.getTime() - 1000),
      conversation: { id: 'conversation', userId: 'user' },
    });
    expect(
      await s.service.answer({ ...s.input, text: 'e essa semana?' }),
    ).toContain('35 g');
    expect(s.consumption.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'THIS_WEEK' }),
    );
    expect(s.prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: 'conversation',
          conversation: { userId: 'user' },
          timestamp: { lt: s.input.referenceDate },
        }),
      }),
    );
  });
  it('asks for context without an antecedent or after an unrelated request', async () => {
    const s = subject();
    expect(
      await s.service.answer({ ...s.input, text: 'e essa semana?' }),
    ).toContain('qual informação');
    s.prisma.message.findFirst.mockResolvedValue({
      content: 'qual meu treino de hoje?',
      timestamp: new Date(s.input.referenceDate.getTime() - 1000),
      conversation: { id: 'conversation', userId: 'user' },
    });
    expect(
      await s.service.answer({ ...s.input, text: 'e essa semana?' }),
    ).toContain('qual informação');
    expect(s.consumption.summarize).not.toHaveBeenCalled();
  });
  it.each([
    'troque meu almoço de hoje',
    'troque o frango',
    'troque o primeiro exercício',
    'quantas calorias devo consumir?',
  ])(
    'leaves persistent mutations and requests to prescribe a new target intact for %s',
    async (text) => {
      const s = subject();
      expect(await s.service.answer({ ...s.input, text })).toBeNull();
      expect(s.consumption.summarize).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['quanto consumi hoje?', 'TODAY'],
    ['quanto consumi essa semana?', 'THIS_WEEK'],
  ] as const)(
    'keeps the antecedent period of %s for e proteína',
    async (content, period) => {
      const s = subject();
      s.prisma.message.findFirst.mockResolvedValue({
        content,
        timestamp: new Date(s.input.referenceDate.getTime() - 1000),
        conversation: { id: 'conversation', userId: 'user' },
      });
      expect(
        await s.service.answer({ ...s.input, text: 'e proteína?' }),
      ).toContain('proteína: 35 g');
      expect(s.consumption.summarize).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user', period }),
      );
    },
  );
  it.each(['ABSENT', 'FOREIGN', 'FUTURE', 'UNRELATED'])(
    'clarifies a metric follow-up with %s antecedent',
    async (variant) => {
      const s = subject();
      s.prisma.message.findFirst.mockResolvedValue(
        variant === 'ABSENT'
          ? null
          : {
              content:
                variant === 'UNRELATED'
                  ? 'qual meu treino?'
                  : 'quanto consumi hoje?',
              timestamp: new Date(
                s.input.referenceDate.getTime() +
                  (variant === 'FUTURE' ? 1 : -1000),
              ),
              conversation: {
                id: 'conversation',
                userId: variant === 'FOREIGN' ? 'other' : 'user',
              },
            },
      );
      expect(
        await s.service.answer({ ...s.input, text: 'e proteína?' }),
      ).toContain('hoje ou nesta semana');
      expect(s.consumption.summarize).not.toHaveBeenCalled();
    },
  );
  it('rejects a foreign current meal document returned by a mock', async () => {
    const s = subject();
    s.nutrition.getCurrent.mockResolvedValue({ ...s.current, userId: 'other' });
    const answer = await s.service.answer({
      ...s.input,
      text: 'qual meu almoço de hoje?',
    });
    expect(answer).toContain('segurança');
    expect(answer).not.toContain('Frango');
  });
});
