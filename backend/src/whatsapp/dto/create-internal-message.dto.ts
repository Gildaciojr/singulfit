import { MessageDirection, MessageType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInternalMessageDto {
  @IsUUID()
  userId!: string;

  @IsEnum(MessageDirection)
  direction!: MessageDirection;

  @IsEnum(MessageType)
  type!: MessageType;

  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  externalMessageId?: string;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @IsOptional()
  @IsDateString()
  readAt?: string;
}
