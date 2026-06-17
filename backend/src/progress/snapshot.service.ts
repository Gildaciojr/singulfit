import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { AIJobType, Prisma } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROGRESS_INSIGHT_JSON_SCHEMA,
  PROGRESS_INSIGHT_JSON_SCHEMA_NAME,
  PROGRESS_INSIGHT_PROMPT_NAME,
} from './progress.constants';

const COMPARISON_WINDOW_DAYS = 30;

export interface PrepareSnapshotInput {
  userId: string;
  profileId: string;
  heightCm: number;
  weightKg: number;
  bodyFatPercent?: number;
  muscleMassKg?: number;
  createdAt: Date;
}

export interface PreparedSnapshot {
  bmi: Prisma.Decimal;
  insight: string;
  aiJobId?: string;
  aiResponse?: OpenAIResponseResult;
}

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AIService,
  ) {}

  async prepare(input: PrepareSnapshotInput): Promise<PreparedSnapshot> {
    const bmi = this.calculateBmi(input.weightKg, input.heightCm);
    const comparisonStart = new Date(
      input.createdAt.getTime() - COMPARISON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const previousSnapshot = await this.prisma.progressSnapshot.findFirst({
      where: {
        userId: input.userId,
        createdAt: {
          gte: comparisonStart,
          lt: input.createdAt,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const context = {
      current: {
        weightKg: input.weightKg,
        bodyFatPercent: input.bodyFatPercent ?? null,
        muscleMassKg: input.muscleMassKg ?? null,
        bmi: bmi.toNumber(),
        measuredAt: input.createdAt.toISOString(),
      },
      comparison: previousSnapshot
        ? {
            weightKg: previousSnapshot.weightKg.toNumber(),
            bodyFatPercent: previousSnapshot.bodyFatPercent?.toNumber() ?? null,
            muscleMassKg: previousSnapshot.muscleMassKg?.toNumber() ?? null,
            bmi: previousSnapshot.bmi.toNumber(),
            measuredAt: previousSnapshot.createdAt.toISOString(),
            weightChangeKg: this.round(
              input.weightKg - previousSnapshot.weightKg.toNumber(),
            ),
          }
        : null,
    };
    let insight: string;
    let aiJobId: string | undefined;
    let aiResponse: OpenAIResponseResult | undefined;

    try {
      const job = await this.aiService.createStandaloneJob({
        userId: input.userId,
        type: AIJobType.PROGRESS,
        promptName: PROGRESS_INSIGHT_PROMPT_NAME,
      });
      aiJobId = job.id;
      aiResponse = await this.aiService.runTextJob(job.id, {
        input: JSON.stringify(context),
        jsonSchema: {
          name: PROGRESS_INSIGHT_JSON_SCHEMA_NAME,
          description:
            'Insight curto, objetivo e não diagnóstico sobre evolução física.',
          schema: PROGRESS_INSIGHT_JSON_SCHEMA,
        },
      });

      insight = this.parseInsight(aiResponse.outputText);
    } catch (error: unknown) {
      if (aiJobId) {
        await this.aiService.failJob(aiJobId, error, aiResponse);
        aiJobId = undefined;
        aiResponse = undefined;
      }

      const message =
        error instanceof Error ? error.message : 'erro desconhecido';

      this.logger.warn(
        `Insight da OpenAI indisponível; usando contingência: ${message}`,
      );
      insight = this.buildFallbackInsight(input, previousSnapshot);
    }

    return {
      bmi,
      insight,
      aiJobId,
      aiResponse,
    };
  }

  async createInTransaction(
    transaction: Prisma.TransactionClient,
    input: PrepareSnapshotInput,
    prepared: PreparedSnapshot,
  ) {
    const snapshot = await transaction.progressSnapshot.create({
      data: {
        userId: input.userId,
        profileId: input.profileId,
        weightKg: this.decimal(input.weightKg),
        bodyFatPercent:
          input.bodyFatPercent === undefined
            ? undefined
            : this.decimal(input.bodyFatPercent),
        muscleMassKg:
          input.muscleMassKg === undefined
            ? undefined
            : this.decimal(input.muscleMassKg),
        bmi: prepared.bmi,
        createdAt: input.createdAt,
        insights: {
          create: {
            userId: input.userId,
            aiJobId: prepared.aiJobId,
            insight: prepared.insight,
          },
        },
      },
    });

    if (prepared.aiJobId && prepared.aiResponse) {
      await this.aiService.completeJobInTransaction(transaction, {
        userId: input.userId,
        aiJobId: prepared.aiJobId,
        jobType: AIJobType.PROGRESS,
        response: prepared.aiResponse,
      });
    }

    return snapshot;
  }

  async failPrepared(
    prepared: PreparedSnapshot,
    error: unknown,
  ): Promise<void> {
    if (prepared.aiJobId) {
      await this.aiService.failJob(
        prepared.aiJobId,
        error,
        prepared.aiResponse,
      );
    }
  }

  private calculateBmi(weightKg: number, heightCm: number): Prisma.Decimal {
    const heightMeters = heightCm / 100;

    return this.decimal(weightKg / (heightMeters * heightMeters));
  }

  private parseInsight(outputText: string): string {
    let value: unknown;

    try {
      value = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException(
        'OpenAI retornou JSON de progresso inválido',
      );
    }

    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as Record<string, unknown>).insight !== 'string'
    ) {
      throw new BadGatewayException(
        'OpenAI retornou estrutura de progresso inválida',
      );
    }

    const insight = (value as { insight: string }).insight.trim();

    if (!insight || insight.length > 500) {
      throw new BadGatewayException(
        'OpenAI retornou insight de progresso inválido',
      );
    }

    return insight;
  }

  private buildFallbackInsight(
    input: PrepareSnapshotInput,
    previousSnapshot: {
      weightKg: Prisma.Decimal;
      createdAt: Date;
    } | null,
  ): string {
    if (!previousSnapshot) {
      return 'Esta medição inicia sua linha de base de progresso.';
    }

    const change = this.round(
      input.weightKg - previousSnapshot.weightKg.toNumber(),
    );
    const days = Math.max(
      1,
      Math.round(
        (input.createdAt.getTime() - previousSnapshot.createdAt.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );

    if (Math.abs(change) < 0.01) {
      return `Seu peso permaneceu estável nos últimos ${days} dias.`;
    }

    const amount = Math.abs(change).toString().replace('.', ',');

    return change < 0
      ? `Você perdeu ${amount} kg nos últimos ${days} dias.`
      : `Você ganhou ${amount} kg nos últimos ${days} dias.`;
  }

  private decimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private round(value: number): number {
    return Number(value.toFixed(2));
  }
}
