import { UsageEventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_ANALYSIS_DAILY,
  IMAGE_ANALYSIS_MONTHLY,
} from './entitlement.constants';
import { EntitlementsService } from './entitlements.service';
import { ReservationService } from './reservation.service';
import { UsageLimitExceededException } from './usage-limit.exception';

describe('ReservationService', () => {
  function createSubject(options?: {
    dailyLimit?: number;
    monthlyLimit?: number;
    dailyUsed?: number;
    monthlyUsed?: number;
    dailyReserved?: number;
    monthlyReserved?: number;
  }) {
    const buckets = {
      [IMAGE_ANALYSIS_DAILY]: {
        id: 'daily-bucket',
        used: options?.dailyUsed ?? 0,
        reserved: options?.dailyReserved ?? 0,
      },
      [IMAGE_ANALYSIS_MONTHLY]: {
        id: 'monthly-bucket',
        used: options?.monthlyUsed ?? 0,
        reserved: options?.monthlyReserved ?? 0,
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      usageEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(
          (args: {
            data: {
              userId: string;
              aiJobId: string;
              entitlementCode: string;
              quantity: number;
              status: UsageEventStatus;
            };
          }) =>
            Promise.resolve({
              id: `event-${args.data.entitlementCode}`,
              createdAt: new Date(),
              ...args.data,
            }),
        ),
      },
      usageBucket: {
        upsert: jest.fn().mockImplementation(
          (args: {
            create: {
              entitlementCode:
                | typeof IMAGE_ANALYSIS_DAILY
                | typeof IMAGE_ANALYSIS_MONTHLY;
              periodStart: Date;
              periodEnd: Date;
            };
          }) =>
            Promise.resolve({
              ...buckets[args.create.entitlementCode],
              userId: 'user-id',
              entitlementCode: args.create.entitlementCode,
              periodStart: args.create.periodStart,
              periodEnd: args.create.periodEnd,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
        ),
        update: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { id: string };
              data: { reserved: { increment: number } };
            }) => {
              const bucket =
                args.where.id === 'daily-bucket'
                  ? buckets[IMAGE_ANALYSIS_DAILY]
                  : buckets[IMAGE_ANALYSIS_MONTHLY];
              bucket.reserved += args.data.reserved.increment;
              return Promise.resolve(bucket);
            },
          ),
      },
    };
    const entitlementsService = {
      getForUserInTransaction: jest.fn().mockResolvedValue(
        new Map([
          [IMAGE_ANALYSIS_DAILY, options?.dailyLimit ?? 5],
          [IMAGE_ANALYSIS_MONTHLY, options?.monthlyLimit ?? 100],
        ]),
      ),
    };
    const service = new ReservationService(
      {} as PrismaService,
      entitlementsService as unknown as EntitlementsService,
    );

    return {
      service,
      transaction,
      buckets,
    };
  }

  it('reserves daily and monthly capacity for one image job', async () => {
    const subject = createSubject();

    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        {
          userId: 'user-id',
          aiJobId: 'job-id',
          at: new Date('2026-06-10T12:00:00.000Z'),
        },
      ),
    ).resolves.toHaveLength(2);
    expect(subject.buckets.IMAGE_ANALYSIS_DAILY.reserved).toBe(1);
    expect(subject.buckets.IMAGE_ANALYSIS_MONTHLY.reserved).toBe(1);
    expect(
      subject.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      subject.transaction.usageBucket.upsert.mock.invocationCallOrder[0],
    );
  });

  it('blocks the daily limit', async () => {
    const subject = createSubject({
      dailyUsed: 5,
    });

    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        {
          userId: 'user-id',
          aiJobId: 'job-id',
        },
      ),
    ).rejects.toMatchObject({
      entitlementCode: IMAGE_ANALYSIS_DAILY,
      limit: 5,
    } satisfies Partial<UsageLimitExceededException>);
  });

  it('blocks the monthly limit', async () => {
    const subject = createSubject({
      monthlyUsed: 100,
    });

    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        {
          userId: 'user-id',
          aiJobId: 'job-id',
        },
      ),
    ).rejects.toMatchObject({
      entitlementCode: IMAGE_ANALYSIS_MONTHLY,
      limit: 100,
    } satisfies Partial<UsageLimitExceededException>);
  });

  it('counts reservations when concurrent requests compete for the last slot', async () => {
    const subject = createSubject({
      dailyLimit: 1,
      monthlyLimit: 1,
    });

    await subject.service.reserveImageAnalysisInTransaction(
      subject.transaction as never,
      {
        userId: 'user-id',
        aiJobId: 'first-job',
      },
    );

    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        {
          userId: 'user-id',
          aiJobId: 'second-job',
        },
      ),
    ).rejects.toBeInstanceOf(UsageLimitExceededException);
  });
});
