import { ProductionReadinessService } from '../production/production-readiness.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('delegates readiness to local production checks', async () => {
    const readiness = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        checkedAt: '2026-06-13T12:00:00.000Z',
        checks: {},
      }),
    };
    const service = new HealthService(
      readiness as unknown as ProductionReadinessService,
    );

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      checkedAt: '2026-06-13T12:00:00.000Z',
      checks: {},
    });
    expect(readiness.check).toHaveBeenCalledTimes(1);
  });

  it('reports liveness without checking dependencies', () => {
    const readiness = {
      check: jest.fn(),
    };
    const service = new HealthService(
      readiness as unknown as ProductionReadinessService,
    );

    expect(service.liveness()).toEqual({
      status: 'ok',
      checkedAt: expect.any(String),
    });
    expect(readiness.check).not.toHaveBeenCalled();
  });
});
