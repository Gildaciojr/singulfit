import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';
import { AudioConversationService } from './audio-conversation.service';
import { AudioTranscriptionGateway } from './audio-transcription.gateway';

@Module({
  imports: [ConfigModule, AIModule, StorageModule],
  providers: [AudioConversationService, AudioTranscriptionGateway],
  exports: [AudioConversationService],
})
export class AudioModule {}
