import { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import {
  effectiveNutritionRequest,
  readOnlyFollowUp,
  nutritionRequestText,
  type CurrentReadOnlyReferent,
} from '../runtime/conversation-read-only-referent.policy';
import { nutritionRequest } from '../understanding/nutrition-request.policy';

describe('delivered read-only referent', () => {
  const input = {
    userId: 'user',
    conversationId: 'conversation',
    messageId: 'current',
  };
  const before = new Date('2026-10-05T20:10:00Z');
  const sourceTime = new Date('2026-10-05T20:00:00Z');
  const deliveredTime = new Date('2026-10-05T20:01:00Z');
  const answer = 'Uma opção de jantar é arroz com frango e legumes.';
  const referent: CurrentReadOnlyReferent = {
    source: 'DELIVERED_QA',
    sourceMessageId: 'dinner',
    domain: 'NUTRITION',
    nutrition: nutritionRequest('Me da uma ideia de jantar'),
    previousAnswer: answer,
    followUpQuestion: null,
    deliveredAt: deliveredTime.toISOString(),
  };
  function subject() {
    const prisma = {
      message: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            timestamp: before,
            replyToExternalMessageId: null,
          })
          .mockResolvedValue({
            id: 'dinner',
            content: 'Me da uma ideia de jantar',
            timestamp: sourceTime,
          }),
      },
      scheduledMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sent',
          userId: 'user',
          conversationId: 'conversation',
          content: answer,
          context: {
            source: 'WHATSAPP_COACH_COMMAND',
            sourceMessageId: 'dinner',
          },
          sentAt: deliveredTime,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aIJob: {
        findFirst: jest.fn().mockResolvedValue({
          result: {
            disposition: 'ANSWER',
            domain: 'NUTRITION',
            answer,
            followUpQuestion: null,
            grounding: 'MIXED',
            confidence: 'HIGH',
          },
        }),
      },
      pendingConversationAction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    return {
      prisma,
      service: new ConversationQAFollowUpContextService(
        prisma as never,
        new ConversationPublicAnswerBoundaryService(),
      ),
    };
  }
  it('recovers the latest delivered dinner without a follow-up question', async () => {
    const s = subject();
    expect(await s.service.findReferent(input)).toEqual(referent);
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(1);
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({
          userId: 'user',
          conversationId: 'conversation',
          status: 'SENT',
        }),
      }),
    );
    expect(s.prisma.aIJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageId: 'dinner',
          status: 'COMPLETED',
          completedAt: { lte: deliveredTime },
        }),
      }),
    );
  });
  it.each([
    ['Outra opção', 'ALTERNATIVE_REQUEST', []],
    ['Eu quero outra alternativa', 'ALTERNATIVE_REQUEST', []],
    ['Me dá outra', 'ALTERNATIVE_REQUEST', []],
    ['mais uma', 'ALTERNATIVE_REQUEST', []],
    ['sem lactose', 'CONSTRAINT_REFINEMENT', ['LACTOSE']],
    ['mais barato', 'CONSTRAINT_REFINEMENT', ['LOW_COST']],
    ['mais leve', 'CONSTRAINT_REFINEMENT', ['LIGHT']],
    ['rápido e proteico', 'CONSTRAINT_REFINEMENT', ['QUICK', 'HIGH_PROTEIN']],
    ['sim, eu quero', 'FOLLOW_UP_ACCEPTANCE', []],
    ['quero sim', 'FOLLOW_UP_ACCEPTANCE', []],
    ['sim', 'FOLLOW_UP_ACCEPTANCE', []],
  ])(
    'inherits the dinner for %s only with a valid compatible referent',
    (text, kind, constraints) => {
      const follow = readOnlyFollowUp(text);
      expect(follow).toMatchObject({ kind, constraints });
      if (!follow) throw new Error('Expected follow-up');
      const request = effectiveNutritionRequest(follow, {
        ...referent,
        followUpQuestion: 'Quer mais duas opções?',
      });
      expect(request).toMatchObject({ meal: 'jantar', constraints });
      expect(nutritionRequest(nutritionRequestText(request!))).toMatchObject({
        meal: 'jantar',
        constraints,
      });
      expect(
        effectiveNutritionRequest(follow, {
          ...referent,
          domain: 'WORKOUT',
          nutrition: null,
        }),
      ).toBeNull();
    },
  );
  it('does not invent an offer when the latest dinner has none', () => {
    expect(
      effectiveNutritionRequest(readOnlyFollowUp('sim')!, referent),
    ).toBeNull();
  });
  it('preserves inherited restrictions when a new constraint refines the dinner', () => {
    const follow = readOnlyFollowUp('rápido e proteico')!;
    expect(
      effectiveNutritionRequest(follow, {
        ...referent,
        nutrition: {
          intent: 'CONSTRAINED_RECOMMENDATION',
          meal: 'jantar',
          constraints: ['LACTOSE'],
        },
      }),
    ).toEqual({
      intent: 'CONSTRAINED_RECOMMENDATION',
      meal: 'jantar',
      constraints: ['LACTOSE', 'QUICK', 'HIGH_PROTEIN'],
    });
  });
  it('makes the newer successful Workout QA the referent without resurrecting dinner', async () => {
    const s = subject();
    const workoutAnswer = 'Seu treino de amanhã é caminhada leve.';
    s.prisma.message.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        timestamp: before,
        replyToExternalMessageId: null,
      })
      .mockResolvedValue({
        id: 'workout',
        content: 'Qual meu treino de amanhã?',
        timestamp: sourceTime,
      });
    s.prisma.scheduledMessage.findFirst.mockResolvedValue({
      id: 'workout-sent',
      userId: 'user',
      conversationId: 'conversation',
      content: workoutAnswer,
      context: { source: 'WHATSAPP_COACH_COMMAND', sourceMessageId: 'workout' },
      sentAt: deliveredTime,
    });
    s.prisma.aIJob.findFirst.mockResolvedValue({
      result: {
        disposition: 'ANSWER',
        domain: 'WORKOUT',
        answer: workoutAnswer,
        followUpQuestion: null,
        grounding: 'CURRENT_PLAN',
        confidence: 'HIGH',
      },
    });
    const latest = await s.service.findReferent(input);
    expect(latest).toMatchObject({
      domain: 'WORKOUT',
      nutrition: null,
      sourceMessageId: 'workout',
    });
    expect(
      effectiveNutritionRequest(readOnlyFollowUp('Outra opção')!, latest!),
    ).toBeNull();
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(1);
  });
  it.each([
    'Troca esse',
    'Eu quero um carro',
    'Mude para outra',
    'Altere para mais uma',
    'Atualize meu plano',
    'Quero trocar meu jantar permanentemente',
    'Me sugira um lanche leve',
    'Isso',
  ])('does not steal independent or mutation requests: %s', (text) => {
    expect(readOnlyFollowUp(text)).toBeNull();
  });
  it.each(['mutation', 'profile'])(
    'preserves active %s lifecycle',
    async (kind) => {
      const s = subject();
      (kind === 'mutation'
        ? s.prisma.pendingConversationAction
        : s.prisma.coachProfileAcquisitionCycle
      ).findFirst.mockResolvedValue({ id: 'active' });
      expect(await s.service.findReferent(input)).toBeNull();
      expect(s.prisma.scheduledMessage.findFirst).not.toHaveBeenCalled();
    },
  );
  it('never scans back to old dinner when the latest delivered response is not QA', async () => {
    const s = subject();
    s.prisma.scheduledMessage.findFirst.mockResolvedValue({
      id: 'workout',
      userId: 'user',
      conversationId: 'conversation',
      content: 'Treino atual',
      context: { source: 'WORKOUT_CURRENT_PLAN' },
      sentAt: deliveredTime,
    });
    expect(await s.service.findReferent(input)).toBeNull();
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(1);
  });
  it('does not resurrect scheduled dinner after a newer outbound Workout message', async () => {
    const s = subject();
    s.prisma.message.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        timestamp: before,
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce({
        id: 'dinner',
        content: 'Me da uma ideia de jantar',
        timestamp: sourceTime,
      })
      .mockResolvedValueOnce({
        content: 'Seu treino é caminhada.',
        timestamp: new Date('2026-10-05T20:05:00Z'),
      });
    expect(await s.service.findReferent(input)).toBeNull();
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(1);
  });
  it('lets an explicit quote select its delivered source', async () => {
    const s = subject();
    s.prisma.message.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        timestamp: before,
        replyToExternalMessageId: 'quoted',
      })
      .mockResolvedValue({
        id: 'dinner',
        content: 'Me da uma ideia de jantar',
        timestamp: sourceTime,
      });
    expect(await s.service.findReferent(input)).toEqual(referent);
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ externalMessageId: 'quoted' }),
      }),
    );
  });
  it.each([
    null,
    { disposition: 'SAFE_RESPONSE', domain: 'NUTRITION', answer },
    { disposition: 'ANSWER', domain: 'NUTRITION', answer: 4 },
    {
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'INVALID',
    },
  ])('rejects failed, safety or malformed AI results', async (result) => {
    const s = subject();
    s.prisma.aIJob.findFirst.mockResolvedValue({ result });
    expect(await s.service.findReferent(input)).toBeNull();
  });
  it('rejects an AI answer different from the selected delivery', async () => {
    const s = subject();
    s.prisma.aIJob.findFirst.mockResolvedValue({
      result: {
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: 'A non-selected candidate',
        followUpQuestion: null,
        grounding: 'MIXED',
        confidence: 'HIGH',
      },
    });
    expect(await s.service.findReferent(input)).toBeNull();
  });
  it('reconstructs an alternative and its current offer from the preceding dinner', async () => {
    const s = subject();
    const latestAnswer = 'Outra opção de jantar é sopa de lentilhas.';
    const question = 'Quer mais duas opções?';
    s.prisma.message.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        timestamp: before,
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce({
        id: 'alternative',
        content: 'Outra opcao',
        timestamp: new Date('2026-10-05T20:05:00Z'),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'dinner',
        content: 'Me da uma ideia de jantar',
        timestamp: sourceTime,
      })
      .mockResolvedValueOnce(null);
    s.prisma.scheduledMessage.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        id: 'alternative-sent',
        userId: 'user',
        conversationId: 'conversation',
        content: `${latestAnswer}\n\n${question}`,
        context: {
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'alternative',
        },
        sentAt: new Date('2026-10-05T20:06:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'dinner-sent',
        userId: 'user',
        conversationId: 'conversation',
        content: answer,
        context: {
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'dinner',
        },
        sentAt: deliveredTime,
      });
    s.prisma.aIJob.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        result: {
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer: latestAnswer,
          followUpQuestion: question,
          grounding: 'MIXED',
          confidence: 'HIGH',
        },
      })
      .mockResolvedValueOnce({
        result: {
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer,
          followUpQuestion: null,
          grounding: 'MIXED',
          confidence: 'HIGH',
        },
      });
    const latest = await s.service.findReferent(input);
    expect(latest).toMatchObject({
      sourceMessageId: 'alternative',
      nutrition: { meal: 'jantar' },
      followUpQuestion: question,
    });
    expect(
      effectiveNutritionRequest(readOnlyFollowUp('sim, eu quero')!, latest!),
    ).toMatchObject({ meal: 'jantar' });
  });
});
