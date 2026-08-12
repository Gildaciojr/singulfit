import { BadRequestException, Injectable } from '@nestjs/common';
import { NutritionPlanV2Formatter } from '../nutrition-plan-v2.formatter';
import type {
  FormattableNutritionExecutionResultV2,
  NutritionExecutionResultV2,
} from './nutrition-application-execution.contract';

@Injectable()
export class NutritionPublicResultFormatter {
  constructor(private readonly planFormatter: NutritionPlanV2Formatter) {}

  format(
    result: NutritionExecutionResultV2,
    context?: { readonly userDisplayName?: string },
  ): string {
    if (!this.isFormattable(result)) {
      throw new BadRequestException(
        'Apresentação do plano nutricional V2 ainda não possui documento público',
      );
    }

    const content =
      result.kind === 'PLAN'
        ? this.planFormatter.format(result.document, context)
        : this.formatConversational(result);

    if (!content.trim()) {
      throw new BadRequestException(
        'Resultado público da Nutrition V2 não possui conteúdo',
      );
    }

    return content.trim();
  }

  private formatConversational(
    result: Extract<
      FormattableNutritionExecutionResultV2,
      { readonly kind: 'CONVERSATIONAL_ARTIFACT' }
    >,
  ): string {
    const artifact = result.document;

    if (artifact.artifactType === 'POINT_GUIDANCE') {
      return this.sections([
        artifact.title,
        artifact.summary,
        artifact.guidance.answer,
        this.list('Por que isso ajuda:', artifact.guidance.rationale),
        this.list('Próximos passos:', artifact.guidance.actionableSteps),
        this.list('Atenção:', artifact.guidance.cautions),
      ]);
    }

    if (artifact.artifactType === 'MEAL_SUGGESTION') {
      const items = artifact.meal.items.map((item) => {
        const amount =
          item.quantity === null
            ? ''
            : ` — ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
        const preparation = item.preparationNotes
          ? ` (${item.preparationNotes})`
          : '';
        return `${item.name}${amount}${preparation}`;
      });

      return this.sections([
        artifact.title,
        artifact.summary,
        `${artifact.meal.name}: ${artifact.meal.description}`,
        this.list('Itens:', items),
        this.list('Alternativas:', artifact.meal.alternatives),
      ]);
    }

    return this.sections([
      artifact.title,
      artifact.summary,
      artifact.review.overallAssessment,
      this.list('Pontos positivos:', artifact.review.strengths),
      this.list('Pontos de atenção:', artifact.review.concerns),
      this.list('Recomendações:', artifact.review.recommendations),
    ]);
  }

  private isFormattable(
    result: NutritionExecutionResultV2,
  ): result is FormattableNutritionExecutionResultV2 {
    return result.kind !== 'CURRENT_PLAN_PRESENTATION';
  }

  private list(title: string, values: readonly string[]): string {
    return values.length > 0
      ? `${title}\n${values.map((value) => `• ${value}`).join('\n')}`
      : '';
  }

  private sections(values: readonly string[]): string {
    return values
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n\n');
  }
}
