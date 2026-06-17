import {
  Currency,
  PaymentMethod,
  PaymentProvider,
  Prisma,
} from '@prisma/client';
import {
  IsDecimal,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsDecimal({
    decimal_digits: '0,2',
    force_decimal: false,
  })
  amount!: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Prisma.InputJsonObject;
}
