import { Injectable } from '@nestjs/common';
import {
  AIQualityContext,
  AIQualityFlag,
  AIQualityResult,
  AI_QUALITY_FLAG,
} from './interfaces/ai-quality.interface';

@Injectable()
export class AIQualityScoringService {
  score(content: string, context: AIQualityContext): AIQualityResult {
    const normalized = content.trim();
    const personalizationScore = this.personalization(normalized, context);
    const usefulnessScore = this.usefulness(normalized);
    const clarityScore = this.clarity(normalized);
    const lengthScore = this.lengthScore(normalized.length);
    const flags: AIQualityFlag[] = [];

    if (this.isGeneric(normalized)) {
      flags.push(AI_QUALITY_FLAG.GENERIC_RESPONSE);
    }

    if (personalizationScore < 55) {
      flags.push(AI_QUALITY_FLAG.LOW_PERSONALIZATION);
    }

    if (usefulnessScore < 55) {
      flags.push(AI_QUALITY_FLAG.NO_PRACTICAL_ACTION);
    }

    if (normalized.length > 2_500) {
      flags.push(AI_QUALITY_FLAG.WHATSAPP_TOO_LONG);
    }

    if (clarityScore < 55) {
      flags.push(AI_QUALITY_FLAG.LOW_CLARITY);
    }

    const genericPenalty = flags.includes(AI_QUALITY_FLAG.GENERIC_RESPONSE)
      ? 20
      : 0;
    const qualityScore = this.clamp(
      Math.round(
        personalizationScore * 0.35 +
          usefulnessScore * 0.3 +
          clarityScore * 0.25 +
          lengthScore * 0.1 -
          genericPenalty,
      ),
    );

    return {
      qualityScore,
      personalizationScore,
      usefulnessScore,
      clarityScore,
      flags,
    };
  }

  private personalization(content: string, context: AIQualityContext): number {
    let score = 15;
    const goalPatterns: Record<string, RegExp> = {
      MUSCLE_GAIN: /\b(?:ganho de massa|hipertrofia|massa muscular)\b/i,
      HYPERTROPHY: /\b(?:ganho de massa|hipertrofia|massa muscular)\b/i,
      WEIGHT_LOSS: /\b(?:reducao de peso|redução de peso|emagrecimento)\b/i,
      MAINTENANCE: /\bmanutencao|manutenção\b/i,
      HEALTH: /\bsaude|saúde|bem-estar\b/i,
    };
    const goalPattern = context.goal ? goalPatterns[context.goal] : undefined;

    if (goalPattern?.test(content)) {
      score += 25;
    } else if (!context.goal) {
      score += 10;
    }

    if (
      /\b(?:seu objetivo|seu historico|seu histórico|seu ritmo|sua consistencia|sua consistência)\b/i.test(
        content,
      )
    ) {
      score += 20;
    }

    if (
      context.insightCount > 0 &&
      /\binsight contextual|padrao recente|padrão recente|ultimos 7 dias|últimos 7 dias\b/i.test(
        content,
      )
    ) {
      score += 15;
    }

    if (
      context.behaviorStage &&
      /\bestagio|estágio|adesao prevista|adesão prevista|motivacao predominante|motivação predominante\b/i.test(
        content,
      )
    ) {
      score += 15;
    }

    if (
      context.memoryCount > 0 &&
      /\bhistorico|histórico|recente|comparad[oa] ao seu momento\b/i.test(
        content,
      )
    ) {
      score += 10;
    }

    return this.clamp(score);
  }

  private usefulness(content: string): number {
    let score = 15;

    if (/recomendacao pratica|recomendação prática/i.test(content)) {
      score += 30;
    }

    if (
      /\b(?:inclua|acrescente|troque|reduza|mantenha|escolha|repita|combine|deixe|priorize)\b/i.test(
        content,
      )
    ) {
      score += 30;
    }

    if (
      /\b(?:proteina|proteína|vegetal|fibra|agua|água|fruta|ovos?|frango|peixe|tofu|leguminosas?)\b/i.test(
        content,
      )
    ) {
      score += 15;
    }

    if (
      /\b(?:proxima refeicao|próxima refeição|hoje|amanha|amanhã)\b/i.test(
        content,
      )
    ) {
      score += 10;
    }

    return this.clamp(score);
  }

  private clarity(content: string): number {
    if (!content) {
      return 0;
    }

    let score = 40;
    const lines = content.split('\n').filter((line) => line.trim());
    const sentences = content
      .split(/[.!?]\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const averageSentenceLength =
      sentences.length === 0
        ? content.length
        : sentences.reduce((sum, sentence) => sum + sentence.length, 0) /
          sentences.length;

    if (lines.length >= 5) {
      score += 20;
    }

    if (
      /observacao da refeicao|observação da refeição|impacto no seu objetivo|recomendacao pratica|recomendação prática/i.test(
        content,
      )
    ) {
      score += 25;
    }

    if (averageSentenceLength <= 180) {
      score += 15;
    } else if (averageSentenceLength > 300) {
      score -= 20;
    }

    return this.clamp(score);
  }

  private lengthScore(length: number): number {
    if (length >= 120 && length <= 1_800) {
      return 100;
    }

    if (length <= 2_500) {
      return 75;
    }

    if (length <= 4_000) {
      return 40;
    }

    return 10;
  }

  private isGeneric(content: string): boolean {
    const generic =
      /^(?:refeicao identificada|refeição identificada|boa refeicao|boa refeição|continue assim)[.!]?$/i;

    return content.length < 120 || generic.test(content.trim());
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
