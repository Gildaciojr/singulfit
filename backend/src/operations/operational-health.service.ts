import { Injectable } from '@nestjs/common';
import { ProductionReadinessService } from '../production/production-readiness.service';

@Injectable()
export class OperationalHealthService {
  constructor(private readonly readiness: ProductionReadinessService) {}

  async check() {
    const result = await this.readiness.check();

    return {
      status: result.status,
      checkedAt: result.checkedAt,
      ...result.checks,
      ai: result.checks.openai,
      webhooks: result.checks.pagbank,
    };
  }
}
