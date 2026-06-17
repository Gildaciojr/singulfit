import { Module } from '@nestjs/common';
import { UsageService } from '../usage/usage.service';
import { EntitlementsService } from './entitlements.service';
import { ReservationService } from './reservation.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  providers: [EntitlementsService, ReservationService, UsageService],
  exports: [EntitlementsService, ReservationService, UsageService],
})
export class EntitlementsModule {}
