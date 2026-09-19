import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PagBankModule } from '../pagbank/pagbank.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PixPaymentsService } from './pix-payments.service';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PagBankRecurringReconciliationService } from './pagbank-recurring-reconciliation.service';
import { PixRenewalService } from './pix-renewal.service';
import { PixRenewalIntentService } from './pix-renewal-intent.service';

@Module({
  imports: [AuthModule, BillingModule, PagBankModule, SubscriptionsModule],
  providers: [
    PaymentsService,
    PixPaymentsService,
    CreditCardPaymentsService,
    PaymentSettlementService,
    PagBankRecurringReconciliationService,
    PixRenewalService,
    PixRenewalIntentService,
  ],
  controllers: [PaymentsController],
  exports: [
    PaymentsService,
    PixPaymentsService,
    CreditCardPaymentsService,
    PaymentSettlementService,
    PagBankRecurringReconciliationService,
    PixRenewalService,
    PixRenewalIntentService,
  ],
})
export class PaymentsModule {}
