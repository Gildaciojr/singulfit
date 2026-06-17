import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PAGBANK_PAYMENT_GATEWAY } from '../payments/gateways/payment-gateway.constants';
import { PagBankGateway } from './pagbank.gateway';

@Module({
  imports: [ConfigModule],
  providers: [
    PagBankGateway,
    {
      provide: PAGBANK_PAYMENT_GATEWAY,
      useExisting: PagBankGateway,
    },
  ],
  exports: [PAGBANK_PAYMENT_GATEWAY],
})
export class PagBankModule {}
