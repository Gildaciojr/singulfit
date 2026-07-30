import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  NutritionShadowComparisonRepository,
  PersistNutritionShadowComparisonInput,
} from './nutrition-shadow-comparison.repository';

@Injectable()
export class PrismaNutritionShadowComparisonGateway implements NutritionShadowComparisonRepository {
  constructor(private readonly prisma: PrismaService) {}

  persist(input: PersistNutritionShadowComparisonInput) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`nutrition-shadow-comparison:${input.operationKey}`})
          )
        )
        SELECT true AS "locked" FROM advisory_lock
      `;
      const existing = await transaction.nutritionShadowComparison.findUnique({
        where: { operationKey: input.operationKey },
        select: { id: true, inputFingerprint: true },
      });
      if (existing) {
        if (existing.inputFingerprint !== input.inputFingerprint)
          throw new ConflictException(
            'Chave de comparação Shadow pertence a uma entrada incompatível',
          );
        return { comparison: Object.freeze(existing), reused: true };
      }
      const created = await transaction.nutritionShadowComparison.create({
        data: {
          ...input,
          divergences: [...input.divergences],
          legacyCostUsd: this.decimal(input.legacyCostUsd),
          shadowCostUsd: this.decimal(input.shadowCostUsd),
          timeRatio: this.decimal(input.timeRatio),
          tokenRatio: this.decimal(input.tokenRatio),
          costRatio: this.decimal(input.costRatio),
        },
        select: { id: true, inputFingerprint: true },
      });
      return { comparison: Object.freeze(created), reused: false };
    });
  }

  private decimal(value: string | null): Prisma.Decimal | null {
    return value === null ? null : new Prisma.Decimal(value);
  }
}
