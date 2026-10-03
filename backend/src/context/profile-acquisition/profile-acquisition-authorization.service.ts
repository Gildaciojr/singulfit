import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionAccessService } from '../../subscriptions/subscription-access.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalEligibilityService } from './profile-acquisition-internal-eligibility.service';
import { PROFILE_ACQUISITION_MODE } from './profile-acquisition.contract';

/** Reuses WhatsApp's canonical access policy; acquisition does not reserve usage. */
@Injectable()
export class ProfileAcquisitionAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ProfileAcquisitionOperationalConfigService,
    private readonly internal: ProfileAcquisitionInternalEligibilityService,
    private readonly access: SubscriptionAccessService,
  ) {}

  async isAllowed(userId: string, at = new Date()): Promise<boolean> {
    const mode = this.config.get().mode;
    if (mode === PROFILE_ACQUISITION_MODE.INTERNAL)
      return (await this.internal.evaluate(userId)).eligible;
    if (mode !== PROFILE_ACQUISITION_MODE.PRODUCTIVE) return false;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, onboardingCompleted: true },
      });
      if (
        !user ||
        user.id !== userId ||
        !user.isActive ||
        !user.onboardingCompleted
      )
        return false;
      const subscription = await this.access.requireAccess(userId, at);
      return subscription.userId === userId;
    } catch {
      return false;
    }
  }
}
