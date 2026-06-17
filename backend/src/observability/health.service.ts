import { Injectable } from '@nestjs/common';
import { ProductionReadinessService } from '../production/production-readiness.service';

@Injectable()
export class HealthService {
  constructor(private readonly readiness: ProductionReadinessService) {}

  liveness() {
    return {
      status: 'ok' as const,
      checkedAt: new Date().toISOString(),
    };
  }

  check() {
    return this.readiness.check();
  }
}
