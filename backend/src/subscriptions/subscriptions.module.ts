import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessService } from './subscription-access.service';

@Module({
  providers: [SubscriptionsService, SubscriptionAccessService],
  exports: [SubscriptionsService, SubscriptionAccessService],
})
export class SubscriptionsModule {}
