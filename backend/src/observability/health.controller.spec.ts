import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns liveness without contacting external dependencies', () => {
    const healthService = {
      liveness: jest.fn().mockReturnValue({
        status: 'ok',
        checkedAt: '2026-06-10T12:00:00.000Z',
      }),
    };
    const controller = new HealthController(
      healthService as unknown as HealthService,
    );

    expect(controller.getLiveness()).toEqual({
      status: 'ok',
      checkedAt: '2026-06-10T12:00:00.000Z',
    });
  });

  it('returns HTTP 503 semantics and strips sensitive details when degraded', async () => {
    const healthService = {
      check: jest.fn().mockResolvedValue({
        status: 'degraded',
        checkedAt: '2026-06-10T12:00:00.000Z',
        checks: {
          database: {
            status: 'DOWN',
            latencyMs: 10,
            detail: 'database password leaked',
          },
        },
      }),
    };
    const controller = new HealthController(
      healthService as unknown as HealthService,
    );

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    try {
      await controller.getReadiness();
    } catch (error: unknown) {
      const response = (error as ServiceUnavailableException).getResponse();
      expect(JSON.stringify(response)).not.toContain('password');
    }
  });
});
