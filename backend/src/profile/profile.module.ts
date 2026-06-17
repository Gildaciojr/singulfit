import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { OnboardingService } from './onboarding.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, ProgressModule, SubscriptionsModule],
  controllers: [ProfileController],
  providers: [ProfileService, OnboardingService],
  exports: [ProfileService, OnboardingService],
})
export class ProfileModule {}
