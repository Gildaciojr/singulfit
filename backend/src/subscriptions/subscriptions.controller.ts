import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('api/v1/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post('cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancelForUser(user.userId, input.mode);
  }
}

@Controller('api/v1/admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SubscriptionsAdminController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post(':subscriptionId/cancel')
  cancel(
    @Param('subscriptionId') subscriptionId: string,
    @Body() input: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancelSubscription(subscriptionId, input.mode);
  }
}
