import { PlanType } from '@prisma/client';
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
    readonly cycle?: Readonly<{ planType: PlanType; periodEnd: Date }>,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'USAGE_LIMIT_EXCEEDED',
        entitlementCode,
        limit,
        message: UsageLimitExceededException.messageFor(
          entitlementCode,
          limit,
          firstName,
          cycle,
        ),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  get friendlyMessage(): string {
    return UsageLimitExceededException.messageFor(
      this.entitlementCode,
      this.limit,
      this.firstName,
      this.cycle,
    );
  }

  private static messageFor(
    code: UsageEntitlementCode,
    limit: number,
    firstName?: string,
    cycle?: Readonly<{ planType: PlanType; periodEnd: Date }>,
  ): string {
    if (cycle?.planType === PlanType.PREMIUM) {
      const resource =
        code === IMAGE_ANALYSIS
          ? 'análises por foto'
          : code === NUTRITION_PLAN_GENERATION
            ? 'gerações de planos alimentares'
            : code === WORKOUT_PLAN_GENERATION
              ? 'gerações de planos de treino'
              : 'transcrições de áudio';
      const renewal = cycle.periodEnd.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      return `Você utilizou as ${limit} ${resource} disponíveis neste ciclo. A renovação será em ${renewal}. Pode continuar conversando comigo por texto e consultando seus planos salvos normalmente. 💚`;
    }
    if (
      code === NUTRITION_PLAN_GENERATION ||
      code === WORKOUT_PLAN_GENERATION
    ) {
      return '💚 Você já utilizou as gerações de planos disponíveis neste ciclo.\n\nSeu plano atual continua salvo, e podemos consultá-lo e conversar sobre suas refeições e treinos normalmente.\n\nSe quiser criar novos planejamentos com mais frequência, o Premium oferece mais possibilidades. Quer conhecer as vantagens?';
    }
    if (code === IMAGE_ANALYSIS) {
      return '📸 Suas análises por foto deste ciclo chegaram ao limite!\n\nEnquanto ele não renova, você pode me contar por texto o que está comendo, e eu continuo te ajudando com sua alimentação.\n\nCom o Premium, você consegue analisar muito mais refeições por foto. 💚';
    }
    if (code === 'IMAGE_ANALYSIS_DAILY') {
      return 'Você atingiu o limite de análises de imagens de hoje. Seu limite será liberado novamente amanhã.';
    }

    return 'Você atingiu o limite mensal de análises de imagens. Novas análises estarão disponíveis no próximo mês.';
  }
}
