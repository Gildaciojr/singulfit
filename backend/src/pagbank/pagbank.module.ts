import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PAGBANK_PAYMENT_GATEWAY } from '../payments/gateways/payment-gateway.constants';
import { PagBankGateway } from './pagbank.gateway';
import { PagBankRecurringGateway } from './pagbank-recurring.gateway';
import { PagBankRecurringProvisioningService } from './pagbank-recurring-provisioning.service';

@Module({
  imports: [ConfigModule],
  providers: [
    PagBankGateway,
    PagBankRecurringGateway,
    PagBankRecurringProvisioningService,
    {
      provide: PAGBANK_PAYMENT_GATEWAY,
      useExisting: PagBankGateway,
    },
  ],
  exports: [
    PAGBANK_PAYMENT_GATEWAY,
    PagBankRecurringGateway,
    PagBankRecurringProvisioningService,
  ],
})
export class PagBankModule {}
