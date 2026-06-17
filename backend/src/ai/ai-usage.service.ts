import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIJobType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAIUsageInput {
  userId: string;
  aiJobId: string;
  jobType: AIJobType;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

@Injectable()
export class AIUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async record(input: RecordAIUsageInput) {
    const job = await this.prisma.aIJob.findUnique({
      where: {
        id: input.aiJobId,
      },
      select: {
        userId: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job de IA não encontrado');
    }

    if (job.userId !== input.userId) {
      throw new BadRequestException(
        'O job de IA não pertence ao usuário informado',
      );
    }

    return this.prisma.$transaction((transaction) =>
      this.createUsage(transaction, input),
    );
  }

  recordInTransaction(
    transaction: Prisma.TransactionClient,
    input: RecordAIUsageInput,
  ) {
    return this.createUsage(transaction, input);
  }

  estimateCost(
    jobType: AIJobType,
    promptTokens: number,
    completionTokens: number,
  ): Prisma.Decimal {
    this.validateTokens(promptTokens, completionTokens, undefined);
    const capability = jobType === AIJobType.IMAGE ? 'VISION' : 'TEXT';
    const inputRate = this.getRate(
      `OPENAI_${capability}_INPUT_COST_PER_1M_USD`,
    );
    const outputRate = this.getRate(
      `OPENAI_${capability}_OUTPUT_COST_PER_1M_USD`,
    );

    return new Prisma.Decimal(promptTokens)
      .mul(inputRate)
      .add(new Prisma.Decimal(completionTokens).mul(outputRate))
      .div(1_000_000)
      .toDecimalPlaces(8);
  }

  private async createUsage(
    client: PrismaService | Prisma.TransactionClient,
    input: RecordAIUsageInput,
  ) {
    this.validateTokens(
      input.promptTokens,
      input.completionTokens,
      input.totalTokens,
    );
    const model = input.model.trim();

    if (!model) {
      throw new BadRequestException('Modelo de IA não informado');
    }

    const estimatedCost = this.estimateCost(
      input.jobType,
      input.promptTokens,
      input.completionTokens,
    );
    const usage = await client.aIUsage.create({
      data: {
        userId: input.userId,
        aiJobId: input.aiJobId,
        model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        estimatedCost,
        costCurrency: 'USD',
      },
    });
    const date = this.utcDay(usage.createdAt ?? new Date());

    await client.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(${`ai-usage-summary:${date.toISOString().slice(0, 10)}`})
        )
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;

    await client.aIUsageSummary.upsert({
      where: {
        userId_date: {
          userId: input.userId,
          date,
        },
      },
      create: {
        userId: input.userId,
        date,
        totalTokens: input.totalTokens,
        totalCostUsd: estimatedCost,
      },
      update: {
        totalTokens: {
          increment: input.totalTokens,
        },
        totalCostUsd: {
          increment: estimatedCost,
        },
      },
    });

    return usage;
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private validateTokens(
    promptTokens: number,
    completionTokens: number,
    totalTokens: number | undefined,
  ): void {
    if (
      !Number.isInteger(promptTokens) ||
      promptTokens < 0 ||
      !Number.isInteger(completionTokens) ||
      completionTokens < 0
    ) {
      throw new BadRequestException(
        'A contabilização de tokens deve conter inteiros não negativos',
      );
    }

    if (
      totalTokens !== undefined &&
      (!Number.isInteger(totalTokens) ||
        totalTokens !== promptTokens + completionTokens)
    ) {
      throw new BadRequestException('Total de tokens inconsistente');
    }
  }

  private getRate(key: string): Prisma.Decimal {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Configuração obrigatória ausente: ${key}`,
      );
    }

    try {
      const rate = new Prisma.Decimal(value);

      if (rate.isNegative()) {
        throw new Error('negative rate');
      }

      return rate;
    } catch {
      throw new ServiceUnavailableException(
        `Configuração de custo inválida: ${key}`,
      );
    }
  }
}
