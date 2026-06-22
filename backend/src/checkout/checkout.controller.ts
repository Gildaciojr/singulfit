import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CheckoutService } from './checkout.service';
import { CheckoutStatusResponseDto } from './dto/checkout-status-response.dto';

@Controller('api/v1/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Get('status')
  status(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
  ): Promise<CheckoutStatusResponseDto> {
    return this.checkoutService.getStatus(authenticatedUser.userId);
  }
}
