import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('records normalized audit data through the supplied transaction', async () => {
    const auditLog = {
      create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
    };
    const service = new AuditService({} as PrismaService);

    await service.recordInTransaction(
      { auditLog } as unknown as Prisma.TransactionClient,
      {
        userId: 'user-id',
        action: ' payment_approved ',
        entityType: ' payment ',
        entityId: ' payment-id ',
        metadata: {
          invoiceId: 'invoice-id',
        },
      },
    );

    expect(auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        action: 'PAYMENT_APPROVED',
        entityType: 'PAYMENT',
        entityId: 'payment-id',
        metadata: {
          invoiceId: 'invoice-id',
        },
      },
    });
  });

  it('rejects invalid action codes before persistence', () => {
    const service = new AuditService({} as PrismaService);

    expect(() =>
      service.recordInTransaction({} as Prisma.TransactionClient, {
        action: 'invalid action',
        entityType: 'USER',
        entityId: 'user-id',
      }),
    ).toThrow(BadRequestException);
  });

  it('returns cursor pagination for administrative queries', async () => {
    const prisma = {
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'audit-1' },
            { id: 'audit-2' },
            { id: 'audit-3' },
          ]),
      },
    };
    const service = new AuditService(prisma as unknown as PrismaService);

    await expect(
      service.list({
        action: 'LOGIN',
        limit: 2,
      }),
    ).resolves.toEqual({
      items: [{ id: 'audit-1' }, { id: 'audit-2' }],
      nextCursor: 'audit-2',
    });
  });
});
