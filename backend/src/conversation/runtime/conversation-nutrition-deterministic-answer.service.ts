import { Injectable } from '@nestjs/common';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import { NutritionWhatsAppPresenter } from '../../diet/v2/presentation/nutrition-whatsapp.presenter';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationAnswerCandidate } from './conversation-qa.contract';
import type { ConversationCurrentNutritionContext } from './conversation-current-nutrition-context.service';

export interface DeterministicNutritionAnswer {
  readonly content: string;
  readonly candidate: ConversationAnswerCandidate;
}

@Injectable()
export class ConversationNutritionDeterministicAnswerService {
  private readonly presenter = new NutritionWhatsAppPresenter();

  answer(input: {
    readonly request: string;
    readonly route: ConversationExecutionRoute;
    readonly current: ConversationCurrentNutritionContext;
  }): DeterministicNutritionAnswer | null {
    const request = this.normalize(input.request);
    if (!this.nutritionRequest(input.route, request)) return null;
    const planRequest = this.referencesPlan(input.route, request);
    if (input.current.status !== 'AVAILABLE') {
      if (!planRequest) return null;
      return this.result(
        input.current.status === 'ABSENT'
          ? 'Você ainda não possui um plano alimentar ativo.'
          : 'Não consegui consultar seu plano alimentar com segurança agora. Tente novamente em instantes.',
      );
    }
    const plan = input.current.plan;
    if (input.route.kind === 'PLAN_STATUS') {
      return this.result(`Seu plano alimentar ativo é *${plan.title}*.`);
    }
    if (input.route.kind === 'CURRENT_PLAN_PRESENTATION') {
      return this.result(this.presenter.present(plan));
    }
    if (this.planMutation(request)) return null;
    const content =
      this.substitution(request, plan) ??
      this.targets(request, plan) ??
      this.meal(request, plan) ??
      this.item(request, plan) ??
      (planRequest ? this.presenter.present(plan) : null);
    return content ? this.result(content) : null;
  }

  private substitution(
    request: string,
    plan: PublicNutritionResponse,
  ): string | null {
    if (!/(?:trocar|troque|substitu|nao tenho|sem )/u.test(request))
      return null;
    const item = this.referencedItem(request, plan);
    if (!item) return 'Qual alimento do seu plano você quer substituir?';
    const replacement = plan.substitutions.find(
      (candidate) =>
        this.sameFood(candidate.source, item.name) ||
        this.sameFood(candidate.alternative, item.name),
    );
    if (!replacement) {
      return `Encontrei *${item.name}* no seu plano, mas não há uma troca cadastrada para ele. Em qual refeição você quer fazer a substituição?`;
    }
    const alternative = this.sameFood(replacement.source, item.name)
      ? replacement.alternative
      : replacement.source;
    return `No seu plano, *${item.name}* pode ser trocado por *${alternative}*. Siga a porção indicada na refeição.`;
  }

  private targets(
    request: string,
    plan: PublicNutritionResponse,
  ): string | null {
    if (
      !/(?:calori|proteina|carboidr|gordura|macro|meta diaria)/u.test(request)
    )
      return null;
    const values: string[] = [];
    if (/(?:calori|meta diaria)/u.test(request) && plan.energyTargetKcal) {
      values.push(`${this.number(plan.energyTargetKcal)} kcal`);
    }
    if (/(?:proteina|macro|meta diaria)/u.test(request)) {
      this.macro(values, 'proteína', plan.macroTargets?.proteinGrams);
    }
    if (/(?:carboidr|macro|meta diaria)/u.test(request)) {
      this.macro(values, 'carboidratos', plan.macroTargets?.carbohydrateGrams);
    }
    if (/(?:gordura|macro|meta diaria)/u.test(request)) {
      this.macro(values, 'gorduras', plan.macroTargets?.fatGrams);
    }
    return values.length > 0
      ? `Sua meta diária no plano é ${values.join(', ')}.`
      : 'Seu plano atual não registra essa meta de forma explícita.';
  }

  private meal(request: string, plan: PublicNutritionResponse): string | null {
    const meals = plan.days.flatMap((day) => day.meals);
    const found = meals.find((candidate) => {
      const name = this.normalize(candidate.name);
      return (
        request.includes(name) ||
        this.aliases(name).some((alias) => request.includes(alias))
      );
    });
    if (found) return this.formatMeal(found);
    if (/(?:refeicao agora|comer agora|proxima refeicao)/u.test(request)) {
      const scheduled = meals.filter((candidate) => candidate.time);
      return scheduled.length > 0
        ? `As refeições com horário no seu plano são: ${scheduled.map((candidate) => `${candidate.name} às ${candidate.time}`).join(', ')}.`
        : 'Seu plano não registra horários. Qual refeição você quer consultar?';
    }
    return null;
  }

  private item(request: string, plan: PublicNutritionResponse): string | null {
    if (!/(?:quanto|quantidade|porcao|medida)/u.test(request)) return null;
    const item = this.referencedItem(request, plan);
    return item
      ? `No seu plano, a porção de *${item.name}* é *${item.quantity}*.`
      : 'Não encontrei esse alimento no seu plano atual. Qual alimento e refeição você quer consultar?';
  }

  private referencedItem(request: string, plan: PublicNutritionResponse) {
    return (
      plan.days
        .flatMap((day) => day.meals.flatMap((meal) => meal.items))
        .find((item) => {
          const name = this.normalize(item.name);
          if (request.includes(name)) return true;
          return name
            .split(' ')
            .filter((token) => token.length >= 4 && !this.genericToken(token))
            .some((token) => request.includes(token));
        }) ?? null
    );
  }

  private formatMeal(
    meal: PublicNutritionResponse['days'][number]['meals'][number],
  ): string {
    const title = meal.time
      ? `*${meal.name}* (${meal.time})`
      : `*${meal.name}*`;
    const items = meal.items
      .map((item) => `${item.quantity} de ${item.name}`)
      .join(', ');
    return items
      ? `${title}: ${items}.`
      : `${title} não possui itens registrados.`;
  }

  private referencesPlan(
    route: ConversationExecutionRoute,
    request: string,
  ): boolean {
    return (
      route.kind === 'CURRENT_PLAN_PRESENTATION' ||
      route.kind === 'PLAN_STATUS' ||
      /(?:meu plano|minha dieta|plano atual|dieta atual|refeicao|cafe da manha|almoco|jantar|quanto|porcao|trocar|substitu|nao tenho)/u.test(
        request,
      )
    );
  }

  private planMutation(request: string): boolean {
    return /(?:adaptar|adapte|reduzir|reduza|aumentar|aumente|quero mais|quero menos|mudar meu plano|mude meu plano)/u.test(
      request,
    );
  }

  private nutritionRequest(
    route: ConversationExecutionRoute,
    request: string,
  ): boolean {
    if (
      (route.kind === 'CURRENT_PLAN_PRESENTATION' ||
        route.kind === 'PLAN_STATUS') &&
      route.targetPlan === 'DIET'
    )
      return true;
    return (
      route.kind === 'NUTRITION_GUIDANCE' ||
      /(?:dieta|plano alimentar|refeicao|comida|alimento|calori|proteina|carboidr|gordura|cafe da manha|almoco|jantar)/u.test(
        request,
      )
    );
  }

  private aliases(name: string): readonly string[] {
    if (name.includes('cafe')) return ['cafe da manha', 'desjejum'];
    if (name.includes('almoco')) return ['almoco'];
    if (name.includes('jantar')) return ['jantar'];
    if (name.includes('ceia')) return ['ceia'];
    if (name.includes('lanche')) return ['lanche'];
    return Object.freeze([]);
  }

  private sameFood(left: string, right: string): boolean {
    const a = this.normalize(left);
    const b = this.normalize(right);
    return a === b || a.includes(b) || b.includes(a);
  }

  private macro(values: string[], label: string, value?: number): void {
    if (value) values.push(`${this.number(value)} g de ${label}`);
  }

  private number(value: number): string {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(
      value,
    );
  }

  private genericToken(value: string): boolean {
    return new Set([
      'cozido',
      'cozida',
      'grelhado',
      'grelhada',
      'integral',
    ]).has(value);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9\s]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private result(content: string): DeterministicNutritionAnswer {
    return Object.freeze({
      content,
      candidate: Object.freeze({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: content,
        followUpQuestion: null,
        grounding: 'CURRENT_PLAN',
        confidence: 'HIGH',
      }),
    });
  }
}
