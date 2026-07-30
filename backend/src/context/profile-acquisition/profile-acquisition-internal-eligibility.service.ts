import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProfileAcquisitionInternalEligibility } from './profile-acquisition-internal-rollout.contract';

@Injectable()
export class ProfileAcquisitionInternalEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    userId: string,
  ): Promise<ProfileAcquisitionInternalEligibility> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        isActive: true,
        onboardingCompleted: true,
      },
    });

    if (!user) {
      return this.result(false, false, 'USER_NOT_FOUND');
    }
    if (user.role !== UserRole.ADMIN) {
      return this.result(false, false, 'USER_NOT_INTERNAL');
    }
    if (!user.isActive) {
      return this.result(true, false, 'USER_INACTIVE');
    }
    if (!user.onboardingCompleted) {
      return this.result(true, false, 'ONBOARDING_INCOMPLETE');
    }

    return this.result(true, true, 'INTERNAL_ELIGIBLE');
  }

  private result(
    internal: boolean,
    eligible: boolean,
    reason: ProfileAcquisitionInternalEligibility['reason'],
  ): ProfileAcquisitionInternalEligibility {
    return Object.freeze({ internal, eligible, reason });
  }
}
