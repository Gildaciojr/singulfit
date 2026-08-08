import { NutritionPlanImplementation } from '@prisma/client';
import {
  analyzeNutritionOwnershipDryRun,
  assertNutritionOwnershipDryRunArguments,
} from './nutrition-ownership-dry-run';

describe('nutrition ownership dry-run', () => {
  const plan = (id: string, userId: string) => ({
    id,
    userId,
    profileId: `profile-${userId}`,
  });

  it('classifies safe Legacy and V2 candidates without writing', () => {
    const result = analyzeNutritionOwnershipDryRun({
      legacy: [plan('legacy-id', 'legacy-user')],
      v2: [plan('v2-id', 'v2-user')],
      ownedUserIds: new Set(),
    });
    expect(result.wouldBackfill).toEqual([
      expect.objectContaining({
        userId: 'legacy-user',
        implementation: NutritionPlanImplementation.LEGACY,
      }),
      expect.objectContaining({
        userId: 'v2-user',
        implementation: NutritionPlanImplementation.V2,
      }),
    ]);
  });

  it('lists dual-active and duplicate-active without timestamp heuristics', () => {
    const dualActive = analyzeNutritionOwnershipDryRun({
      legacy: [plan('legacy-id', 'dual-user')],
      v2: [plan('v2-id', 'dual-user')],
      ownedUserIds: new Set(),
    });
    expect(dualActive.wouldBackfill).toEqual([]);
    expect(dualActive.conflicts).toEqual([
      {
        userId: 'dual-user',
        legacyPlanIds: ['legacy-id'],
        v2PlanIds: ['v2-id'],
      },
    ]);

    const duplicateActive = analyzeNutritionOwnershipDryRun({
      legacy: [
        plan('legacy-id-1', 'duplicate-legacy-user'),
        plan('legacy-id-2', 'duplicate-legacy-user'),
      ],
      v2: [
        plan('v2-id-1', 'duplicate-v2-user'),
        plan('v2-id-2', 'duplicate-v2-user'),
      ],
      ownedUserIds: new Set(),
    });
    expect(duplicateActive.wouldBackfill).toEqual([]);
    expect(duplicateActive.conflicts).toEqual([
      {
        userId: 'duplicate-legacy-user',
        legacyPlanIds: ['legacy-id-1', 'legacy-id-2'],
        v2PlanIds: [],
      },
      {
        userId: 'duplicate-v2-user',
        legacyPlanIds: [],
        v2PlanIds: ['v2-id-1', 'v2-id-2'],
      },
    ]);
  });

  it('is empty with no plans and skips already owned users', () => {
    expect(
      analyzeNutritionOwnershipDryRun({
        legacy: [],
        v2: [],
        ownedUserIds: new Set(),
      }),
    ).toMatchObject({ wouldBackfill: [], conflicts: [] });
    expect(
      analyzeNutritionOwnershipDryRun({
        legacy: [plan('legacy-id', 'owned-user')],
        v2: [],
        ownedUserIds: new Set(['owned-user']),
      }),
    ).toMatchObject({ wouldBackfill: [], conflicts: [], alreadyOwnedCount: 1 });
  });

  it('rejects every argument because no write mode exists', () => {
    expect(() => assertNutritionOwnershipDryRunArguments([])).not.toThrow();
    expect(() => assertNutritionOwnershipDryRunArguments(['--apply'])).toThrow(
      'dry-run',
    );
  });
});
