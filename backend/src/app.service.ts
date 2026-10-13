import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import {
  assertCurrentCommercialOffer,
  commercialPlanInclude,
} from './subscriptions/commercial-plan.policy';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHello() {
    const candidates = await this.prisma.plan.findMany({
      where: { isCurrentOffer: true, isActive: true },
      include: commercialPlanInclude,
      orderBy: { type: 'asc' },
    });
    const plans = candidates
      .filter((plan) => {
        try {
          assertCurrentCommercialOffer(plan);
          return true;
        } catch {
          return false;
        }
      })
      .map(({ entitlements, ...plan }) => ({
        ...plan,
        commercialLimits: Object.fromEntries(
          entitlements.map((grant) => [
            grant.entitlement.code,
            grant.unlimited ? null : grant.value,
          ]),
        ),
      }));
    return { message: 'Backend funcionando', plans };
  }
}
