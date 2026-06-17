import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.getReadiness();
  }

  @Get('live')
  getLiveness() {
    return this.healthService.liveness();
  }

  @Get('ready')
  async getReadiness() {
    const readiness = await this.healthService.check();
    const response = {
      status: readiness.status,
      checkedAt: readiness.checkedAt,
      checks: Object.fromEntries(
        Object.entries(readiness.checks).map(([name, check]) => [
          name,
          {
            status: check.status,
            latencyMs: check.latencyMs,
          },
        ]),
      ),
    };

    if (readiness.status !== 'ok') {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
