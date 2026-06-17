import { OutboxStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ListOutboxEventsDto {
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,99}$/)
  eventType?: string;

  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,99}$/)
  aggregateType?: string;

  @IsOptional()
  @IsEnum(OutboxStatus)
  status?: OutboxStatus;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
