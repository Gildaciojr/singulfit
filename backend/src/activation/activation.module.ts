import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ActivationAdminController } from './activation-admin.controller';
import { ActivationJourneyService } from './activation-journey.service';
import { ActivationMetricsService } from './activation-metrics.service';
import { ActivationScoreService } from './activation-score.service';
import { ActivationService } from './activation.service';

@Module({
  imports: [AuthModule, EvolutionModule, WhatsAppModule],
  controllers: [ActivationAdminController],
  providers: [
    ActivationService,
    ActivationJourneyService,
    ActivationMetricsService,
    ActivationScoreService,
  ],
  exports: [
    ActivationService,
    ActivationJourneyService,
    ActivationMetricsService,
  ],
})
export class ActivationModule {}
