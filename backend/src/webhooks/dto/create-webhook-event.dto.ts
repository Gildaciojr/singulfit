import { PaymentProvider, Prisma, WebhookResourceType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWebhookEventDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  eventKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerEventId?: string;

  @IsOptional()
  @IsEnum(WebhookResourceType)
  resourceType?: WebhookResourceType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  resourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  requestId?: string;

  @IsOptional()
  @IsBoolean()
  liveMode?: boolean;

  @IsOptional()
  @IsBoolean()
  signatureValid?: boolean;

  @IsObject()
  payload!: Prisma.InputJsonObject;
}
