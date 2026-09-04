import { Injectable } from '@nestjs/common';
import type { ConversationUnderstandingInput } from '../contracts/conversation-understanding.contract';
import type { ConversationReference } from '../contracts/conversation-entity.contract';
import type {
  ConversationReferenceResolution,
  NormalizedConversationMessage,
  TokenizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

type ReferenceDomain = 'NUTRITION' | 'WORKOUT' | 'BOTH';

@Injectable()
export class ConversationReferenceResolverService {
  resolve(
    input: ConversationUnderstandingInput,
    message: NormalizedConversationMessage,
    tokenized: TokenizedConversationMessage,
  ): ConversationReferenceResolution {
    const explicitDomain = this.explicitDomain(message.folded);
    const deictic = this.includesAny(message.folded, [
      'esse',
      'essa',
      'este',
      'esta',
      'aquele',
      'aquela',
      'isso',
      'aquilo',
      'mostre',
      'me mostra',
      'pode mostrar',
      'quero ver',
      'manda',
      'continue',
      'continua',
      'qual deles',
      'qual delas',
      'proxima',
      'proximo',
      'hoje',
      'amanha',
      'segunda',
      'terca',
      'quarta',
      'quinta',
      'sexta',
      'sabado',
      'domingo',
      'meu plano',
      'minha dieta',
      'meu treino',
    ]);
    const planMention =
      explicitDomain !== null ||
      tokenized.uniqueTokens.includes('plano') ||
      tokenized.uniqueTokens.includes('dieta') ||
      tokenized.uniqueTokens.includes('treino');
    const ordinal = this.ordinal(message.folded);
    const previous = this.includesAny(message.folded, [
      'ultimo',
      'ultima',
      'anterior',
      'passado',
      'passada',
    ]);
    let usedRecentHistory = false;
    let usedContinuity = false;
    let usedProfile = false;
    const quoted = input.replyToExternalMessageId
      ? input.recentHistory.find(
          (entry) => entry.externalMessageId === input.replyToExternalMessageId,
        )
      : undefined;
    let domain = explicitDomain ?? (quoted ? this.entryDomain(quoted) : null);
    let source: ConversationReference['source'] = 'CURRENT_TURN';

    if (quoted) {
      source = 'RECENT_HISTORY';
      usedRecentHistory = true;
    } else if (
      domain === null &&
      (deictic || planMention || ordinal !== null)
    ) {
      if (input.continuity.targetPlan !== null) {
        domain = this.fromTarget(input.continuity.targetPlan);
        source = 'PROFILE_CONTEXT';
        usedContinuity = true;
      } else {
        domain = this.recentDomain(input);
        if (domain !== null) {
          source = 'RECENT_HISTORY';
          usedRecentHistory = true;
        } else {
          domain = this.profileDomain(input);
          if (domain !== null) {
            source = 'PROFILE_CONTEXT';
            usedProfile = true;
          }
        }
      }
    }

    const references: ConversationReference[] = [];
    if (deictic && input.recentHistory.length > 0) {
      const latest = input.recentHistory[input.recentHistory.length - 1];
      references.push(
        Object.freeze({
          kind: 'HISTORY_TURN',
          logicalTurn: latest.logicalTurn,
          resolution: 'RESOLVED',
          source: 'RECENT_HISTORY',
        }),
      );
      usedRecentHistory = true;
    }
    if (planMention || deictic || ordinal !== null || previous) {
      references.push(
        Object.freeze({
          kind: 'PLAN',
          domain: domain ?? 'BOTH',
          target:
            ordinal !== null ? 'ORDINAL' : previous ? 'PREVIOUS' : 'CURRENT',
          ordinal,
          resolution: domain === null ? 'UNRESOLVED' : 'RESOLVED',
          source,
        }),
      );
    }

    return Object.freeze({
      references: Object.freeze(references),
      usedRecentHistory,
      usedContinuity,
      usedProfile,
    });
  }

  private explicitDomain(text: string): ReferenceDomain | null {
    const nutrition = this.includesAny(text, [
      'dieta',
      'plano alimentar',
      'alimentacao',
    ]);
    const workout = this.includesAny(text, ['treino', 'plano de treino']);
    if (nutrition && workout) return 'BOTH';
    if (nutrition) return 'NUTRITION';
    if (workout) return 'WORKOUT';
    return null;
  }

  private recentDomain(
    input: ConversationUnderstandingInput,
  ): ReferenceDomain | null {
    for (const entry of [...input.recentHistory].reverse()) {
      const structured = this.entryDomain(entry);
      if (structured !== null) return structured;
      const text = entry.text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('pt-BR');
      const domain = this.explicitDomain(text);
      if (domain !== null) return domain;
    }
    return null;
  }

  private entryDomain(
    entry: ConversationUnderstandingInput['recentHistory'][number],
  ): ReferenceDomain | null {
    const intent = entry.structuredContext?.intent;
    if (intent === 'WORKOUT') return 'WORKOUT';
    if (intent === 'DIET') return 'NUTRITION';
    if (intent === 'BOTH') return 'BOTH';
    if (entry.automationRuleCode === 'DAILY_WORKOUT') return 'WORKOUT';
    if (entry.automationRuleCode === 'MEAL_REMINDER') return 'NUTRITION';
    return null;
  }

  private profileDomain(
    input: ConversationUnderstandingInput,
  ): ReferenceDomain | null {
    const { dietAvailable, workoutAvailable } = input.profile.currentPlans;
    if (dietAvailable && workoutAvailable) return 'BOTH';
    if (dietAvailable) return 'NUTRITION';
    if (workoutAvailable) return 'WORKOUT';
    return null;
  }

  private fromTarget(target: 'DIET' | 'WORKOUT' | 'BOTH'): ReferenceDomain {
    if (target === 'DIET') return 'NUTRITION';
    return target;
  }

  private ordinal(text: string): number | null {
    const values: Readonly<Record<string, number>> = Object.freeze({
      '1': 1,
      '1o': 1,
      primeiro: 1,
      primeira: 1,
      um: 1,
      '2': 2,
      '2o': 2,
      segundo: 2,
      dois: 2,
      '3': 3,
      terceiro: 3,
      terceira: 3,
      tres: 3,
      '4': 4,
      quarto: 4,
      quatro: 4,
      '5': 5,
      quinto: 5,
      cinco: 5,
      '6': 6,
      sexto: 6,
      seis: 6,
      '7': 7,
      setimo: 7,
      setima: 7,
      sete: 7,
    });
    const match =
      /\b(1o|2o|[1-7]|primeir[oa]|segundo|terceir[oa]|quarto|quinto|sexto|setim[oa]|um|dois|tres|quatro|cinco|seis|sete)\b/u.exec(
        text,
      );
    return match ? values[match[1]] : null;
  }

  private includesAny(text: string, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => text.includes(phrase));
  }
}
