import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AIUsageService } from './ai-usage.service';
import { AIService } from './ai.service';
import { OpenAIGateway } from './openai.gateway';
import { PromptService } from './prompt.service';
import { AIRecoveryService } from './ai-recovery.service';
import { ConversationAIService } from './conversation-ai.service';

@Module({
  imports: [ConfigModule, EntitlementsModule],
  providers: [
    OpenAIGateway,
    AIService,
    PromptService,
    AIUsageService,
    AIRecoveryService,
    ConversationAIService,
  ],
  exports: [
    OpenAIGateway,
    ConversationAIService,
    AIService,
    PromptService,
    AIUsageService,
    AIRecoveryService,
  ],
})
export class AIModule {}
