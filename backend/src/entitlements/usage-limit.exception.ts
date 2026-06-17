import { HttpStatus, HttpException } from '@nestjs/common';
import type { ImageAnalysisEntitlementCode } from './entitlement.constants';

export class UsageLimitExceededException extends HttpException {
  constructor(
    readonly entitlementCode: ImageAnalysisEntitlementCode,
    readonly limit: number,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'USAGE_LIMIT_EXCEEDED',
        entitlementCode,
        limit,
        message: UsageLimitExceededException.messageFor(entitlementCode),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  get friendlyMessage(): string {
    return UsageLimitExceededException.messageFor(this.entitlementCode);
  }

  private static messageFor(code: ImageAnalysisEntitlementCode): string {
    if (code === 'IMAGE_ANALYSIS_DAILY') {
      return 'Você atingiu o limite de análises de imagens de hoje. Seu limite será liberado novamente amanhã.';
    }

    return 'Você atingiu o limite mensal de análises de imagens. Novas análises estarão disponíveis no próximo mês.';
  }
}
