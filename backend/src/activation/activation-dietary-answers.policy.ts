import { CoachProfileAcquisitionField as Field } from '@prisma/client';
import { CoachProfileFieldRegistryService } from '../context/profile-acquisition/coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from '../context/profile-acquisition/profile-answer-recognizer.service';
import type { ActivationOnboardingDietaryState } from './activation-onboarding.types';
import { isSemanticFoodTerm } from '../context/food-preference-policy';

/** Drafts use the canonical sensitive-field recognizer; nothing is confirmed by inference. */
export class ActivationDietaryAnswersPolicy {
  private readonly registry = new CoachProfileFieldRegistryService();
  private readonly recognizer = new ProfileAnswerRecognizerService(
    this.registry,
  );

  empty(): ActivationOnboardingDietaryState {
    return {
      status: 'UNKNOWN',
      allergies: [],
      intolerances: [],
      avoidedFoods: [],
      otherRestrictions: [],
      rawRestrictions: [],
      specifiedCategories: [],
      allergiesExplicit: false,
      returnState: null,
    };
  }

  confirmation(text: string) {
    return this.recognizer.recognizeConfirmation(text).disposition;
  }

  isCorrection(text: string): boolean {
    return (
      /^(?:(?:corrigindo|quero corrigir|correção|correcao|na verdade)\b|n[aã]o[,.:!])/iu.test(
        text.trim(),
      ) && /alerg|intoler|restri|prefiro|evit|gosto/iu.test(text)
    );
  }

  read(text: string): ActivationOnboardingDietaryState | null {
    const clean = text
      .trim()
      .replace(
        /^(?:(?:corrigindo|quero corrigir|correção|correcao|na verdade)\s*[:,]?\s*|n[aã]o[,.:!]\s*(?:na verdade\s+)?(?=\S))/iu,
        '',
      )
      .replace(/[.!]+$/u, '')
      .trim();
    const normalized = this.fold(clean);
    const draft = this.empty();
    draft.status = 'CONFIRMATION_PENDING';
    if (/^(?:sim|tenho|possuo|claro)$/u.test(normalized)) {
      return { ...draft, status: 'DETAILS_REQUIRED' };
    }
    const absence = this.recognize(Field.ALLERGIES, clean);
    if (
      absence?.length === 0 ||
      /^(?:nenhuma?|sem|nao tenho)(?: restric(?:ao|oes)(?: alimentar(?:es)?)?)?$/u.test(
        normalized,
      )
    ) {
      draft.specifiedCategories = /alerg/u.test(normalized)
        ? ['allergies']
        : ['allergies', 'intolerances', 'avoidedFoods', 'otherRestrictions'];
      draft.allergiesExplicit = true;
      return draft;
    }
    if (this.recognize(Field.FOOD_INTOLERANCES, clean)?.length === 0) {
      draft.specifiedCategories = ['intolerances'];
      return draft;
    }
    if (
      !clean ||
      clean.includes('?') ||
      this.recognizer.isIndependentCommand(clean) ||
      /\b(?:talvez|acho|duvida|depois|mais tarde|nao sei|mudar de assunto)\b/u.test(
        normalized,
      )
    )
      return null;
    if (clean.length > 1000) return null;

    const body = clean.replace(
      /^(?:corrigindo|quero corrigir|correção|correcao|na verdade)\s*[:,]?\s*/iu,
      '',
    );
    const segments = body.split(
      /[,;.]+|\s+e\s+(?=(?:tenho|possuo|sou|n[aã]o|prefiro|evito|alerg|intoler))/iu,
    );
    let kind:
      | 'allergies'
      | 'intolerances'
      | 'avoidedFoods'
      | 'otherRestrictions'
      | null = null;
    for (const segment of segments) {
      const part = segment.trim();
      if (!part) continue;
      const folded = this.fold(part);
      let names: readonly string[] | undefined;
      if (
        /^(?:(?:eu )?(?:tenho|possuo) )?alerg|^(?:eu )?sou alergic/u.test(
          folded,
        )
      ) {
        kind = 'allergies';
        names = this.recognize(Field.ALLERGIES, part);
      } else if (/^(?:(?:eu )?(?:tenho|possuo) )?intoler/u.test(folded)) {
        kind = 'intolerances';
        names = this.recognize(Field.FOOD_INTOLERANCES, part);
      } else if (/^(?:nao gosto de|prefiro evitar|evito) /u.test(folded)) {
        kind = 'avoidedFoods';
        names = this.list(
          part.replace(/^(?:n[aã]o gosto de|prefiro evitar|evito)\s+/iu, ''),
        );
      } else if (/^(?:(?:eu )?tenho )?restric/u.test(folded)) {
        kind = 'otherRestrictions';
        names = this.list(
          part.replace(
            /^(?:(?:eu )?tenho\s+)?restri[cç][aã]o(?: alimentar)?\s+(?:a|ao|à)\s+/iu,
            '',
          ),
        );
      } else if (
        /^(?:amendoim|camar[aã]o|leite|ovo|ovos|soja|peixe|castanha|nozes|gl[uú]ten|lactose)(?:\s+e\s+(?:amendoim|camar[aã]o|leite|ovo|ovos|soja|peixe|castanha|nozes|gl[uú]ten|lactose))*$/iu.test(
          part,
        )
      ) {
        // Unlabelled foods are drafts, never a clinical declaration until confirmed.
        kind ??= /lactose|gluten/u.test(folded)
          ? 'otherRestrictions'
          : 'allergies';
        names = this.list(part);
      }
      if (
        !names?.length ||
        names.some((name) => !isSemanticFoodTerm(name)) ||
        names.some((name) => name.length > 120) ||
        this.list(part).some((item) => item.length > 120)
      )
        return null;
      draft[kind ?? 'otherRestrictions'].push(...names);
      if (kind && !draft.specifiedCategories.includes(kind))
        draft.specifiedCategories.push(kind);
      if (kind === 'allergies') draft.allergiesExplicit = true;
      draft.rawRestrictions.push(part);
    }
    if (draft.rawRestrictions.length === 0) return null;
    return draft;
  }

  prompt(draft: ActivationOnboardingDietaryState): string {
    if (draft.status === 'DETAILS_REQUIRED')
      return 'Quais são as alergias ou restrições? Pode me dizer os nomes e indicar se é alergia, intolerância ou preferência.';
    const parts = [
      draft.allergies.length
        ? `alergias: ${draft.allergies.join(', ')}`
        : draft.allergiesExplicit
          ? 'alergias: nenhuma'
          : '',
      draft.intolerances.length
        ? `intolerâncias: ${draft.intolerances.join(', ')}`
        : '',
      draft.avoidedFoods.length
        ? `prefere evitar: ${draft.avoidedFoods.join(', ')}`
        : '',
      draft.otherRestrictions.length
        ? `restrições alimentares: ${draft.otherRestrictions.join(', ')}`
        : '',
    ].filter(Boolean);
    return `Confirma que ${parts.length ? parts.join('; ') : draft.specifiedCategories.includes('intolerances') ? 'não tem intolerâncias alimentares' : 'não tem alergias ou restrições alimentares'}? Responda “sim” para confirmar ou diga o que devo corrigir.`;
  }

  private recognize(field: Field, text: string): readonly string[] | undefined {
    const definition = this.registry.get(field);
    const answer = this.recognizer.recognize(
      {
        field,
        confirmationPolicy: definition.confirmationPolicy,
        reasonCode: 'MISSING_CONTEXTUAL_FIELD',
      },
      text,
    );
    return answer.disposition === 'RECOGNIZED' &&
      Array.isArray(answer.value) &&
      answer.value.every((value): value is string => typeof value === 'string')
      ? answer.value
      : undefined;
  }
  private list(text: string): string[] {
    return text
      .split(/[,;]|\s+e\s+/iu)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  private fold(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }
}
