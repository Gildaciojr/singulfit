import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
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
