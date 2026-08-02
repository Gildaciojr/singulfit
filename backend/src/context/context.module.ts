import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ContextAdminController } from './context-admin.controller';
import { ContextEventHandlerService } from './context-event-handler.service';
import { ContextSnapshotService } from './context-snapshot.service';
import { ContextService } from './context.service';
import { MemoryService } from './memory.service';
import { CoachProfileSnapshotBuilder } from './coach-profile-snapshot.builder';
import { CoachConversationHumanContextBuilder } from './coach-conversation-human-context.builder';
import { CoachAdaptiveProfileCollectorService } from './coach-adaptive-profile-collector.service';
import { ConversationGoalPlannerService } from './conversation-goal-planner.service';
import { CoachProfileAcquisitionProjectionService } from './profile-acquisition/coach-profile-acquisition-projection.service';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from './profile-acquisition/coach-profile-mutation.service';
import { CoachProfileFieldRegistryService } from './profile-acquisition/coach-profile-field-registry.service';
import { ProfileAcquisitionCycleService } from './profile-acquisition/profile-acquisition-cycle.service';
import { ProfileAnswerRecognizerService } from './profile-acquisition/profile-answer-recognizer.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition/profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalEligibilityService } from './profile-acquisition/profile-acquisition-internal-eligibility.service';
import { ProfileAcquisitionInternalRolloutService } from './profile-acquisition/profile-acquisition-internal-rollout.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition/profile-acquisition-runtime.service';
import {
  ProfileQuestionRealizerService,
  ProfileQuestionSpecificationService,
} from './profile-acquisition/profile-question.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    AuthModule,
    EventBusModule,
    ObservabilityModule,
    SubscriptionsModule,
  ],
  controllers: [ContextAdminController],
  providers: [
    ContextService,
    MemoryService,
    ContextSnapshotService,
    ContextEventHandlerService,
    CoachProfileSnapshotBuilder,
    CoachConversationHumanContextBuilder,
    CoachAdaptiveProfileCollectorService,
    ConversationGoalPlannerService,
    CoachProfileFieldRegistryService,
    ProfileQuestionSpecificationService,
    ProfileQuestionRealizerService,
    ProfileAnswerRecognizerService,
    CoachProfileMutationCommandFactoryService,
    CoachProfileMutationService,
    ProfileAcquisitionCycleService,
    CoachProfileAcquisitionProjectionService,
    ProfileAcquisitionOperationalConfigService,
    ProfileAcquisitionInternalEligibilityService,
    ProfileAcquisitionRuntimeService,
    ProfileAcquisitionInternalRolloutService,
  ],
  exports: [
    ContextService,
    MemoryService,
    ContextSnapshotService,
    CoachProfileSnapshotBuilder,
    CoachConversationHumanContextBuilder,
    CoachAdaptiveProfileCollectorService,
    ConversationGoalPlannerService,
    CoachProfileFieldRegistryService,
    ProfileQuestionSpecificationService,
    ProfileQuestionRealizerService,
    ProfileAnswerRecognizerService,
    CoachProfileMutationCommandFactoryService,
    CoachProfileMutationService,
    ProfileAcquisitionCycleService,
    ProfileAcquisitionOperationalConfigService,
    ProfileAcquisitionInternalRolloutService,
  ],
})
export class ContextModule {}
