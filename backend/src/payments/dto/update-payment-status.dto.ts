import { PaymentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  statusDetail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerPaymentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cardBrand?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  cardLastFour?: string;

  @IsOptional()
  @IsString()
  pixQrCode?: string;

  @IsOptional()
  @IsString()
  pixQrCodeBase64?: string;

  @IsOptional()
  @IsString()
  pixTicketUrl?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsDateString()
  approvedAt?: string;

  @IsOptional()
  @IsDateString()
  failedAt?: string;
}
