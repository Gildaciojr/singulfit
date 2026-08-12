import type { PublicNutritionResponse } from './public-nutrition-response.contract';

export class NutritionWhatsAppPresenter {
  present(response: PublicNutritionResponse): string {
    const sections: string[] = [
      `🥗 *${response.title}*`,
      response.userFirstName
        ? `${response.userFirstName}, preparei seu plano com uma organização simples para você consultar no dia a dia.`
        : 'Preparei seu plano com uma organização simples para você consultar no dia a dia.',
      response.summary,
    ];
    if (response.goal) {
      sections.push(`🎯 *Objetivo*\n${response.goal}`);
    }
    const target = this.dailyTarget(response);
    if (target) sections.push(target);
    sections.push(this.meals(response));
    if (response.substitutions.length > 0) {
      sections.push(
        `🔄 *Trocas possíveis*\n${response.substitutions
          .map(
            (substitution) =>
              `• ${substitution.source} ↔ ${substitution.alternative}`,
          )
          .join('\n')}`,
      );
    }
    this.optionalList(sections, '💧 *Hidratação*', response.hydrationGuidance);
    this.optionalList(
      sections,
      '📌 *Ajustes importantes*',
      response.adaptationGuidance,
    );
    this.optionalList(
      sections,
      '🛡️ *Cuidados importantes*',
      response.safetyGuidance,
    );
    sections.push(
      'Use este plano como guia e me conte como ele se encaixa na sua rotina.',
    );
    return sections
      .filter((section) => section.trim())
      .join('\n\n')
      .trim();
  }

  private dailyTarget(response: PublicNutritionResponse): string | undefined {
    const values: string[] = [];
    if (response.energyTargetKcal) {
      values.push(`≈ ${this.number(response.energyTargetKcal)} kcal`);
    }
    this.macro(values, 'Proteínas', response.macroTargets?.proteinGrams);
    this.macro(
      values,
      'Carboidratos',
      response.macroTargets?.carbohydrateGrams,
    );
    this.macro(values, 'Gorduras', response.macroTargets?.fatGrams);
    return values.length > 0
      ? `⚡ *Meta diária*\n${values.join('\n')}`
      : undefined;
  }

  private meals(response: PublicNutritionResponse): string {
    const days = response.days.map((day) => {
      const meals = day.meals.map((meal) => {
        const heading = meal.time
          ? `*${meal.time} — ${meal.name}*`
          : `*${meal.name}*`;
        const items = meal.items
          .map((item) => `• ${item.quantity} — ${item.name}`)
          .join('\n');
        return [heading, items].filter(Boolean).join('\n');
      });
      return day.label
        ? [`*${day.label}*`, ...meals].join('\n\n')
        : meals.join('\n\n');
    });
    return `🍽️ *Refeições*\n\n${days.join('\n\n')}`.trim();
  }

  private macro(
    values: string[],
    label: string,
    value: number | undefined,
  ): void {
    if (value) values.push(`• ${label}: ${this.number(value)} g`);
  }

  private optionalList(
    sections: string[],
    title: string,
    values: readonly string[],
  ): void {
    if (values.length > 0) {
      sections.push(
        `${title}\n${values.map((value) => `• ${value}`).join('\n')}`,
      );
    }
  }

  private number(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: 2,
    }).format(value);
  }
}
