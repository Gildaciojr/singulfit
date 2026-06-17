import { Injectable } from '@nestjs/common';
import {
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  CoachAdaptationMode,
  CoachCommunicationProfileType,
  CoachMotivationalTrigger,
  CoachReengagementReason,
  GoalProgressionState,
  MotivationTriggerType,
  NutritionRelapseSeverity,
} from '@prisma/client';

type CommunicationScores = Record<CoachCommunicationProfileType, number>;
type MotivationScores = Record<CoachMotivationalTrigger, number>;

@Injectable()
export class CoachExperienceCalculatorService {
  communication(input: {
    communicationStyle: BehavioralCommunicationStyle;
    adherenceStyle: BehavioralAdherenceStyle;
    personalityPattern: BehavioralPersonalityPattern;
    adaptationMode: CoachAdaptationMode | null;
    consistencyScore: number;
    churnRisk: string;
    confidence: number;
    previous: {
      dominantStyle: CoachCommunicationProfileType;
      scores: CommunicationScores;
    } | null;
  }) {
    const candidate = this.communicationBase();
    const add = (type: CoachCommunicationProfileType, points: number) => {
      candidate[type] += points;
    };

    switch (input.communicationStyle) {
      case BehavioralCommunicationStyle.DIRECT:
        add(CoachCommunicationProfileType.DIRECT, 70);
        add(CoachCommunicationProfileType.DISCIPLINARIAN, 20);
        break;
      case BehavioralCommunicationStyle.ANALYTICAL:
        add(CoachCommunicationProfileType.TECHNICAL, 75);
        add(CoachCommunicationProfileType.DIRECT, 15);
        break;
      case BehavioralCommunicationStyle.MOTIVATIONAL:
        add(CoachCommunicationProfileType.MOTIVATIONAL, 75);
        add(CoachCommunicationProfileType.WARM, 15);
        break;
      case BehavioralCommunicationStyle.COACH:
        add(CoachCommunicationProfileType.BALANCED, 45);
        add(CoachCommunicationProfileType.WARM, 35);
        break;
      case BehavioralCommunicationStyle.FRIENDLY:
        add(CoachCommunicationProfileType.WARM, 65);
        add(CoachCommunicationProfileType.BALANCED, 25);
        break;
    }

    if (input.adherenceStyle === BehavioralAdherenceStyle.ACCOUNTABILITY) {
      add(CoachCommunicationProfileType.DISCIPLINARIAN, 35);
      add(CoachCommunicationProfileType.DIRECT, 15);
    } else if (
      input.adherenceStyle === BehavioralAdherenceStyle.SELF_DIRECTED
    ) {
      add(CoachCommunicationProfileType.TECHNICAL, 20);
      add(CoachCommunicationProfileType.DIRECT, 15);
    }

    if (
      input.personalityPattern === BehavioralPersonalityPattern.SUPPORT_ORIENTED
    ) {
      add(CoachCommunicationProfileType.WARM, 25);
    }

    switch (input.adaptationMode) {
      case CoachAdaptationMode.TECHNICAL:
      case CoachAdaptationMode.PERFORMANCE:
        add(CoachCommunicationProfileType.TECHNICAL, 25);
        break;
      case CoachAdaptationMode.RECOVERY:
        add(CoachCommunicationProfileType.WARM, 35);
        add(CoachCommunicationProfileType.MOTIVATIONAL, 20);
        break;
      case CoachAdaptationMode.ENCOURAGING:
        add(CoachCommunicationProfileType.MOTIVATIONAL, 25);
        break;
      case null:
        break;
    }

    if (input.churnRisk === 'HIGH') {
      add(CoachCommunicationProfileType.WARM, 25);
      add(CoachCommunicationProfileType.MOTIVATIONAL, 15);
    } else if (input.consistencyScore >= 80) {
      add(CoachCommunicationProfileType.TECHNICAL, 15);
    }

    const normalized = this.normalize(candidate);
    const scores = input.previous
      ? this.smooth(input.previous.scores, normalized)
      : normalized;
    const candidateDominant = this.top(scores);
    const dominantStyle =
      input.previous &&
      candidateDominant !== input.previous.dominantStyle &&
      scores[candidateDominant] - scores[input.previous.dominantStyle] < 12
        ? input.previous.dominantStyle
        : candidateDominant;

    return {
      dominantStyle,
      scores,
      confidence: Number(
        Math.min(0.98, Math.max(0.35, input.confidence)).toFixed(4),
      ),
    };
  }

  motivation(input: {
    motivations: Array<{ type: BehavioralMotivationStyle; weight: number }>;
    triggers: Array<{ type: MotivationTriggerType; weight: number }>;
    adherenceStyle: BehavioralAdherenceStyle;
    personalityPattern: BehavioralPersonalityPattern;
    goal: string;
  }) {
    const scores = this.motivationBase();
    const add = (type: CoachMotivationalTrigger, points: number) => {
      scores[type] += points;
    };
    const motivationMap: Record<
      BehavioralMotivationStyle,
      CoachMotivationalTrigger
    > = {
      [BehavioralMotivationStyle.HEALTH]: CoachMotivationalTrigger.HEALTH,
      [BehavioralMotivationStyle.AESTHETICS]:
        CoachMotivationalTrigger.VISUAL_RESULT,
      [BehavioralMotivationStyle.PERFORMANCE]:
        CoachMotivationalTrigger.PERFORMANCE,
      [BehavioralMotivationStyle.LONGEVITY]: CoachMotivationalTrigger.LONGEVITY,
      [BehavioralMotivationStyle.SELF_ESTEEM]:
        CoachMotivationalTrigger.SELF_ESTEEM,
    };
    const triggerMap: Partial<
      Record<MotivationTriggerType, CoachMotivationalTrigger>
    > = {
      [MotivationTriggerType.PROGRESS]: CoachMotivationalTrigger.VISUAL_RESULT,
      [MotivationTriggerType.CHALLENGE]: CoachMotivationalTrigger.DISCIPLINE,
      [MotivationTriggerType.HEALTH]: CoachMotivationalTrigger.HEALTH,
      [MotivationTriggerType.SELF_ESTEEM]: CoachMotivationalTrigger.SELF_ESTEEM,
      [MotivationTriggerType.PERFORMANCE]: CoachMotivationalTrigger.PERFORMANCE,
    };

    for (const motivation of input.motivations) {
      add(motivationMap[motivation.type], motivation.weight);
    }

    for (const trigger of input.triggers) {
      const mapped = triggerMap[trigger.type];

      if (mapped) {
        add(mapped, trigger.weight * 0.65);
      }
    }

    if (input.adherenceStyle === BehavioralAdherenceStyle.STRUCTURED) {
      add(CoachMotivationalTrigger.ROUTINE, 55);
      add(CoachMotivationalTrigger.DISCIPLINE, 30);
    } else if (
      input.adherenceStyle === BehavioralAdherenceStyle.ACCOUNTABILITY
    ) {
      add(CoachMotivationalTrigger.DISCIPLINE, 45);
    }

    if (
      input.personalityPattern === BehavioralPersonalityPattern.ROUTINE_ORIENTED
    ) {
      add(CoachMotivationalTrigger.ROUTINE, 35);
    }

    if (input.goal === 'HYPERTROPHY') {
      add(CoachMotivationalTrigger.PERFORMANCE, 25);
    } else if (input.goal === 'WEIGHT_LOSS') {
      add(CoachMotivationalTrigger.VISUAL_RESULT, 18);
      add(CoachMotivationalTrigger.HEALTH, 12);
    }

    const normalized = this.normalize(scores);
    const dominantTrigger = this.top(normalized);
    const ordered = Object.values(normalized).sort(
      (left, right) => right - left,
    );
    const confidence = Math.min(
      0.98,
      0.45 + ((ordered[0] ?? 0) - (ordered[1] ?? 0)) / 100,
    );

    return {
      dominantTrigger,
      scores: normalized,
      confidence: Number(confidence.toFixed(4)),
    };
  }

  fatigue(input: { outboundContents: string[]; inboundCount: number }) {
    const outboundCount = input.outboundContents.length;
    const repeatedThemeScore = this.themeRepetition(input.outboundContents);
    const repeatedPhraseScore = this.phraseRepetition(input.outboundContents);
    const interactionResponseScore =
      outboundCount === 0
        ? 100
        : this.clamp(Math.round((input.inboundCount / outboundCount) * 100));
    const volumeScore = this.clamp(Math.max(0, (outboundCount - 5) * 9));
    const fatigueScore = this.clamp(
      Math.round(
        volumeScore * 0.3 +
          repeatedThemeScore * 0.25 +
          repeatedPhraseScore * 0.25 +
          (100 - interactionResponseScore) * 0.2,
      ),
    );
    const recommendedFrequencyHours =
      fatigueScore >= 80
        ? 72
        : fatigueScore >= 60
          ? 48
          : fatigueScore >= 40
            ? 36
            : 24;

    return {
      fatigueScore,
      repeatedThemeScore,
      repeatedPhraseScore,
      interactionResponseScore,
      recommendedFrequencyHours,
    };
  }

  reengagement(input: {
    daysInactive: number;
    momentumScore: number;
    fatigueScore: number;
    evolutionState: GoalProgressionState | null;
    relapseSeverity: NutritionRelapseSeverity | null;
    seed: number;
  }) {
    let reason: CoachReengagementReason;
    let confidence: number;

    if (input.daysInactive >= 14) {
      reason = CoachReengagementReason.TEMPORARY_ABANDONMENT;
      confidence = 0.92;
    } else if (
      input.evolutionState === GoalProgressionState.DECLINING ||
      input.relapseSeverity === NutritionRelapseSeverity.HIGH
    ) {
      reason = CoachReengagementReason.LACK_OF_RESULTS;
      confidence = 0.86;
    } else if (input.momentumScore < 40 || input.fatigueScore >= 65) {
      reason = CoachReengagementReason.MOTIVATION_LOSS;
      confidence = 0.8;
    } else {
      reason = CoachReengagementReason.FORGOTTEN;
      confidence = 0.72;
    }

    return {
      reason,
      confidence,
      messageVariant: Math.abs(input.seed) % 4,
    };
  }

  momentum(input: {
    consistencyScore: number;
    evolutionScore: number;
    relapseSeverity: NutritionRelapseSeverity | null;
    engagementScore: number;
    adherenceScore: number;
  }) {
    const relapseScore =
      input.relapseSeverity === NutritionRelapseSeverity.HIGH
        ? 20
        : input.relapseSeverity === NutritionRelapseSeverity.MEDIUM
          ? 45
          : input.relapseSeverity === NutritionRelapseSeverity.LOW
            ? 70
            : 100;
    const score = this.clamp(
      Math.round(
        input.consistencyScore * 0.25 +
          input.evolutionScore * 0.2 +
          relapseScore * 0.2 +
          input.engagementScore * 0.15 +
          input.adherenceScore * 0.2,
      ),
    );

    return { score, relapseScore };
  }

  retention(input: {
    usageScore: number;
    engagementScore: number;
    contextScore: number;
    evolutionScore: number;
    coachScore: number;
    recommendationAcceptanceScore: number;
  }) {
    return this.clamp(
      Math.round(
        input.usageScore * 0.18 +
          input.engagementScore * 0.2 +
          input.contextScore * 0.12 +
          input.evolutionScore * 0.18 +
          input.coachScore * 0.17 +
          input.recommendationAcceptanceScore * 0.15,
      ),
    );
  }

  whatsapp(input: {
    averageInboundLength: number;
    averageOutboundLength: number;
    preferredHourUtc: number | null;
    communicationStyle: CoachCommunicationProfileType;
    fatigueScore: number;
    frequencyHours: number;
    interactionRate: number;
  }) {
    const shortPreference =
      input.averageInboundLength > 0 && input.averageInboundLength <= 70;
    let idealMessageLength = shortPreference ? 320 : 520;

    if (input.communicationStyle === CoachCommunicationProfileType.TECHNICAL) {
      idealMessageLength = shortPreference ? 420 : 650;
    }

    if (input.fatigueScore >= 60) {
      idealMessageLength = Math.min(idealMessageLength, 280);
    }

    const idealEmojiCount =
      input.communicationStyle === CoachCommunicationProfileType.TECHNICAL ||
      input.communicationStyle === CoachCommunicationProfileType.DIRECT ||
      input.communicationStyle === CoachCommunicationProfileType.DISCIPLINARIAN
        ? 0
        : input.communicationStyle === CoachCommunicationProfileType.WARM ||
            input.communicationStyle ===
              CoachCommunicationProfileType.MOTIVATIONAL
          ? 1
          : 0;

    return {
      idealMessageLength,
      idealEmojiCount,
      idealFrequencyHours: input.frequencyHours,
      preferredHourUtc: input.preferredHourUtc,
      interactionRate: input.interactionRate,
    };
  }

  evolutionScore(state: GoalProgressionState | null, score: number | null) {
    if (score !== null) {
      return this.clamp(score);
    }

    return state === GoalProgressionState.IMPROVING
      ? 80
      : state === GoalProgressionState.DECLINING
        ? 35
        : 60;
  }

  private communicationBase(): CommunicationScores {
    return {
      [CoachCommunicationProfileType.DIRECT]: 10,
      [CoachCommunicationProfileType.TECHNICAL]: 10,
      [CoachCommunicationProfileType.MOTIVATIONAL]: 10,
      [CoachCommunicationProfileType.DISCIPLINARIAN]: 10,
      [CoachCommunicationProfileType.WARM]: 10,
      [CoachCommunicationProfileType.BALANCED]: 20,
    };
  }

  private motivationBase(): MotivationScores {
    return {
      [CoachMotivationalTrigger.VISUAL_RESULT]: 10,
      [CoachMotivationalTrigger.HEALTH]: 10,
      [CoachMotivationalTrigger.SELF_ESTEEM]: 10,
      [CoachMotivationalTrigger.PERFORMANCE]: 10,
      [CoachMotivationalTrigger.DISCIPLINE]: 10,
      [CoachMotivationalTrigger.LONGEVITY]: 10,
      [CoachMotivationalTrigger.ROUTINE]: 10,
    };
  }

  private normalize<T extends string>(
    scores: Record<T, number>,
  ): Record<T, number> {
    const entries = Object.entries(scores) as Array<[T, number]>;
    const total = entries.reduce((sum, [, score]) => sum + score, 0);
    const normalized = Object.fromEntries(
      entries.map(([key, score]) => [
        key,
        this.clamp(Math.round((score / total) * 100)),
      ]),
    ) as Record<T, number>;

    return normalized;
  }

  private smooth<T extends string>(
    previous: Record<T, number>,
    candidate: Record<T, number>,
  ): Record<T, number> {
    return Object.fromEntries(
      (Object.keys(candidate) as T[]).map((key) => [
        key,
        this.clamp(
          Math.round(
            (previous[key] ?? candidate[key]) * 0.65 + candidate[key] * 0.35,
          ),
        ),
      ]),
    ) as Record<T, number>;
  }

  private top<T extends string>(scores: Record<T, number>): T {
    return (Object.entries(scores) as Array<[T, number]>).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0][0];
  }

  private themeRepetition(contents: string[]): number {
    if (contents.length < 2) {
      return 0;
    }

    const themes = [
      /\bprote[ií]na\b/i,
      /\bhidrata|\b[aá]gua\b/i,
      /\bveget|\bfibra\b/i,
      /\bconsist|\brotina\b/i,
      /\bprogres|\bmeta\b/i,
      /\brefei[cç][aã]o\b/i,
    ];
    const counts = themes.map(
      (theme) => contents.filter((content) => theme.test(content)).length,
    );
    const maximum = Math.max(...counts, 0);

    return this.clamp(Math.round((maximum / contents.length) * 100));
  }

  private phraseRepetition(contents: string[]): number {
    if (contents.length < 2) {
      return 0;
    }

    const fingerprints = contents.map((content) =>
      content
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 14)
        .join(' '),
    );
    const unique = new Set(fingerprints).size;

    return this.clamp(
      Math.round(((fingerprints.length - unique) / fingerprints.length) * 100),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
