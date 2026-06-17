import { Currency } from '@prisma/client';
import {
  IsDateString,
  IsDecimal,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID()
  subscriptionId!: string;

  @IsInt()
  @Min(1)
  cycleNumber!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsDecimal({
    decimal_digits: '0,2',
    force_decimal: false,
  })
  subtotal!: string;

  @IsOptional()
  @IsDecimal({
    decimal_digits: '0,2',
    force_decimal: false,
  })
  discount?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsDateString()
  dueAt!: string;
}
