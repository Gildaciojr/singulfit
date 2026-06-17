import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CheckInService } from './check-in.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule],
  controllers: [ProgressController],
  providers: [ProgressService, CheckInService, SnapshotService],
  exports: [SnapshotService],
})
export class ProgressModule {}
