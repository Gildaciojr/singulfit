import { Injectable } from '@nestjs/common';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CanonicalNutritionPlanPresenterService } from '../../diet/canonical-nutrition-plan-presenter.service';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';

export type ConversationCurrentNutritionContext =
  | Readonly<{ status: 'ABSENT' | 'UNAVAILABLE'; plan: null }>
  | Readonly<{ status: 'AVAILABLE'; plan: PublicNutritionResponse }>;

@Injectable()
export class ConversationCurrentNutritionContextService {
  constructor(
    private readonly reader: CurrentNutritionPlanReaderService,
    private readonly presenter: CanonicalNutritionPlanPresenterService,
  ) {}

  async read(userId: string): Promise<ConversationCurrentNutritionContext> {
    try {
      const current = await this.reader.getCurrent(userId);
      if (!current) return Object.freeze({ status: 'ABSENT', plan: null });
      return Object.freeze({
        status: 'AVAILABLE',
        plan: this.presenter.toPublic(current),
      });
    } catch {
      return Object.freeze({ status: 'UNAVAILABLE', plan: null });
    }
  }
}
