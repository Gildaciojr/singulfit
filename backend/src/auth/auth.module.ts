import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { JwtTokenService } from './services/jwt-token.service';
import { AuthSessionsService } from './services/auth-sessions.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [forwardRef(() => UsersModule), SubscriptionsModule],
  providers: [
    AuthService,
    JwtTokenService,
    AuthSessionsService,
    JwtAuthGuard,
    RolesGuard,
  ],
  controllers: [AuthController],
  exports: [JwtTokenService, AuthSessionsService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
