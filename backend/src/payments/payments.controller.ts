import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CreateCreditCardPaymentDto } from './dto/create-credit-card-payment.dto';
import { CreatePixPaymentDto } from './dto/create-pix-payment.dto';
import { CreditCardPublicKeyResponseDto } from './dto/credit-card-public-key-response.dto';
import { CreditCardPaymentResponseDto } from './dto/credit-card-payment-response.dto';
import { PixPaymentResponseDto } from './dto/pix-payment-response.dto';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import { PixPaymentsService } from './pix-payments.service';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly pixPaymentsService: PixPaymentsService,
    private readonly creditCardPaymentsService: CreditCardPaymentsService,
  ) {}

  @Post('pix')
  createPix(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body() body: CreatePixPaymentDto,
  ): Promise<PixPaymentResponseDto> {
    return this.pixPaymentsService.create(authenticatedUser.userId, body);
  }

  @Post('credit-card')
  createCreditCard(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body() body: CreateCreditCardPaymentDto,
  ): Promise<CreditCardPaymentResponseDto> {
    return this.creditCardPaymentsService.create(
      authenticatedUser.userId,
      body,
    );
  }

  @Get('credit-card/public-key')
  getCreditCardPublicKey(): CreditCardPublicKeyResponseDto {
    return {
      publicKey: this.creditCardPaymentsService.getPublicKey(),
    };
  }
}
