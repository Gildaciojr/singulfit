import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PixRenewalIntentResult =
  | Readonly<{ matched: false }>
  | Readonly<{ matched: true; userId: string; messageId: string }>;

const EXPLICIT_PIX_RENEWAL = [
  /^renovar$/iu,
  /\bquero\s+renovar(?:\s+(?:minha\s+)?assinatura)?\b/iu,
  /\bquero\s+pagar\s+(?:minha\s+)?renova[cç][aã]o\b/iu,
  /\bmanda\s+(?:o\s+)?pix\s+(?:para\s+)?renovar\b/iu,
  /\bpode\s+gerar\s+(?:o\s+)?pix\s+(?:da\s+)?renova[cç][aã]o\b/iu,
];

@Injectable()
export class PixRenewalIntentService {
  constructor(private readonly prisma: PrismaService) {}

  async match(input: {
    userId: string;
    messageId: string;
  }): Promise<PixRenewalIntentResult> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: { userId: input.userId },
      },
      select: { content: true },
    });

    if (!message || !this.isExplicitRenewal(message.content)) {
      return { matched: false };
    }

    return { matched: true, userId: input.userId, messageId: input.messageId };
  }

  private isExplicitRenewal(text: string): boolean {
    const normalized = text.trim().replace(/\s+/gu, ' ');
    return EXPLICIT_PIX_RENEWAL.some((pattern) => pattern.test(normalized));
  }
}
