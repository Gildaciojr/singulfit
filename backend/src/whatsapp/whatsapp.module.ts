import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  imports: [AuthModule],
  providers: [ConversationsService, MessagesService],
  controllers: [WhatsAppController],
  exports: [ConversationsService, MessagesService],
})
export class WhatsAppModule {}
