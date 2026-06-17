import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [EntitlementsModule],
  exports: [EntitlementsModule],
})
export class UsageModule {}
