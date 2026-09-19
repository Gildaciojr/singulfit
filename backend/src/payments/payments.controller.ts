import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { PagBankRecurringProvisioningService } from '../pagbank/pagbank-recurring-provisioning.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditCardPaymentDto } from './dto/create-credit-card-payment.dto';
import { CreatePixPaymentDto } from './dto/create-pix-payment.dto';
import { CreateRecurringCreditCardSubscriptionDto } from './dto/create-recurring-credit-card-subscription.dto';
import { CreditCardPublicKeyResponseDto } from './dto/credit-card-public-key-response.dto';
import { CreditCardPaymentResponseDto } from './dto/credit-card-payment-response.dto';
import { PixPaymentResponseDto } from './dto/pix-payment-response.dto';
import { RecurringCreditCardSubscriptionResponseDto } from './dto/recurring-credit-card-subscription-response.dto';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import { PixPaymentsService } from './pix-payments.service';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly pixPaymentsService: PixPaymentsService,
    private readonly creditCardPaymentsService: CreditCardPaymentsService,
    private readonly recurringProvisioning: PagBankRecurringProvisioningService,
    private readonly prisma: PrismaService,
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

  @Post('recurring/credit-card')
  async createRecurringCreditCard(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body() body: CreateRecurringCreditCardSubscriptionDto,
  ): Promise<RecurringCreditCardSubscriptionResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedUser.userId },
      select: { email: true, phone: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!user.email) {
      throw new BadRequestException(
        'E-mail é obrigatório para assinatura recorrente',
      );
    }

    const phone = this.toPagBankPhone(user.phone);
    const subscription = await this.recurringProvisioning.createSubscription({
      subscriptionId: body.subscriptionId,
      userId: authenticatedUser.userId,
      planId: body.planId,
      billingCycles: body.billingCycles,
      card: {
        name: body.holderName.trim(),
        email: user.email,
        taxId: body.holderCpf.replace(/\D/g, ''),
        phone,
        encryptedCard: body.encryptedCard,
      },
    });

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      provider: subscription.provider,
      externalSubscriptionId: subscription.externalSubscriptionId,
      billingCycles: subscription.billingCycles,
    };
  }

  @Get('credit-card/public-key')
  getCreditCardPublicKey(): CreditCardPublicKeyResponseDto {
    return {
      publicKey: this.creditCardPaymentsService.getPublicKey(),
    };
  }

  private toPagBankPhone(phone: string) {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12)
      digits = digits.slice(2);
    if (digits.length !== 10 && digits.length !== 11) {
      throw new BadRequestException('Telefone brasileiro válido é obrigatório');
    }
    return {
      country: '55',
      area: digits.slice(0, 2),
      number: digits.slice(2),
      type: 'MOBILE' as const,
    };
  }
}
