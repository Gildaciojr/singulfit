import {
  DietPlanStatus,
  NutritionPlanStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  analyzeNutritionOwnershipDryRun,
  assertNutritionOwnershipDryRunArguments,
} from '../src/diet/ownership/nutrition-ownership-dry-run';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  assertNutritionOwnershipDryRunArguments(process.argv.slice(2));
  const [legacy, v2, ownershipTable] = await Promise.all([
    prisma.dietPlan.findMany({
      where: { status: DietPlanStatus.ACTIVE },
      select: { id: true, userId: true, profileId: true },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
    }),
    prisma.nutritionPlanV2.findMany({
      where: { status: NutritionPlanStatus.ACTIVE },
      select: { id: true, userId: true, profileId: true },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
    }),
    prisma.$queryRaw<readonly { readonly exists: boolean }[]>(Prisma.sql`
      SELECT to_regclass('public.nutrition_plan_ownerships') IS NOT NULL AS "exists"
    `),
  ]);
  const ownerships = ownershipTable[0]?.exists
    ? await prisma.nutritionPlanOwnership.findMany({
        select: { userId: true },
      })
    : [];
  const analysis = analyzeNutritionOwnershipDryRun({
    legacy,
    v2,
    ownedUserIds: new Set(ownerships.map((item) => item.userId)),
  });
  console.log(
    JSON.stringify(
      {
        ...analysis,
        ownershipRows: ownerships.length,
        activeLegacyPlans: legacy.length,
        activeV2Plans: v2.length,
        wouldBackfillCount: analysis.wouldBackfill.length,
        unresolvedConflictCount: analysis.conflicts.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
