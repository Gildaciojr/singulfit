import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRecurringCreditCardSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  subscriptionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  planId!: string;

  @IsInt()
  @IsIn([1, 3, 6, 12])
  billingCycles!: 1 | 3 | 6 | 12;

  @IsString()
  @MinLength(64)
  @MaxLength(4096)
  encryptedCard!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  holderName!: string;

  @IsString()
  @Matches(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/)
  holderCpf!: string;
}
