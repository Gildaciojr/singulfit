import { IsEnum } from 'class-validator';

export enum CancelSubscriptionMode {
  IMMEDIATE = 'IMMEDIATE',
  AT_PERIOD_END = 'AT_PERIOD_END',
}

export class CancelSubscriptionDto {
  @IsEnum(CancelSubscriptionMode)
  mode!: CancelSubscriptionMode;
}
