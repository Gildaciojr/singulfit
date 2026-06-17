import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestMetadata } from '../interfaces/auth-request-metadata.interface';
import { JwtAuthPayload } from '../interfaces/jwt-auth-payload.interface';

interface CreateSessionInput extends AuthRequestMetadata {
  id: string;
  userId: string;
  refreshToken: string;
  jti: string;
  expiresAt: Date;
}

interface RotateSessionInput {
  currentPayload: JwtAuthPayload;
  currentRefreshToken: string;
  nextSession: CreateSessionInput;
}

@Injectable()
export class AuthSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: CreateSessionInput) {
    return this.prisma.authSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: this.hashRefreshToken(input.refreshToken),
        jti: input.jti,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async assertSessionActive(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
  }

  async rotateSession(input: RotateSessionInput) {
    const currentHash = this.hashRefreshToken(input.currentRefreshToken);

    return this.prisma.$transaction(async (transaction) => {
      const activeSession = await transaction.authSession.findUnique({
        where: {
          id: input.currentPayload.sessionId,
        },
        select: {
          userId: true,
          jti: true,
          refreshTokenHash: true,
          revokedAt: true,
          expiresAt: true,
        },
      });

      if (
        !activeSession ||
        activeSession.userId !== input.currentPayload.sub ||
        activeSession.jti !== input.currentPayload.jti ||
        activeSession.revokedAt ||
        activeSession.expiresAt <= new Date() ||
        !this.hashesMatch(activeSession.refreshTokenHash, currentHash)
      ) {
        throw new UnauthorizedException('Refresh token inválido');
      }

      const revoked = await transaction.authSession.updateMany({
        where: {
          id: input.currentPayload.sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException('Refresh token já utilizado');
      }

      return this.createSessionWithClient(transaction, input.nextSession);
    });
  }

  async revokeSession(
    payload: JwtAuthPayload,
    refreshToken: string,
  ): Promise<void> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: {
        id: payload.sessionId,
      },
      select: {
        userId: true,
        jti: true,
        refreshTokenHash: true,
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.jti !== payload.jti ||
      !this.hashesMatch(session.refreshTokenHash, refreshTokenHash)
    ) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    await this.prisma.authSession.updateMany({
      where: {
        id: payload.sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private createSessionWithClient(
    client: Prisma.TransactionClient,
    input: CreateSessionInput,
  ) {
    return client.authSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: this.hashRefreshToken(input.refreshToken),
        jti: input.jti,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashesMatch(storedHash: string, candidateHash: string): boolean {
    const storedBuffer = Buffer.from(storedHash, 'hex');
    const candidateBuffer = Buffer.from(candidateHash, 'hex');

    return (
      storedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(storedBuffer, candidateBuffer)
    );
  }
}
