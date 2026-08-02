import { Module } from '@nestjs/common';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { CoachProfileSnapshotConversationAdapter } from './adapters/coach-profile-snapshot.adapter';
import { ConversationGoalDecisionAdapter } from './adapters/conversation-goal-decision.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from './adapters/profile-acquisition-decision.adapter';
import { ConversationUnderstandingToGoalPlannerAdapter } from './adapters/conversation-understanding-to-goal-planner.adapter';
import { ConversationExecutionRouterService } from './routing/conversation-execution-router.service';
import { ConversationRoutingDecisionService } from './routing/conversation-routing-decision.service';
import { ConversationGoalPreparationService } from './understanding/conversation-goal-preparation.service';
import { ConversationUnderstandingService } from './understanding/conversation-understanding.service';
import { ConversationUnderstandingEngineService } from './understanding/conversation-understanding-engine.service';
import { ConversationMessageNormalizerService } from './understanding/conversation-message-normalizer.service';
import { ConversationTokenizerService } from './understanding/conversation-tokenizer.service';
import { ConversationReferenceResolverService } from './understanding/conversation-reference-resolver.service';
import { ConversationEntityRecognizerService } from './understanding/conversation-entity-recognizer.service';
import { ConversationOperationResolverService } from './understanding/conversation-operation-resolver.service';
import { ConversationDomainResolverService } from './understanding/conversation-domain-resolver.service';
import { ConversationIntentResolverService } from './understanding/conversation-intent-resolver.service';
import { ConversationAmbiguityResolverService } from './understanding/conversation-ambiguity-resolver.service';
import { ConversationSafetyDetectorService } from './understanding/conversation-safety-detector.service';
import { ConversationUnderstandingValidator } from './validators/conversation-understanding.validator';

@Module({
  providers: [
    ConversationGoalPlannerService,
    CoachProfileSnapshotConversationAdapter,
    ConversationGoalDecisionAdapter,
    ProfileAcquisitionDecisionConversationAdapter,
    ConversationUnderstandingToGoalPlannerAdapter,
    ConversationGoalPreparationService,
    ConversationExecutionRouterService,
    ConversationRoutingDecisionService,
    ConversationMessageNormalizerService,
    ConversationTokenizerService,
    ConversationReferenceResolverService,
    ConversationEntityRecognizerService,
    ConversationOperationResolverService,
    ConversationDomainResolverService,
    ConversationIntentResolverService,
    ConversationAmbiguityResolverService,
    ConversationSafetyDetectorService,
    ConversationUnderstandingEngineService,
    ConversationUnderstandingService,
    ConversationUnderstandingValidator,
  ],
  exports: [
    CoachProfileSnapshotConversationAdapter,
    ConversationGoalDecisionAdapter,
    ProfileAcquisitionDecisionConversationAdapter,
    ConversationUnderstandingToGoalPlannerAdapter,
    ConversationGoalPreparationService,
    ConversationExecutionRouterService,
    ConversationRoutingDecisionService,
    ConversationUnderstandingEngineService,
    ConversationUnderstandingService,
    ConversationUnderstandingValidator,
  ],
})
export class ConversationModule {}
