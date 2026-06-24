import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCreditCardPaymentDto {
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

  @IsInt()
  @Min(1)
  @Max(1)
  installments!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
