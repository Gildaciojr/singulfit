import { HttpStatus, HttpException } from '@nestjs/common';
import {
  IMAGE_ANALYSIS,
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
  type CommercialUsageEntitlementCode,
  type ImageAnalysisEntitlementCode,
} from './entitlement.constants';

type UsageEntitlementCode =
  | CommercialUsageEntitlementCode
  | ImageAnalysisEntitlementCode;

export class UsageLimitExceededException extends HttpException {
  constructor(
    readonly entitlementCode: UsageEntitlementCode,
    readonly limit: number,
    readonly firstName?: string,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'USAGE_LIMIT_EXCEEDED',
        entitlementCode,
        limit,
        message: UsageLimitExceededException.messageFor(
          entitlementCode,
          firstName,
        ),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  get friendlyMessage(): string {
    return UsageLimitExceededException.messageFor(
      this.entitlementCode,
      this.firstName,
    );
  }

  private static messageFor(
    code: UsageEntitlementCode,
    firstName?: string,
  ): string {
    const greeting = firstName?.trim() ? `Olá, ${firstName.trim()}.` : 'Olá.';
    if (code === NUTRITION_PLAN_GENERATION) {
      return `${greeting} Você atingiu seu limite de geração de plano alimentar deste mês. No plano Premium você tem acesso ilimitado a tudo que eu posso te ajudar.`;
    }
    if (code === WORKOUT_PLAN_GENERATION) {
      return `${greeting} Você atingiu seu limite de geração de plano de treino deste mês. No plano Premium você tem acesso ilimitado a tudo que eu posso te ajudar.`;
    }
    if (code === IMAGE_ANALYSIS) {
      return `${greeting} Você atingiu seu limite de 5 análises de alimentos e bebidas deste mês. No plano Premium você tem acesso ilimitado a tudo que eu posso te ajudar.`;
    }
    if (code === 'IMAGE_ANALYSIS_DAILY') {
      return 'Você atingiu o limite de análises de imagens de hoje. Seu limite será liberado novamente amanhã.';
    }

    return 'Você atingiu o limite mensal de análises de imagens. Novas análises estarão disponíveis no próximo mês.';
  }
}
