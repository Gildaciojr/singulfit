import { UsageEventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IMAGE_ANALYSIS } from './entitlement.constants';
import { EntitlementsService } from './entitlements.service';
import { ReservationService } from './reservation.service';
import { UsageLimitExceededException } from './usage-limit.exception';

describe('ReservationService commercial billing-cycle quota', () => {
  const periodStart = new Date('2026-08-17T15:00:00.000Z');
  const periodEnd = new Date('2026-09-17T15:00:00.000Z');

  function createSubject(input?: {
    readonly used?: number;
    readonly reserved?: number;
    readonly limit?: number;
    readonly unlimited?: boolean;
  }) {
    const bucket = {
      id: 'bucket-id',
      used: input?.used ?? 0,
      reserved: input?.reserved ?? 0,
    };
    const events = new Map<
      string,
      {
        id: string;
        userId: string;
        aiJobId: string;
        entitlementCode: string;
        quantity: number;
        status: UsageEventStatus;
        createdAt: Date;
      }
    >();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Ana Silva' }),
      },
      usageEvent: {
        findUnique: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { aiJobId_entitlementCode: { aiJobId: string } };
            }) =>
              Promise.resolve(
                events.get(args.where.aiJobId_entitlementCode.aiJobId) ?? null,
              ),
          ),
        create: jest.fn().mockImplementation(
          (args: {
            data: {
              userId: string;
              aiJobId: string;
              entitlementCode: string;
              quantity: number;
              status: UsageEventStatus;
            };
          }) => {
            const event = {
              id: `event-${args.data.aiJobId}`,
              createdAt: new Date(),
              ...args.data,
            };
            events.set(args.data.aiJobId, event);
            return Promise.resolve(event);
          },
        ),
        update: jest.fn(),
      },
      usageBucket: {
        upsert: jest.fn().mockImplementation((args: { create: object }) =>
          Promise.resolve({
            ...bucket,
            ...args.create,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest
          .fn()
          .mockImplementation(
            (args: { data: { reserved: { increment: number } } }) => {
              bucket.reserved += args.data.reserved.increment;
              return Promise.resolve(bucket);
            },
          ),
      },
    };
    const entitlements = {
      resolveCommercialGrantInTransaction: jest.fn().mockResolvedValue({
        code: IMAGE_ANALYSIS,
        unlimited: input?.unlimited ?? false,
        limit: input?.unlimited ? null : (input?.limit ?? 5),
        periodStart,
        periodEnd,
      }),
    };
    return {
      service: new ReservationService(
        {} as PrismaService,
        entitlements as unknown as EntitlementsService,
      ),
      transaction,
      bucket,
    };
  }

  it('reserves one image analysis in the persisted subscription cycle', async () => {
    const subject = createSubject();
    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        { userId: 'user-id', aiJobId: 'job-id' },
      ),
    ).resolves.toHaveLength(1);
    expect(subject.bucket.reserved).toBe(1);
    expect(subject.transaction.usageBucket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ periodStart, periodEnd }),
      }),
    );
  });

  it('blocks the sixth BASIC analysis before creating a usage event', async () => {
    const subject = createSubject({ used: 5 });
    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        { userId: 'user-id', aiJobId: 'sixth-job' },
      ),
    ).rejects.toMatchObject({
      entitlementCode: IMAGE_ANALYSIS,
      limit: 5,
      friendlyMessage:
        'Olá, Ana. Você atingiu seu limite de 5 análises de alimentos e bebidas deste mês. No plano Premium você tem acesso ilimitado a tudo que eu posso te ajudar.',
    } satisfies Partial<UsageLimitExceededException>);
    expect(subject.transaction.usageEvent.create).not.toHaveBeenCalled();
  });

  it('allows PREMIUM without creating commercial counters', async () => {
    const subject = createSubject({ unlimited: true });
    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        { userId: 'premium-user', aiJobId: 'premium-job' },
      ),
    ).resolves.toEqual([]);
    expect(subject.transaction.usageBucket.upsert).not.toHaveBeenCalled();
    expect(subject.transaction.usageEvent.create).not.toHaveBeenCalled();
  });

  it('does not double-reserve the same operation job', async () => {
    const subject = createSubject();
    const input = { userId: 'user-id', aiJobId: 'same-job' };
    await subject.service.reserveImageAnalysisInTransaction(
      subject.transaction as never,
      input,
    );
    await subject.service.reserveImageAnalysisInTransaction(
      subject.transaction as never,
      input,
    );
    expect(subject.bucket.reserved).toBe(1);
    expect(subject.transaction.usageEvent.create).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two requests competing for one remaining slot', async () => {
    const subject = createSubject({ used: 4, limit: 5 });
    await subject.service.reserveImageAnalysisInTransaction(
      subject.transaction as never,
      { userId: 'user-id', aiJobId: 'first-job' },
    );
    await expect(
      subject.service.reserveImageAnalysisInTransaction(
        subject.transaction as never,
        { userId: 'user-id', aiJobId: 'second-job' },
      ),
    ).rejects.toBeInstanceOf(UsageLimitExceededException);
    expect(subject.transaction.usageEvent.create).toHaveBeenCalledTimes(1);
    expect(subject.transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
