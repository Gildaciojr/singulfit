import { Injectable } from '@nestjs/common';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { PublicNutritionResponseBuilder } from '../../diet/v2/presentation/public-nutrition-response.builder';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';

export type ConversationCurrentNutritionContext =
  | Readonly<{ status: 'ABSENT' | 'UNAVAILABLE'; plan: null }>
  | Readonly<{ status: 'AVAILABLE'; plan: PublicNutritionResponse }>;

@Injectable()
export class ConversationCurrentNutritionContextService {
  private readonly publicBuilder = new PublicNutritionResponseBuilder();

  constructor(private readonly reader: CurrentNutritionPlanReaderService) {}

  async read(userId: string): Promise<ConversationCurrentNutritionContext> {
    try {
      const current = await this.reader.getCurrent(userId);
      if (!current) return Object.freeze({ status: 'ABSENT', plan: null });
      if (current.implementation !== 'V2') {
        return Object.freeze({ status: 'UNAVAILABLE', plan: null });
      }
      return Object.freeze({
        status: 'AVAILABLE',
        plan: this.publicBuilder.build({ plan: current.document }),
      });
    } catch {
      return Object.freeze({ status: 'UNAVAILABLE', plan: null });
    }
  }
}
