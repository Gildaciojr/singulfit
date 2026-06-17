import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AIQualityAdminController } from './ai-quality-admin.controller';
import { AIQualityAdminService } from './ai-quality-admin.service';
import { AIQualityScoringService } from './ai-quality-scoring.service';
import { AIResponseEvaluationService } from './ai-response-evaluation.service';
import { AISafetyClassifierService } from './ai-safety-classifier.service';
import { SafeResponseFallbackService } from './safe-response-fallback.service';

@Module({
  imports: [AuthModule],
  controllers: [AIQualityAdminController],
  providers: [
    AISafetyClassifierService,
    AIQualityScoringService,
    SafeResponseFallbackService,
    AIResponseEvaluationService,
    AIQualityAdminService,
  ],
  exports: [
    AISafetyClassifierService,
    AIQualityScoringService,
    SafeResponseFallbackService,
    AIResponseEvaluationService,
  ],
})
export class AIQualityModule {}
