import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CreatePixPaymentDto } from './dto/create-pix-payment.dto';
import { PixPaymentResponseDto } from './dto/pix-payment-response.dto';
import { PixPaymentsService } from './pix-payments.service';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly pixPaymentsService: PixPaymentsService) {}

  @Post('pix')
  createPix(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body() body: CreatePixPaymentDto,
  ): Promise<PixPaymentResponseDto> {
    return this.pixPaymentsService.create(authenticatedUser.userId, body);
  }
}
