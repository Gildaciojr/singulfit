import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BehaviorAdminController } from './behavior-admin.controller';
import { BehavioralEngineService } from './behavioral-engine.service';
import { BehavioralIntelligenceService } from './behavioral-intelligence.service';

@Module({
  imports: [AuthModule],
  controllers: [BehaviorAdminController],
  providers: [BehavioralEngineService, BehavioralIntelligenceService],
  exports: [BehavioralEngineService, BehavioralIntelligenceService],
})
export class BehaviorModule {}
