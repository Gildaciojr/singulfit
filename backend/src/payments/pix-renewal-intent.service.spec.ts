import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PixRenewalIntentService } from './pix-renewal-intent.service';

describe('PixRenewalIntentService', () => {
  function subject(content: string | null = 'quero renovar') {
    const prisma = {
      message: {
        findFirst: jest
          .fn()
          .mockResolvedValue(content === null ? null : { content }),
      },
    };
    return {
      service: new PixRenewalIntentService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it.each([
    'quero renovar',
    'quero renovar minha assinatura',
    'quero pagar minha renovação',
    'manda o pix para renovar',
    'pode gerar o pix da renovação',
  ])('matches an explicit PIX renewal request: %s', async (content) => {
    const test = subject(content);
    await expect(
      test.service.match({ userId: 'user-id', messageId: 'message-id' }),
    ).resolves.toEqual({
      matched: true,
      userId: 'user-id',
      messageId: 'message-id',
    });
  });

  it.each(['sim', 'ok', 'pode', 'manda', 'quero'])(
    'does not match a short ambiguous confirmation: %s',
    async (content) => {
      const test = subject(content);
      await expect(
        test.service.match({ userId: 'user-id', messageId: 'message-id' }),
      ).resolves.toEqual({ matched: false });
    },
  );

  it.each(['qual é meu treino?', 'quero mudar de plano', 'bom dia'])(
    'does not match normal conversation: %s',
    async (content) => {
      const test = subject(content);
      await expect(
        test.service.match({ userId: 'user-id', messageId: 'message-id' }),
      ).resolves.toEqual({ matched: false });
    },
  );

  it('requires an inbound text message owned by the canonical conversation user', async () => {
    const test = subject(null);
    await expect(
      test.service.match({ userId: 'user-id', messageId: 'message-id' }),
    ).resolves.toEqual({ matched: false });
    expect(test.prisma.message.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'message-id',
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: { userId: 'user-id' },
      },
      select: { content: true },
    });
  });

  it('matches only the renewal wording and does not derive a plan or price from it', async () => {
    const test = subject('quero renovar o plano PREMIUM por R$ 1');
    await expect(
      test.service.match({ userId: 'user-id', messageId: 'message-id' }),
    ).resolves.toMatchObject({ matched: true, userId: 'user-id' });
  });
});
