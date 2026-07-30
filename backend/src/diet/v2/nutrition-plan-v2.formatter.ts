import { Injectable } from '@nestjs/common';
import type { NutritionPlanV2 } from './nutrition-plan-v2.contract';

@Injectable()
export class NutritionPlanV2Formatter {
  format(plan: NutritionPlanV2): string {
    const sections: string[] = [plan.title, plan.objectiveSummary];
    if (plan.guidance.length > 0) sections.push(plan.guidance.join(' '));
    for (const day of plan.days) {
      const meals = day.meals.map((meal) => {
        const items = meal.items
          .map((item) => `${item.quantity} de ${item.foodName}`)
          .join(', ');
        const time = meal.suggestedTime ? ` (${meal.suggestedTime})` : '';
        return `${meal.name}${time}: ${items}.`;
      });
      sections.push(`${day.label}\n${meals.join('\n')}`);
    }
    if (plan.hydrationGuidance.length > 0) {
      sections.push(plan.hydrationGuidance.join(' '));
    }
    if (plan.safetyNotes.length > 0) sections.push(plan.safetyNotes.join(' '));
    return sections
      .filter((section) => section.trim())
      .join('\n\n')
      .trim();
  }
}
