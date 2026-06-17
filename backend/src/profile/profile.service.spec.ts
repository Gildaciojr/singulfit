import { ActivityLevel, FitnessGoal, Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotService } from '../progress/snapshot.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OnboardingService } from './onboarding.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  function createSubject() {
    const profile = {
      id: 'profile-id',
      userId: 'user-id',
      gender: Gender.FEMALE,
      birthDate: new Date('1995-04-10T00:00:00.000Z'),
      heightCm: 165,
      currentWeightKg: new Prisma.Decimal('70.00'),
      targetWeightKg: new Prisma.Decimal('62.00'),
      activityLevel: ActivityLevel.MODERATE,
      goal: FitnessGoal.WEIGHT_LOSS,
      foodRestrictions: [],
      injuryRestrictions: [],
    };
    const transaction = {
      fitnessProfile: {
        create: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue(profile),
      },
      foodRestriction: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      injuryRestriction: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bodyMeasurement: {
        create: jest.fn().mockResolvedValue({
          id: 'measurement-id',
          profileId: 'profile-id',
          weightKg: new Prisma.Decimal('68.50'),
        }),
      },
    };
    const prisma = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'profile-id',
          heightCm: 165,
        }),
      },
      bodyMeasurement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        id: 'subscription-id',
        status: 'ACTIVE',
      }),
    };
    const onboardingService = {
      synchronizeInTransaction: jest.fn().mockResolvedValue('PROFILE_COMPLETE'),
    };
    const snapshotService = {
      prepare: jest.fn().mockResolvedValue({
        bmi: new Prisma.Decimal('25.16'),
        insight: 'Você iniciou seu acompanhamento.',
      }),
      createInTransaction: jest.fn().mockResolvedValue({
        id: 'snapshot-id',
      }),
    };
    const service = new ProfileService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
      onboardingService as unknown as OnboardingService,
      snapshotService as unknown as SnapshotService,
    );

    return {
      service,
      prisma,
      transaction,
      subscriptionsService,
      onboardingService,
      snapshotService,
      profile,
    };
  }

  it('creates the full profile and completes onboarding atomically', async () => {
    const subject = createSubject();

    await expect(
      subject.service.create('user-id', {
        gender: Gender.FEMALE,
        birthDate: '1995-04-10',
        heightCm: 165,
        currentWeightKg: 70,
        targetWeightKg: 62,
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: [
          {
            type: 'ALLERGY',
            description: ' Amendoim ',
          },
        ],
        injuryRestrictions: [
          {
            description: ' Lesão no joelho ',
          },
        ],
      }),
    ).resolves.toBe(subject.profile);
    expect(subject.transaction.fitnessProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        currentWeightKg: expect.any(Prisma.Decimal),
        foodRestrictions: {
          create: [
            {
              type: 'ALLERGY',
              description: 'Amendoim',
            },
          ],
        },
        injuryRestrictions: {
          create: [
            {
              description: 'Lesão no joelho',
            },
          ],
        },
      }),
      include: expect.any(Object),
    });
    expect(
      subject.onboardingService.synchronizeInTransaction,
    ).toHaveBeenCalledWith(subject.transaction, 'user-id');
  });

  it('replaces only restriction collections supplied by a patch', async () => {
    const subject = createSubject();

    await subject.service.update('user-id', {
      targetWeightKg: 60,
      foodRestrictions: [
        {
          type: 'INTOLERANCE',
          description: 'Lactose',
        },
      ],
    });

    expect(subject.transaction.foodRestriction.deleteMany).toHaveBeenCalledWith(
      {
        where: {
          profileId: 'profile-id',
        },
      },
    );
    expect(subject.transaction.foodRestriction.createMany).toHaveBeenCalled();
    expect(
      subject.transaction.injuryRestriction.deleteMany,
    ).not.toHaveBeenCalled();
    expect(subject.transaction.fitnessProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetWeightKg: expect.any(Prisma.Decimal),
        }),
      }),
    );
  });

  it('stores a measurement and synchronizes the current profile weight', async () => {
    const subject = createSubject();

    await subject.service.createMeasurement('user-id', {
      weightKg: 68.5,
      bodyFatPercent: 24.2,
      muscleMassKg: 27.8,
      measuredAt: '2026-06-09T12:00:00.000Z',
    });

    expect(subject.transaction.bodyMeasurement.create).toHaveBeenCalledWith({
      data: {
        profileId: 'profile-id',
        weightKg: expect.any(Prisma.Decimal),
        bodyFatPercent: expect.any(Prisma.Decimal),
        muscleMassKg: expect.any(Prisma.Decimal),
        measuredAt: new Date('2026-06-09T12:00:00.000Z'),
      },
    });
    expect(subject.transaction.fitnessProfile.update).toHaveBeenCalledWith({
      where: {
        id: 'profile-id',
      },
      data: {
        currentWeightKg: expect.any(Prisma.Decimal),
      },
    });
    expect(subject.snapshotService.prepare).toHaveBeenCalledWith({
      userId: 'user-id',
      profileId: 'profile-id',
      heightCm: 165,
      weightKg: 68.5,
      bodyFatPercent: 24.2,
      muscleMassKg: 27.8,
      createdAt: new Date('2026-06-09T12:00:00.000Z'),
    });
    expect(subject.snapshotService.createInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        profileId: 'profile-id',
      }),
      expect.objectContaining({
        insight: 'Você iniciou seu acompanhamento.',
      }),
    );
  });

  it('orders measurements from newest to oldest', async () => {
    const subject = createSubject();

    await subject.service.listMeasurements('user-id');

    expect(subject.prisma.bodyMeasurement.findMany).toHaveBeenCalledWith({
      where: {
        profileId: 'profile-id',
      },
      orderBy: [
        {
          measuredAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  });
});
