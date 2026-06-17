import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  it.each([
    [null, 'PROFILE_INCOMPLETE', false],
    [{ id: 'profile-id' }, 'PROFILE_COMPLETE', true],
  ])(
    'returns the profile checklist for the current state',
    async (profile, expectedStatus, expectedCompleted) => {
      const prisma = {
        fitnessProfile: {
          findUnique: jest.fn().mockResolvedValue(profile),
        },
      };
      const subscriptionsService = {
        getProfileSubscription: jest.fn().mockResolvedValue({
          status: 'PAST_DUE',
        }),
      };
      const service = new OnboardingService(
        prisma as unknown as PrismaService,
        subscriptionsService as unknown as SubscriptionsService,
      );

      await expect(service.getChecklist('user-id')).resolves.toEqual({
        status: expectedStatus,
        completed: expectedCompleted,
        subscriptionStatus: 'PAST_DUE',
      });
    },
  );

  it('synchronizes the persisted onboarding flag', async () => {
    const transaction = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'profile-id',
        }),
      },
      user: {
        update: jest.fn().mockResolvedValue({
          id: 'user-id',
        }),
      },
    };
    const service = new OnboardingService(
      {} as PrismaService,
      {} as SubscriptionsService,
    );

    await expect(
      service.synchronizeInTransaction(transaction as never, 'user-id'),
    ).resolves.toBe('PROFILE_COMPLETE');
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: {
        id: 'user-id',
      },
      data: {
        onboardingCompleted: true,
      },
    });
  });
});
