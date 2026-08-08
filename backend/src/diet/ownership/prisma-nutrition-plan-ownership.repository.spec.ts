import { NutritionPlanImplementation, type Prisma } from '@prisma/client';
import { PrismaNutritionPlanOwnershipRepository } from './prisma-nutrition-plan-ownership.repository';

describe('PrismaNutritionPlanOwnershipRepository', () => {
  const repository = new PrismaNutritionPlanOwnershipRepository();

  it('uses diet as the shared canonical Nutrition lock', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ locked: true }]);
    await repository.acquireCanonicalLock(
      { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
      'user-id',
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.[1]).toBe('diet:user-id');
  });

  it.each([
    [NutritionPlanImplementation.LEGACY, 'dietPlan'],
    [NutritionPlanImplementation.V2, 'nutritionPlanV2'],
  ] as const)(
    'validates %s against its own active aggregate',
    async (implementation, delegate) => {
      const dietPlan = { count: jest.fn().mockResolvedValue(1) };
      const nutritionPlanV2 = { count: jest.fn().mockResolvedValue(1) };
      const exists = await repository.targetExists(
        { dietPlan, nutritionPlanV2 } as unknown as Prisma.TransactionClient,
        {
          userId: 'user-id',
          profileId: 'profile-id',
          implementation,
          planId: 'plan-id',
          aiJobId: 'job-id',
        },
      );
      expect(exists).toBe(true);
      expect(
        delegate === 'dietPlan' ? dietPlan.count : nutritionPlanV2.count,
      ).toHaveBeenCalledTimes(1);
    },
  );
});
