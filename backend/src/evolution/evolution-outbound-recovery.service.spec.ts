import { ConfigService } from '@nestjs/config';
import { EvolutionOutboundRecoveryService } from './evolution-outbound-recovery.service';

describe('EvolutionOutboundRecoveryService', () => {
  it('retries pending and stale outbound messages', async () => {
    const prisma = {
      outboundMessage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }]),
      },
    };
    const sendService = {
      sendText: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new EvolutionOutboundRecoveryService(
      prisma as never,
      sendService as never,
      config,
    );

    await expect(service.recover(new Date())).resolves.toBe(2);
    expect(sendService.sendText).toHaveBeenCalledTimes(2);
  });
});
