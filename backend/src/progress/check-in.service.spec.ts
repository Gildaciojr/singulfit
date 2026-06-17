import { EnergyLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CheckInService } from './check-in.service';

describe('CheckInService', () => {
  function createSubject() {
    const checkIn = {
      id: 'check-in-id',
      userId: 'user-id',
      profileId: 'profile-id',
      mood: 'Motivado',
      energyLevel: EnergyLevel.HIGH,
      adherenceScore: 90,
      notes: 'Semana consistente',
    };
    const prisma = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'profile-id',
        }),
      },
      fitnessCheckIn: {
        create: jest.fn().mockResolvedValue(checkIn),
        findMany: jest.fn().mockResolvedValue([checkIn]),
      },
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
      }),
    };
    const service = new CheckInService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
    );

    return {
      service,
      prisma,
      subscriptionsService,
      checkIn,
    };
  }

  it('creates a normalized check-in for the authenticated user profile', async () => {
    const subject = createSubject();

    await expect(
      subject.service.create('user-id', {
        mood: ' Motivado ',
        energyLevel: EnergyLevel.HIGH,
        adherenceScore: 90,
        notes: ' Semana consistente ',
      }),
    ).resolves.toBe(subject.checkIn);
    expect(
      subject.subscriptionsService.getProfileSubscription,
    ).toHaveBeenCalledWith('user-id');
    expect(subject.prisma.fitnessCheckIn.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        profileId: 'profile-id',
        mood: 'Motivado',
        energyLevel: EnergyLevel.HIGH,
        adherenceScore: 90,
        notes: 'Semana consistente',
      },
    });
  });

  it('lists only the user check-ins from newest to oldest', async () => {
    const subject = createSubject();

    await subject.service.list('user-id');

    expect(subject.prisma.fitnessCheckIn.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  });
});
