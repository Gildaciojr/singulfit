import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PagBankModule } from '../pagbank/pagbank.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PixPaymentsService } from './pix-payments.service';

@Module({
  imports: [AuthModule, BillingModule, PagBankModule],
  providers: [PaymentsService, PixPaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService, PixPaymentsService],
})
export class PaymentsModule {}
