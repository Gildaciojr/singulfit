import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BillingModule } from '../billing/billing.module';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import {
  SubscriptionsAdminController,
  SubscriptionsController,
} from './subscriptions.controller';
import { SubscriptionsModule } from './subscriptions.module';

@Module({
  imports: [AuthModule, AutomationModule, BillingModule, SubscriptionsModule],
  controllers: [SubscriptionsController, SubscriptionsAdminController],
  providers: [SubscriptionLifecycleService],
  exports: [SubscriptionLifecycleService],
})
export class SubscriptionLifecycleModule {}
