import { Injectable } from '@nestjs/common';
import {
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralInsightType,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  MotivationTriggerType,
  StageOfChange,
} from '@prisma/client';
import {
  BehavioralEngineInput,
  BehavioralEvaluation,
  BehavioralInsightCandidate,
  WeightedBehavioralSignal,
} from './interfaces/behavioral.interface';

const STAGE_ORDER: StageOfChange[] = [
  StageOfChange.PRE_CONTEMPLATION,
  StageOfChange.CONTEMPLATION,
  StageOfChange.PREPARATION,
  StageOfChange.ACTION,
  StageOfChange.MAINTENANCE,
];

@Injectable()
export class BehavioralEngineService {
  evaluate(input: BehavioralEngineInput): BehavioralEvaluation {
    const text = [
      ...input.messages.map((message) => message.content),
      ...input.memorySummaries,
    ].join(' ');
    const communicationStyle = this.communicationStyle(input, text);
    const motivations = this.motivations(input, text);
    const dominantMotivation =
      motivations[0]?.type ?? BehavioralMotivationStyle.HEALTH;
    const adherence = this.adherence(input);
    const adherenceStyle = this.adherenceStyle(input, adherence.score);
    const personalityPattern = this.personalityPattern(
      communicationStyle,
      adherenceStyle,
      dominantMotivation,
    );
    const preferredEngagementHour = this.preferredHour(input.messages);
    const stageResult = this.stage(input, adherence.score);
    const confidenceScore = this.confidence(input);
    const triggers = this.triggers(input, text, dominantMotivation);
    const insights = this.insights(input, text, preferredEngagementHour);

    return {
      communicationStyle,
      motivations,
      dominantMotivation,
      adherenceStyle,
      personalityPattern,
      confidenceScore,
      preferredEngagementHour,
      stage: stageResult.stage,
      stageConfidence: stageResult.confidence,
      stageEvidence: stageResult.evidence,
      adherence,
      triggers,
      insights,
      evidence: {
        messagesAnalyzed: input.messages.length,
        memoriesAnalyzed: input.memorySummaries.length,
        activeDays: input.activeDays,
        consistencyScore: input.consistencyScore,
        engagementScore: input.engagementScore,
        analysesLast30Days: input.analysesLast30Days,
      },
    };
  }

  private communicationStyle(
    input: BehavioralEngineInput,
    text: string,
  ): BehavioralCommunicationStyle {
    const averageLength =
      input.messages.length === 0
        ? 0
        : input.messages.reduce(
            (sum, message) => sum + message.content.trim().length,
            0,
          ) / input.messages.length;
    const analytical = this.keywordCount(
      text,
      /(\bscore\b|\bmédia\b|\bmedia\b|\bcaloria|\bproteína|\bproteina|\bkg\b|\bdados?\b|\bpercentual)/gi,
    );
    const motivational = this.keywordCount(
      text,
      /(\bmotiva|\bconquista|\bdesafio|\bmeta\b|\bvamos\b|\bconsigo\b)/gi,
    );
    const coach = this.keywordCount(
      text,
      /(\bcomo faço\b|\bo que devo\b|\bme ajuda\b|\borienta|\bcoach\b|\bacompanha)/gi,
    );

    if (analytical >= 2) {
      return BehavioralCommunicationStyle.ANALYTICAL;
    }

    if (coach >= 2) {
      return BehavioralCommunicationStyle.COACH;
    }

    if (motivational >= 2) {
      return BehavioralCommunicationStyle.MOTIVATIONAL;
    }

    if (input.messages.length >= 3 && averageLength <= 55) {
      return BehavioralCommunicationStyle.DIRECT;
    }

    return BehavioralCommunicationStyle.FRIENDLY;
  }

  private motivations(
    input: BehavioralEngineInput,
    text: string,
  ): Array<WeightedBehavioralSignal<BehavioralMotivationStyle>> {
    const scores = new Map<
      BehavioralMotivationStyle,
      { score: number; evidence: string[] }
    >(
      Object.values(BehavioralMotivationStyle).map((type) => [
        type,
        { score: 1, evidence: [] },
      ]),
    );
    const add = (
      type: BehavioralMotivationStyle,
      points: number,
      evidence: string,
    ) => {
      const current = scores.get(type);

      if (current) {
        current.score += points;
        current.evidence.push(evidence);
      }
    };
    const goal = input.goal?.toUpperCase() ?? '';

    if (goal === 'WEIGHT_LOSS') {
      add(
        BehavioralMotivationStyle.AESTHETICS,
        4,
        'objetivo de redução de peso',
      );
      add(BehavioralMotivationStyle.HEALTH, 2, 'objetivo nutricional ativo');
    } else if (goal === 'MUSCLE_GAIN' || goal === 'HYPERTROPHY') {
      add(BehavioralMotivationStyle.PERFORMANCE, 5, 'objetivo de hipertrofia');
    } else if (goal) {
      add(BehavioralMotivationStyle.HEALTH, 3, 'objetivo de manutenção');
      add(BehavioralMotivationStyle.LONGEVITY, 2, 'foco de longo prazo');
    }

    this.addKeywordMotivation(
      text,
      /(\bsaúde\b|\bsaude\b|\benergia\b|\bbem-estar\b|\bdisposição\b)/gi,
      BehavioralMotivationStyle.HEALTH,
      add,
    );
    this.addKeywordMotivation(
      text,
      /(\bestética\b|\bestetica\b|\baparência\b|\baparencia\b|\bemagrec|\broupa\b|\bcorpo\b)/gi,
      BehavioralMotivationStyle.AESTHETICS,
      add,
    );
    this.addKeywordMotivation(
      text,
      /(\bperformance\b|\bdesempenho\b|\btreino\b|\bforça\b|\bforca\b|\bcorrida\b|\bhipertrofia\b)/gi,
      BehavioralMotivationStyle.PERFORMANCE,
      add,
    );
    this.addKeywordMotivation(
      text,
      /(\blongevidade\b|\benvelhecer\b|\bfuturo\b|\blongo prazo\b|\bqualidade de vida\b)/gi,
      BehavioralMotivationStyle.LONGEVITY,
      add,
    );
    this.addKeywordMotivation(
      text,
      /(\bautoestima\b|\bconfiança\b|\bconfianca\b|\bme sentir bem\b|\borgulho\b)/gi,
      BehavioralMotivationStyle.SELF_ESTEEM,
      add,
    );

    const total = [...scores.values()].reduce(
      (sum, item) => sum + item.score,
      0,
    );

    const motivations = [...scores.entries()]
      .map(([type, value]) => ({
        type,
        weight: Number(((value.score / total) * 100).toFixed(2)),
        evidence: value.evidence,
      }))
      .sort(
        (left, right) =>
          right.weight - left.weight || left.type.localeCompare(right.type),
      );
    const roundedTotal = motivations.reduce(
      (sum, motivation) => sum + motivation.weight,
      0,
    );

    if (motivations[0]) {
      motivations[0].weight = Number(
        (motivations[0].weight + 100 - roundedTotal).toFixed(2),
      );
    }

    return motivations;
  }

  private adherence(input: BehavioralEngineInput) {
    const frequencyScore = this.clamp(
      Math.round((input.mealFrequency / 7) * 100),
    );
    const consistencyScore = this.clamp(input.consistencyScore);
    const habitScore = this.clamp(
      Math.round(
        input.regularityScore * 0.55 +
          Math.min(100, input.activeDays * 6) * 0.3 +
          Math.min(100, input.consecutiveDays * 12) * 0.15,
      ),
    );
    const contextScore = this.clamp(
      Math.round(
        (input.contextAdherenceScore ?? input.trendAdherenceScore ?? 50) * 0.7 +
          (input.trendAdherenceScore ?? input.contextAdherenceScore ?? 50) *
            0.3,
      ),
    );
    const responseScore =
      input.responsesSent === 0
        ? this.clamp(input.engagementScore)
        : this.clamp(
            Math.round(
              (input.responsesFollowedByInteraction / input.responsesSent) *
                100,
            ),
          );
    const score = this.clamp(
      Math.round(
        frequencyScore * 0.2 +
          consistencyScore * 0.25 +
          habitScore * 0.2 +
          contextScore * 0.2 +
          responseScore * 0.15,
      ),
    );

    return {
      score,
      frequencyScore,
      consistencyScore,
      habitScore,
      contextScore,
      responseScore,
    };
  }

  private adherenceStyle(
    input: BehavioralEngineInput,
    adherenceScore: number,
  ): BehavioralAdherenceStyle {
    if (input.regularityScore >= 75 && input.activeDays >= 10) {
      return BehavioralAdherenceStyle.STRUCTURED;
    }

    if (adherenceScore < 50 || input.consistencyScore < 50) {
      return BehavioralAdherenceStyle.ACCOUNTABILITY;
    }

    if (adherenceScore >= 75 && input.engagementScore < 60) {
      return BehavioralAdherenceStyle.SELF_DIRECTED;
    }

    return BehavioralAdherenceStyle.FLEXIBLE;
  }

  private personalityPattern(
    communication: BehavioralCommunicationStyle,
    adherence: BehavioralAdherenceStyle,
    motivation: BehavioralMotivationStyle,
  ): BehavioralPersonalityPattern {
    if (communication === BehavioralCommunicationStyle.ANALYTICAL) {
      return BehavioralPersonalityPattern.DATA_ORIENTED;
    }

    if (adherence === BehavioralAdherenceStyle.STRUCTURED) {
      return BehavioralPersonalityPattern.ROUTINE_ORIENTED;
    }

    if (
      motivation === BehavioralMotivationStyle.PERFORMANCE ||
      communication === BehavioralCommunicationStyle.MOTIVATIONAL
    ) {
      return BehavioralPersonalityPattern.CHALLENGE_ORIENTED;
    }

    if (
      adherence === BehavioralAdherenceStyle.ACCOUNTABILITY ||
      communication === BehavioralCommunicationStyle.COACH
    ) {
      return BehavioralPersonalityPattern.SUPPORT_ORIENTED;
    }

    return BehavioralPersonalityPattern.BALANCED;
  }

  private stage(input: BehavioralEngineInput, adherenceScore: number) {
    let candidate: StageOfChange;
    let confidence: number;

    if (
      input.activeDays >= 15 &&
      input.consistencyScore >= 75 &&
      input.consecutiveDays >= 7
    ) {
      candidate = StageOfChange.MAINTENANCE;
      confidence = 0.9;
    } else if (
      input.activeDays >= 4 ||
      input.analysesLast30Days >= 3 ||
      adherenceScore >= 60
    ) {
      candidate = StageOfChange.ACTION;
      confidence = 0.82;
    } else if (
      input.activeDays >= 1 ||
      input.analysesLast30Days >= 1 ||
      input.consistencyScore >= 35
    ) {
      candidate = StageOfChange.PREPARATION;
      confidence = 0.72;
    } else if (input.messages.length > 0 || input.memorySummaries.length > 0) {
      candidate = StageOfChange.CONTEMPLATION;
      confidence = 0.62;
    } else {
      candidate = StageOfChange.PRE_CONTEMPLATION;
      confidence = 0.5;
    }

    const stage = this.stabilizeStage(
      input.previousStage,
      candidate,
      confidence,
    );

    return {
      stage,
      confidence,
      evidence: {
        candidate,
        activeDays: input.activeDays,
        consecutiveDays: input.consecutiveDays,
        analysesLast30Days: input.analysesLast30Days,
        consistencyScore: input.consistencyScore,
        adherenceScore,
      },
    };
  }

  private triggers(
    input: BehavioralEngineInput,
    text: string,
    motivation: BehavioralMotivationStyle,
  ): Array<WeightedBehavioralSignal<MotivationTriggerType>> {
    const triggers: Array<WeightedBehavioralSignal<MotivationTriggerType>> = [];
    const add = (
      type: MotivationTriggerType,
      weight: number,
      evidence: string,
    ) => triggers.push({ type, weight, evidence: [evidence] });

    if (input.progressRecords > 0 || input.improvingTrend) {
      add(
        MotivationTriggerType.PROGRESS,
        input.improvingTrend ? 90 : 70,
        'histórico de progresso disponível',
      );
    }

    if (/\bdesafio|\bmeta|\bsuperar|\bcompetir/i.test(text)) {
      add(MotivationTriggerType.CHALLENGE, 80, 'linguagem de desafio');
    }

    if (/\brecompensa|\bcomemorar|\bpresente|\bpremiar/i.test(text)) {
      add(MotivationTriggerType.REWARD, 75, 'linguagem de recompensa');
    }

    if (/\bfamília|\bfamilia|\bfilhos?|\bparceir[oa]/i.test(text)) {
      add(MotivationTriggerType.FAMILY, 80, 'referência familiar');
    }

    const dominantTrigger: Partial<
      Record<BehavioralMotivationStyle, MotivationTriggerType>
    > = {
      [BehavioralMotivationStyle.HEALTH]: MotivationTriggerType.HEALTH,
      [BehavioralMotivationStyle.LONGEVITY]: MotivationTriggerType.HEALTH,
      [BehavioralMotivationStyle.SELF_ESTEEM]:
        MotivationTriggerType.SELF_ESTEEM,
      [BehavioralMotivationStyle.PERFORMANCE]:
        MotivationTriggerType.PERFORMANCE,
      [BehavioralMotivationStyle.AESTHETICS]: MotivationTriggerType.SELF_ESTEEM,
    };
    const mapped = dominantTrigger[motivation];

    if (mapped && !triggers.some((trigger) => trigger.type === mapped)) {
      add(mapped, 70, `motivação dominante ${motivation}`);
    }

    return triggers.sort(
      (left, right) =>
        right.weight - left.weight || left.type.localeCompare(right.type),
    );
  }

  private insights(
    input: BehavioralEngineInput,
    text: string,
    preferredHour: number | null,
  ): BehavioralInsightCandidate[] {
    const insights: BehavioralInsightCandidate[] = [];
    const averageLength =
      input.messages.length === 0
        ? 0
        : input.messages.reduce(
            (sum, message) => sum + message.content.length,
            0,
          ) / input.messages.length;

    if (input.messages.length >= 3 && averageLength <= 70) {
      insights.push({
        type: BehavioralInsightType.SHORT_MESSAGES,
        summary: 'Usuário tende a interagir com mensagens curtas e objetivas.',
        evidence: {
          messagesAnalyzed: input.messages.length,
          averageLength: Math.round(averageLength),
        },
      });
    }

    if (preferredHour !== null && input.messages.length >= 3) {
      const type =
        preferredHour < 12
          ? BehavioralInsightType.MORNING_ENGAGEMENT
          : preferredHour < 18
            ? BehavioralInsightType.AFTERNOON_ENGAGEMENT
            : BehavioralInsightType.EVENING_ENGAGEMENT;
      insights.push({
        type,
        summary: `Usuário apresenta maior recorrência de interação por volta de ${preferredHour}h UTC.`,
        evidence: {
          preferredEngagementHour: preferredHour,
          messagesAnalyzed: input.messages.length,
        },
      });
    }

    const weekend = input.messages.filter((message) => {
      const day = message.timestamp.getUTCDay();
      return day === 0 || day === 6;
    }).length;
    const weekday = input.messages.length - weekend;
    const weekendDailyRate = weekend / 2;
    const weekdayDailyRate = weekday / 5;

    if (
      input.messages.length >= 7 &&
      weekdayDailyRate > 0 &&
      weekendDailyRate < weekdayDailyRate * 0.5
    ) {
      insights.push({
        type: BehavioralInsightType.WEEKEND_DROP,
        summary: 'O engajamento tende a cair nos finais de semana.',
        evidence: {
          weekendMessages: weekend,
          weekdayMessages: weekday,
        },
      });
    }

    if (
      this.keywordCount(
        text,
        /(\bscore\b|\bmédia\b|\bmedia\b|\bdados?\b|\bpercentual|\bkg\b)/gi,
      ) >= 2
    ) {
      insights.push({
        type: BehavioralInsightType.DATA_RESPONSIVE,
        summary:
          'O usuário demonstra maior interesse por dados e progresso mensurável.',
        evidence: {
          dataReferences: this.keywordCount(
            text,
            /(\bscore\b|\bmédia\b|\bmedia\b|\bdados?\b|\bpercentual|\bkg\b)/gi,
          ),
        },
      });
    }

    if (
      input.responsesSent >= 3 &&
      input.responsesFollowedByInteraction / input.responsesSent >= 0.7
    ) {
      insights.push({
        type: BehavioralInsightType.CONSISTENCY_RESPONSIVE,
        summary:
          'O usuário costuma retomar a interação após mensagens de acompanhamento.',
        evidence: {
          responsesSent: input.responsesSent,
          followedByInteraction: input.responsesFollowedByInteraction,
        },
      });
    }

    return insights;
  }

  private preferredHour(messages: BehavioralEngineInput['messages']) {
    if (messages.length === 0) {
      return null;
    }

    const counts = new Map<number, number>();

    for (const message of messages) {
      const hour = message.timestamp.getUTCHours();
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }

    return (
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0] - right[0],
      )[0]?.[0] ?? null
    );
  }

  private confidence(input: BehavioralEngineInput): number {
    const evidence =
      Math.min(40, input.messages.length * 3) +
      Math.min(15, input.memorySummaries.length * 5) +
      Math.min(20, input.activeDays * 2) +
      Math.min(15, input.analysesLast30Days * 3) +
      (input.contextAdherenceScore === null ? 0 : 10);

    return Number(Math.min(0.95, 0.3 + evidence / 100).toFixed(4));
  }

  private stabilizeStage(
    previous: StageOfChange | null,
    candidate: StageOfChange,
    confidence: number,
  ): StageOfChange {
    if (!previous || confidence >= 0.8) {
      return candidate;
    }

    const previousIndex = STAGE_ORDER.indexOf(previous);
    const candidateIndex = STAGE_ORDER.indexOf(candidate);

    if (Math.abs(candidateIndex - previousIndex) <= 1) {
      return candidate;
    }

    return (
      STAGE_ORDER[previousIndex + Math.sign(candidateIndex - previousIndex)] ??
      candidate
    );
  }

  private addKeywordMotivation(
    text: string,
    pattern: RegExp,
    type: BehavioralMotivationStyle,
    add: (
      type: BehavioralMotivationStyle,
      points: number,
      evidence: string,
    ) => void,
  ): void {
    const count = this.keywordCount(text, pattern);

    if (count > 0) {
      add(type, Math.min(6, count * 2), `${count} referência(s) textuais`);
    }
  }

  private keywordCount(text: string, pattern: RegExp): number {
    return text.match(pattern)?.length ?? 0;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
