import { Currency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  it('creates an invoice with the calculated total', async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'a3da5d19-6cff-43c0-bf89-f056ff93d278',
        }),
      },
      invoice: {
        create: jest.fn().mockImplementation(
          (query: {
            data: {
              total: {
                toString(): string;
              };
            };
          }) => Promise.resolve(query.data.total.toString()),
        ),
      },
    };
    const service = new InvoicesService(prisma as unknown as PrismaService);

    const total = await service.create({
      subscriptionId: 'a3da5d19-6cff-43c0-bf89-f056ff93d278',
      cycleNumber: 1,
      currency: Currency.BRL,
      subtotal: '99.90',
      discount: '10.00',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-07-01T00:00:00.000Z',
      dueAt: '2026-06-06T00:00:00.000Z',
    });

    expect(total).toBe('89.9');
    expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
  });
});
