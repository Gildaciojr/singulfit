import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LongitudinalAdminController } from './longitudinal-admin.controller';
import { LongitudinalAdminService } from './longitudinal-admin.service';
import { LongitudinalCalculatorService } from './longitudinal-calculator.service';
import { LongitudinalService } from './longitudinal.service';

@Module({
  imports: [AuthModule],
  controllers: [LongitudinalAdminController],
  providers: [
    LongitudinalCalculatorService,
    LongitudinalService,
    LongitudinalAdminService,
  ],
  exports: [LongitudinalCalculatorService, LongitudinalService],
})
export class LongitudinalModule {}
