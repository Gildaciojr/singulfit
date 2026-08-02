import { MessageDirection } from '@prisma/client';
import { CoachProfileSnapshotConversationAdapter } from '../adapters/coach-profile-snapshot.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from '../adapters/profile-acquisition-decision.adapter';
import { ConversationTurnContextBuilderService } from '../runtime/conversation-turn-context-builder.service';
import {
  readyAdaptiveDecision,
  routingSnapshot,
} from './conversation-routing.fixtures';

describe('ConversationTurnContextBuilderService', () => {
  function createSubject(
    conversation: {
      messages: readonly {
        direction: MessageDirection;
        content: string;
        timestamp: Date;
      }[];
    } | null,
  ) {
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const snapshotBuilder = {
      build: jest.fn().mockResolvedValue(routingSnapshot()),
    };
    const collector = {
      decide: jest.fn().mockReturnValue(readyAdaptiveDecision()),
    };
    const questions = { toCollectorField: jest.fn().mockReturnValue(null) };
    const service = new ConversationTurnContextBuilderService(
      prisma as never,
      snapshotBuilder as never,
      collector as never,
      new CoachProfileSnapshotConversationAdapter(),
      new ProfileAcquisitionDecisionConversationAdapter(),
      questions as never,
    );
    return { service, prisma, snapshotBuilder, collector };
  }

  const input = {
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'message-id',
    text: 'quero uma dieta',
    receivedAt: '2026-08-01T12:00:00.000Z',
    legacyIntent: 'DIET' as const,
  };

  it('builds one bounded recent-history query and one snapshot', async () => {
    const subject = createSubject({
      messages: [
        {
          direction: MessageDirection.OUTBOUND,
          content: 'Resposta anterior',
          timestamp: new Date('2026-08-01T11:59:00.000Z'),
        },
        {
          direction: MessageDirection.INBOUND,
          content: 'Mensagem anterior',
          timestamp: new Date('2026-08-01T11:58:00.000Z'),
        },
      ],
    });

    const result = await subject.service.build(input);

    expect(subject.prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-id', userId: 'user-id' },
        select: expect.objectContaining({
          messages: expect.objectContaining({ take: 8 }),
        }),
      }),
    );
    expect(subject.prisma.conversation.findFirst).toHaveBeenCalledTimes(1);
    expect(subject.snapshotBuilder.build).toHaveBeenCalledTimes(1);
    expect(subject.collector.decide).toHaveBeenCalledTimes(1);
    expect(result.understandingInput.recentHistory).toHaveLength(2);
    expect(
      result.understandingInput.recentHistory.map((entry) => entry.text),
    ).toEqual(['Mensagem anterior', 'Resposta anterior']);
    expect(result.understandingInput.text).toBe('quero uma dieta');
    expect(result.understandingInput.profile.currentPlans).toEqual({
      dietAvailable: false,
      workoutAvailable: false,
    });
    expect(
      subject.prisma.conversation.findFirst.mock.calls[0][0].select.messages
        .select,
    ).toEqual({ direction: true, content: true, timestamp: true });
  });

  it('rejects a missing or foreign conversation', async () => {
    const subject = createSubject(null);

    await expect(subject.service.build(input)).rejects.toThrow(
      'Conversa não encontrada',
    );
  });

  it('propagates a missing profile snapshot for runtime isolation', async () => {
    const subject = createSubject({ messages: [] });
    subject.snapshotBuilder.build.mockRejectedValueOnce(
      new Error('Profile snapshot unavailable'),
    );

    await expect(subject.service.build(input)).rejects.toThrow(
      'Profile snapshot unavailable',
    );
  });
});
