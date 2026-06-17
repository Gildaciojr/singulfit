import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DietGeneratorService } from './diet-generator.service';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule],
  controllers: [DietController],
  providers: [DietService, DietGeneratorService],
  exports: [DietService, DietGeneratorService],
})
export class DietModule {}
