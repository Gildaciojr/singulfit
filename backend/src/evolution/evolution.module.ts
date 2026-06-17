import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../storage/storage.module';
import { EvolutionController } from './evolution.controller';
import { EvolutionGateway } from './evolution.gateway';
import { EvolutionWebhookService } from './evolution-webhook.service';
import { EvolutionSendService } from './evolution-send.service';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    SubscriptionsModule,
    WhatsAppModule,
    StorageModule,
  ],
  controllers: [EvolutionController],
  providers: [EvolutionGateway, EvolutionWebhookService, EvolutionSendService],
  exports: [EvolutionGateway, EvolutionWebhookService, EvolutionSendService],
})
export class EvolutionModule {}
