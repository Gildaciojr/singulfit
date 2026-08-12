import { Injectable } from '@nestjs/common';
import type { NutritionPlanV2 } from './nutrition-plan-v2.contract';
import { NutritionWhatsAppPresenter } from './presentation/nutrition-whatsapp.presenter';
import { PublicNutritionResponseBuilder } from './presentation/public-nutrition-response.builder';

export interface NutritionPlanV2FormattingContext {
  readonly userDisplayName?: string;
}

@Injectable()
export class NutritionPlanV2Formatter {
  private readonly builder = new PublicNutritionResponseBuilder();
  private readonly presenter = new NutritionWhatsAppPresenter();

  format(
    plan: NutritionPlanV2,
    context?: NutritionPlanV2FormattingContext,
  ): string {
    return this.presenter.present(
      this.builder.build({
        plan,
        userDisplayName: context?.userDisplayName,
      }),
    );
  }
}
