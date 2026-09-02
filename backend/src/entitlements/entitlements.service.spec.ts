import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
  it.each([
    ['basic-plan', false, 1],
    ['premium-plan', true, null],
  ] as const)(
    'resolves %s from the persisted subscription cycle without role checks',
    async (planId, unlimited, limit) => {
      const periodStart = new Date('2026-08-17T15:00:00.000Z');
      const periodEnd = new Date('2026-09-17T15:00:00.000Z');
      const accessService = {
        requireAccessInTransaction: jest.fn().mockResolvedValue({
          planId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        }),
      };
      const prisma = {
        planEntitlement: {
          findFirst: jest.fn().mockResolvedValue({
            value: unlimited ? 0 : 1,
            unlimited,
          }),
        },
      };
      const service = new EntitlementsService(
        prisma as unknown as PrismaService,
        accessService as unknown as SubscriptionAccessService,
      );

      await expect(
        service.resolveCommercialGrant(
          'normal-user-id',
          'WORKOUT_PLAN_GENERATION',
          new Date('2026-09-02T12:00:00.000Z'),
        ),
      ).resolves.toEqual({
        code: 'WORKOUT_PLAN_GENERATION',
        unlimited,
        limit,
        periodStart,
        periodEnd,
      });
      expect(prisma.planEntitlement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ planId }) }),
      );
    },
  );

  it('uses the current plan values after a future upgrade', async () => {
    const accessService = {
      requireAccessInTransaction: jest
        .fn()
        .mockResolvedValueOnce({ planId: 'basic-plan' })
        .mockResolvedValueOnce({ planId: 'premium-plan' }),
    };
    const prisma = {
      plan: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            entitlements: [
              {
                value: 5,
                entitlement: { code: 'IMAGE_ANALYSIS_DAILY' },
              },
            ],
          })
          .mockResolvedValueOnce({
            entitlements: [
              {
                value: 50,
                entitlement: { code: 'IMAGE_ANALYSIS_DAILY' },
              },
            ],
          }),
      },
    };
    const service = new EntitlementsService(
      prisma as unknown as PrismaService,
      accessService as unknown as SubscriptionAccessService,
    );
    const at = new Date('2026-06-10T12:00:00.000Z');

    const basic = await service.getForUser(
      'user-id',
      ['IMAGE_ANALYSIS_DAILY'],
      at,
    );
    const premium = await service.getForUser(
      'user-id',
      ['IMAGE_ANALYSIS_DAILY'],
      at,
    );

    expect(basic.get('IMAGE_ANALYSIS_DAILY')).toBe(5);
    expect(premium.get('IMAGE_ANALYSIS_DAILY')).toBe(50);
  });
});
