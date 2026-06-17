import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { InvoicesService } from './invoices.service';

@Module({
  providers: [BillingService, InvoicesService],
  exports: [BillingService, InvoicesService],
})
export class BillingModule {}
