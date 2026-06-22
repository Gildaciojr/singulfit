import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ConfigModule } from '@nestjs/config';
import { BillingModule } from './billing/billing.module';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { EvolutionModule } from './evolution/evolution.module';
import { AIModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { ResponseModule } from './responses/response.module';
import { ProfileModule } from './profile/profile.module';
import { WorkoutModule } from './workout/workout.module';
import { ProgressModule } from './progress/progress.module';
import { DietModule } from './diet/diet.module';
import { AutomationModule } from './automation/automation.module';
import { ObservabilityModule } from './observability/observability.module';
import { EventBusModule } from './event-bus/event-bus.module';
import { IntegrationEventsModule } from './event-bus/integration-events.module';
import { AdminModule } from './admin/admin.module';
import { ContextModule } from './context/context.module';
import { RecommendationModule } from './recommendations/recommendation.module';
import { validateEnvironment } from './production/environment.validation';
import { ProductionModule } from './production/production.module';
import { RUNTIME_MODE } from './production/runtime-mode';
import { ActivationModule } from './activation/activation.module';
import { LongitudinalModule } from './longitudinal/longitudinal.module';
import { PilotModule } from './pilot/pilot.module';
import { CheckoutModule } from './checkout/checkout.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment) =>
        validateEnvironment(environment, RUNTIME_MODE.API),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    ProductionModule,
    ObservabilityModule,
    EventBusModule,
    UsersModule,
    AuthModule,
    EntitlementsModule,
    SubscriptionsModule,
    BillingModule,
    PaymentsModule,
    WebhooksModule,
    WhatsAppModule,
    EvolutionModule,
    AIModule,
    StorageModule,
    NutritionModule,
    ResponseModule,
    ProfileModule,
    WorkoutModule,
    ProgressModule,
    DietModule,
    AutomationModule,
    ContextModule,
    RecommendationModule,
    ActivationModule,
    LongitudinalModule,
    PilotModule,
    CheckoutModule,
    IntegrationEventsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
