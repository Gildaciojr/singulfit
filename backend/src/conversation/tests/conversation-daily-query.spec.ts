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
    'qual minha meta de calorias?',
    'quantas calorias devo consumir?',
  ])(
    'leaves the existing mutation and target routes intact for %s',
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
