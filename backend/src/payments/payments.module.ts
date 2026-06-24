import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PagBankModule } from '../pagbank/pagbank.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PixPaymentsService } from './pix-payments.service';
import { CreditCardPaymentsService } from './credit-card-payments.service';

@Module({
  imports: [AuthModule, BillingModule, PagBankModule],
  providers: [PaymentsService, PixPaymentsService, CreditCardPaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService, PixPaymentsService, CreditCardPaymentsService],
})
export class PaymentsModule {}
