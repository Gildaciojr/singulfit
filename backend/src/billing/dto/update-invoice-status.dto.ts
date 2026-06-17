import { InvoiceStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  status!: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsDateString()
  voidedAt?: string;
}
