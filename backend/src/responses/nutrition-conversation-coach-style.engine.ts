import type { ConversationLanguageUnit } from './conversation-language-unit.contract';
import type { CompositionPlan } from './conversation-composition.contract';
import type {
  NutritionConversationCoachLexicalVariant,
  NutritionConversationCoachPersonality,
  NutritionConversationCoachStyle,
  NutritionConversationCoachToneStrategy,
  NutritionConversationHumanizationEvaluation,
  NutritionConversationHumanizationMetrics,
  NutritionConversationHumanizationViolation,
} from './nutrition-conversation-coach-style.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import type {
  SanitizedConversationDecision,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';

const PERSONALITY: NutritionConversationCoachPersonality = Object.freeze({
  warmth: 84,
  professionalism: 96,
  empathy: 86,
  optimism: 74,
  objectivity: 91,
  calmness: 90,
  supportiveness: 86,
  respect: 98,
  encouragement: 76,
  humility: 92,
  naturalness: 94,
});

const EVIDENCE_POLICY = Object.freeze({
  praiseRequiresEvidence: true as const,
  motivationRequiresEvidence: true as const,
  empathyRequiresEvidence: true as const,
  memoryRequiresAuthorization: true as const,
});

const GUARDRAILS = Object.freeze({
  paternalismProhibited: true as const,
  moralizingProhibited: true as const,
  salesLanguageProhibited: true as const,
  emotionalInferenceProhibited: true as const,
  sarcasmProhibited: true as const,
  ironyProhibited: true as const,
  jokesProhibited: true as const,
});

export const DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE: NutritionConversationCoachStyle =
  Object.freeze({
    identity: 'SINGULFIT_COACH_V1',
    role: 'SPORTS_NUTRITION_COACH',
    personality: PERSONALITY,
    toneStrategy: 'CALM_OBJECTIVE',
    openingStrategy: 'DIRECT',
    closingStrategy: 'AUTONOMY',
    pacing: 'BALANCED',
    transitionStyle: 'SEAMLESS',
    lexicalVariant: 'A',
    humor: 'PROHIBITED',
    evidencePolicy: EVIDENCE_POLICY,
    guardrails: GUARDRAILS,
  });

const RECOGNITION_PREFIX = 'recognition.';
const EMOTIONAL_PREFIX = 'emotional.';
const EPISODIC_PREFIX = 'episodicMemory.';
const MOTIVATION_DECISIONS = new Set<SanitizedConversationDecision>([
  'MOTIVATE_WITH_EVIDENCE',
  'ENCOURAGE_CONTINUITY',
  'CELEBRATE_IMPROVEMENT',
  'ACKNOWLEDGE_PROGRESS',
  'ACKNOWLEDGE_RECOVERY',
  'ACKNOWLEDGE_SMALL_WIN',
  'ACKNOWLEDGE_CONSISTENCY',
  'ACKNOWLEDGE_STRATEGY',
  'ACKNOWLEDGE_DISCIPLINE',
  'ACKNOWLEDGE_IMPROVEMENT',
]);

export class NutritionConversationCoachStyleEngine {
  resolve(
    context: NutritionConversationContext,
    composition: CompositionPlan,
    selectedDecisions: readonly SanitizedConversationDecision[],
  ): NutritionConversationCoachStyle {
    const recognition = new Set<string>(
      (context.recognition?.signals ?? []).map((signal) => signal.kind),
    );
    const emotional = new Set<string>(
      (context.emotional?.signals ?? []).map((signal) => signal.kind),
    );
    const episodes = context.episodicMemory?.episodes ?? [];
    const victory =
      composition.centralIntent === 'CELEBRATE' ||
      ['BIG_WIN', 'SMALL_WIN', 'IMPROVEMENT', 'RECOVERY'].some((kind) =>
        recognition.has(kind),
      );
    const plateau = recognition.has('PLATEAU');
    const recovery =
      composition.centralIntent === 'RECOVER' ||
      ['SETBACK', 'RECURRENCE', 'BAD_STRATEGY'].some((kind) =>
        recognition.has(kind),
      );
    const emotionallySensitive = ['FRUSTRATION', 'OVERWHELM', 'FATIGUE'].some(
      (kind) => emotional.has(kind),
    );
    const correction = selectedDecisions.some((decision) =>
      ['PROVIDE_RECOMMENDATION', 'CORRECT_LIMITING_FACTOR'].includes(decision),
    );
    const toneStrategy: NutritionConversationCoachToneStrategy = plateau
      ? 'PLATEAU_REASSURANCE'
      : recovery
        ? 'CALM_RECOVERY'
        : victory
          ? recognition.has('BIG_WIN') || recognition.has('IMPROVEMENT')
            ? 'PROGRESS_REINFORCEMENT'
            : 'DISCREET_CELEBRATION'
          : composition.centralIntent === 'TEACH'
            ? 'CURIOUS_EXPLANATION'
            : correction
              ? 'SUPPORTIVE_CORRECTION'
              : 'CALM_OBJECTIVE';
    const openingStrategy =
      episodes.length > 0 || composition.centralIntent === 'FOLLOW_UP'
        ? ('CONTINUITY' as const)
        : emotionallySensitive || recovery
          ? ('VALIDATING' as const)
          : victory
            ? ('CELEBRATORY' as const)
            : context.dialogue?.specificQuestion ||
                composition.depth === 'MINIMAL'
              ? ('DIRECT' as const)
              : ('CONTEXTUAL' as const);
    const closingStrategy =
      composition.closingRequirement === 'PROHIBITED'
        ? ('NONE' as const)
        : composition.centralIntent === 'FOLLOW_UP'
          ? ('REFLECTIVE' as const)
          : recovery || emotionallySensitive
            ? ('GROUNDING' as const)
            : victory
              ? ('CONTINUITY' as const)
              : ('AUTONOMY' as const);
    const pacing =
      context.communication.fatigue.score >= 70 ||
      composition.depth === 'MINIMAL'
        ? ('COMPACT' as const)
        : context.dialogue?.specificQuestion
          ? ('DIRECT' as const)
          : emotionallySensitive || recovery
            ? ('SUPPORTIVE' as const)
            : composition.depth === 'DEEP'
              ? ('EXPLANATORY' as const)
              : ('BALANCED' as const);
    const transitionStyle =
      composition.paragraphCount <= 1
        ? ('SEAMLESS' as const)
        : composition.rhythm === 'WARM'
          ? ('GENTLE' as const)
          : composition.rhythm === 'EXPLANATORY'
            ? ('LOGICAL' as const)
            : ('CONTINUITY' as const);
    const sensitiveMemory = episodes.some(
      (episode) => episode.sensitivity === 'SENSITIVE',
    );
    const humor =
      !emotionallySensitive &&
      !recovery &&
      !sensitiveMemory &&
      context.communication.fatigue.score < 40 &&
      ['CELEBRATE', 'RECOGNIZE'].includes(composition.centralIntent)
        ? ('SUBTLE_LIGHTNESS_ALLOWED' as const)
        : ('PROHIBITED' as const);
    const lexicalVariant = this.variant([
      composition.dialogueProfile,
      toneStrategy,
      context.communication.communicationStyle,
      context.communication.stageOfChange,
      context.userContext.goal ?? 'NO_GOAL',
      this.fatigueBand(context.communication.fatigue.score),
      this.fatigueBand(context.communication.fatigue.repeatedThemeScore),
      this.fatigueBand(context.communication.fatigue.repeatedPhraseScore),
      context.communication.prefersShortMessages ? 'SHORT' : 'STANDARD',
      [...recognition].sort().join(','),
      [...emotional].sort().join(','),
      episodes
        .map((episode) => episode.category)
        .sort()
        .join(','),
      composition.depth,
    ]);

    return Object.freeze({
      identity: 'SINGULFIT_COACH_V1',
      role: 'SPORTS_NUTRITION_COACH',
      personality: PERSONALITY,
      toneStrategy,
      openingStrategy,
      closingStrategy,
      pacing,
      transitionStyle,
      lexicalVariant,
      humor,
      evidencePolicy: EVIDENCE_POLICY,
      guardrails: GUARDRAILS,
    });
  }

  evaluate(
    payload: SanitizedConversationPayload,
    text: string,
    units: readonly ConversationLanguageUnit[],
  ): NutritionConversationHumanizationEvaluation {
    if (!text.trim()) {
      const zeroMetrics: NutritionConversationHumanizationMetrics =
        Object.freeze({
          naturalness: 0,
          coachIdentity: 0,
          toneConsistency: 0,
          empathyQuality: 0,
          lexicalDiversity: 0,
          openingDiversity: 0,
          closingDiversity: 0,
          transitionQuality: 0,
          humanPerception: 0,
          motivationQuality: 0,
          warmth: 0,
          professionalism: 0,
        });
      return Object.freeze({
        valid: false,
        violations: Object.freeze(['ARTIFICIAL_PARAGRAPHS'] as const),
        metrics: zeroMetrics,
      });
    }
    const normalized = this.normalize(text);
    const violations: NutritionConversationHumanizationViolation[] = [];
    const factKeys = new Set(units.flatMap((unit) => unit.factKeys));
    const decisions = new Set(units.flatMap((unit) => unit.decisionCodes));
    const facts = [...payload.facts.allowed, ...payload.facts.sensitive];
    const hasRecognition = [...factKeys].some((key) =>
      key.startsWith(RECOGNITION_PREFIX),
    );
    const hasEmotionalEvidence = [...factKeys].some((key) =>
      key.startsWith(EMOTIONAL_PREFIX),
    );
    const hasMotivationEvidence =
      hasRecognition ||
      [...factKeys].some(
        (key) =>
          key === 'userContext.goal' ||
          key === 'userContext.longitudinalSignal' ||
          key.startsWith(EPISODIC_PREFIX),
      ) ||
      facts.some(
        (fact) =>
          factKeys.has(fact.key) &&
          ['BEHAVIOR', 'COACH', 'LONGITUDINAL'].includes(fact.source),
      );

    if (
      /\b(?:parab[eé]ns|excelente|muito bem|[oó]timo trabalho|continue assim)\b/iu.test(
        text,
      ) &&
      !hasRecognition
    )
      violations.push('GENERIC_PRAISE_WITHOUT_EVIDENCE');
    if (
      [...decisions].some((decision) => MOTIVATION_DECISIONS.has(decision)) &&
      !hasMotivationEvidence
    )
      violations.push('MOTIVATION_WITHOUT_EVIDENCE');
    if (
      /\b(?:de acordo com os dados|a an[aá]lise indica|conforme o hist[oó]rico|resumo nutricional|evid[eê]ncia nutricional|acompanhamento comportamental)\b/iu.test(
        text,
      )
    )
      violations.push('ROBOTIC_LANGUAGE');
    if (
      /\b(?:voc[eê] precisa obedecer|fa[çc]a o que estou dizendo|tem que se comportar)\b/iu.test(
        text,
      )
    )
      violations.push('PATERNALISTIC_LANGUAGE');
    if (
      /\b(?:comida limpa|comida lixo|dia do lixo|falta de disciplina|sem desculpas)\b/iu.test(
        text,
      )
    )
      violations.push('MORALIZING_LANGUAGE');
    if (
      /\b(?:oferta|promo[çc][aã]o|assine|compre agora|plano premium)\b/iu.test(
        text,
      )
    )
      violations.push('SALES_LANGUAGE');
    if (
      /\bvoc[eê] (?:est[aá]|parece) (?:triste|ansios[oa]|frustrad[oa]|desmotivad[oa]|sobrecarregad[oa]|cansad[oa])\b/iu.test(
        text,
      ) ||
      ([...decisions].some((decision) =>
        [
          'VALIDATE_FRUSTRATION',
          'REDUCE_COGNITIVE_LOAD',
          'NORMALIZE_SETBACK',
          'REINFORCE_CONFIDENCE',
        ].includes(decision),
      ) &&
        !hasEmotionalEvidence)
    )
      violations.push('EMOTIONAL_INFERENCE');
    if (
      /\b(?:voc[eê] (?:tem|sofre de) (?:ansiedade|depress[aã]o|compuls[aã]o)|isso [ée] (?:um )?(?:transtorno|diagn[oó]stico))\b/iu.test(
        text,
      )
    )
      violations.push('PSYCHOLOGICAL_DIAGNOSIS');
    if (
      /\b(?:prometo|garanto|resultado garantido|vai dar certo com certeza)\b/iu.test(
        text,
      )
    )
      violations.push('UNAUTHORIZED_PROMISE');
    if (
      this.hasDuplicateSentence(text) ||
      this.repeatedPhraseRatio(text) > 0.18
    )
      violations.push('LEXICAL_REPETITION');
    if (this.repeatedParagraphOpening(text))
      violations.push('REPETITIVE_OPENING');
    if (
      /\b(?:conte comigo|estou aqui|qualquer coisa me cham[ea])\.?$/iu.test(
        text.trim(),
      )
    )
      violations.push('GENERIC_CLOSING');
    if (this.adjectiveCount(normalized) > 4)
      violations.push('EXCESSIVE_ADJECTIVES');
    if (this.count(text, '!') > 1) violations.push('EXCESSIVE_EXCLAMATION');
    if (this.artificialParagraphs(payload, text))
      violations.push('ARTIFICIAL_PARAGRAPHS');
    if (!this.toneMatches(payload, text, decisions))
      violations.push('TONE_MISMATCH');
    if (
      units.some((unit) => unit.claims.usesMemory) &&
      /\b(?:segundo (?:a )?nossa mem[oó]ria|conforme (?:o )?hist[oó]rico|registro de mem[oó]ria)\b/iu.test(
        text,
      )
    )
      violations.push('CONTINUITY_LANGUAGE_UNNATURAL');
    if (
      /\b(?:brincadeira|piada|ironia|sarcasmo|zoeira)\b/iu.test(text) ||
      (payload.style.coach.humor === 'PROHIBITED' &&
        /(?:rsrs|kkk|haha)/iu.test(text))
    )
      violations.push('HUMOR_BOUNDARY_VIOLATION');

    const uniqueViolations = Object.freeze([...new Set(violations)]);
    const metrics = this.metrics(
      payload,
      text,
      units,
      uniqueViolations,
      hasEmotionalEvidence,
      hasMotivationEvidence,
    );
    return Object.freeze({
      valid: uniqueViolations.length === 0,
      violations: uniqueViolations,
      metrics,
    });
  }

  private metrics(
    payload: SanitizedConversationPayload,
    text: string,
    units: readonly ConversationLanguageUnit[],
    violations: readonly NutritionConversationHumanizationViolation[],
    hasEmotionalEvidence: boolean,
    hasMotivationEvidence: boolean,
  ): NutritionConversationHumanizationMetrics {
    const penalty = (
      codes: readonly NutritionConversationHumanizationViolation[],
    ) => codes.filter((code) => violations.includes(code)).length;
    const lexicalDiversity = this.lexicalDiversity(text);
    const naturalness = this.clamp(
      100 -
        penalty([
          'ROBOTIC_LANGUAGE',
          'LEXICAL_REPETITION',
          'REPETITIVE_OPENING',
          'GENERIC_CLOSING',
          'ARTIFICIAL_PARAGRAPHS',
        ]) *
          18,
    );
    const coachIdentity = this.clamp(
      100 -
        penalty([
          'PATERNALISTIC_LANGUAGE',
          'MORALIZING_LANGUAGE',
          'SALES_LANGUAGE',
          'HUMOR_BOUNDARY_VIOLATION',
        ]) *
          25,
    );
    const toneConsistency = violations.includes('TONE_MISMATCH') ? 40 : 100;
    const empathyQuality = violations.includes('EMOTIONAL_INFERENCE')
      ? 20
      : hasEmotionalEvidence
        ? 100
        : 85;
    const openingDiversity = violations.includes('REPETITIVE_OPENING')
      ? 35
      : /^(?:parab[eé]ns|excelente|muito bem)\b/iu.test(text.trim())
        ? 55
        : 100;
    const closingDiversity = violations.includes('GENERIC_CLOSING') ? 35 : 100;
    const transitionQuality = this.transitionQuality(payload, text);
    const motivationQuality = violations.includes('MOTIVATION_WITHOUT_EVIDENCE')
      ? 20
      : hasMotivationEvidence
        ? 100
        : 90;
    const warmth = this.clamp(
      payload.style.coach.personality.warmth -
        penalty(['PATERNALISTIC_LANGUAGE', 'MORALIZING_LANGUAGE']) * 25,
    );
    const professionalism = this.clamp(
      payload.style.coach.personality.professionalism -
        penalty([
          'SALES_LANGUAGE',
          'EMOTIONAL_INFERENCE',
          'PSYCHOLOGICAL_DIAGNOSIS',
          'UNAUTHORIZED_PROMISE',
          'HUMOR_BOUNDARY_VIOLATION',
        ]) *
          25,
    );
    const humanPerception = this.round(
      (naturalness +
        coachIdentity +
        toneConsistency +
        empathyQuality +
        lexicalDiversity +
        transitionQuality +
        warmth +
        professionalism) /
        8,
    );
    return Object.freeze({
      naturalness,
      coachIdentity,
      toneConsistency,
      empathyQuality,
      lexicalDiversity,
      openingDiversity,
      closingDiversity,
      transitionQuality,
      humanPerception,
      motivationQuality,
      warmth,
      professionalism,
    });
  }

  private toneMatches(
    payload: SanitizedConversationPayload,
    text: string,
    decisions: ReadonlySet<SanitizedConversationDecision>,
  ): boolean {
    if (
      ['CALM_RECOVERY', 'PLATEAU_REASSURANCE'].includes(
        payload.style.coach.toneStrategy,
      ) &&
      this.count(text, '!') > 0
    )
      return false;
    if (
      payload.style.coach.toneStrategy === 'DISCREET_CELEBRATION' &&
      (decisions.has('CORRECT_LIMITING_FACTOR') ||
        decisions.has('PROVIDE_RECOMMENDATION'))
    )
      return false;
    return true;
  }

  private artificialParagraphs(
    payload: SanitizedConversationPayload,
    text: string,
  ): boolean {
    const paragraphs = text.split(/\n\s*\n/u).filter((item) => item.trim());
    return (
      paragraphs.length > payload.limits.maximumParagraphs ||
      paragraphs.some((paragraph) => Array.from(paragraph.trim()).length < 4)
    );
  }

  private transitionQuality(
    payload: SanitizedConversationPayload,
    text: string,
  ): number {
    const paragraphs = text.split(/\n\s*\n/u).filter((item) => item.trim());
    if (paragraphs.length <= 1) return 100;
    const starts = paragraphs.map((paragraph) =>
      this.normalize(paragraph).split(/\s+/u).slice(0, 2).join(' '),
    );
    const unique = new Set(starts).size;
    const base = Math.round((unique / starts.length) * 100);
    return payload.style.coach.transitionStyle === 'SEAMLESS'
      ? this.clamp(base)
      : this.clamp(Math.max(75, base));
  }

  private lexicalDiversity(text: string): number {
    const words = this.normalize(text)
      .split(/[^\p{L}\d]+/u)
      .filter((word) => word.length > 2);
    if (words.length === 0) return 100;
    return this.clamp(Math.round((new Set(words).size / words.length) * 100));
  }

  private repeatedPhraseRatio(text: string): number {
    const words = this.normalize(text)
      .split(/[^\p{L}\d]+/u)
      .filter(Boolean);
    if (words.length < 8) return 0;
    const phrases = words
      .slice(0, -2)
      .map((_, index) => words.slice(index, index + 3).join(' '));
    return (
      (phrases.length - new Set(phrases).size) / Math.max(1, phrases.length)
    );
  }

  private hasDuplicateSentence(text: string): boolean {
    const sentences = text
      .split(/[.!?]+/u)
      .map((sentence) => this.normalize(sentence).trim())
      .filter((sentence) => sentence.length > 5);
    return new Set(sentences).size !== sentences.length;
  }

  private repeatedParagraphOpening(text: string): boolean {
    const openings = text
      .split(/\n\s*\n/u)
      .map((paragraph) =>
        this.normalize(paragraph).trim().split(/\s+/u).slice(0, 2).join(' '),
      )
      .filter(Boolean);
    return openings.length > 1 && new Set(openings).size !== openings.length;
  }

  private adjectiveCount(text: string): number {
    return (
      text.match(
        /\b(?:excelente|incr[ií]vel|maravilhos[oa]|fant[aá]stic[oa]|perfeit[oa]|extraordin[aá]ri[oa]|sensacional)\b/giu,
      )?.length ?? 0
    );
  }

  private variant(
    parts: readonly string[],
  ): NutritionConversationCoachLexicalVariant {
    const value = parts.join('|');
    let hash = 17;
    for (const character of value)
      hash = (hash * 31 + character.codePointAt(0)!) % 104729;
    return (['A', 'B', 'C', 'D'] as const)[hash % 4];
  }

  private fatigueBand(score: number): string {
    return score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  }

  private count(value: string, character: string): number {
    return Array.from(value).filter((item) => item === character).length;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, this.round(value)));
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  }
}
