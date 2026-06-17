import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePixPaymentDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
