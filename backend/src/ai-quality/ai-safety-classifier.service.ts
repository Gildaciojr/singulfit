import { Injectable } from '@nestjs/common';
import { AIResponseRiskLevel } from '@prisma/client';
import {
  AISafetyFlag,
  AISafetyResult,
  AI_SAFETY_FLAG,
} from './interfaces/ai-quality.interface';

const CRITICAL_FLAGS = new Set<AISafetyFlag>([
  AI_SAFETY_FLAG.CURE_PROMISE,
  AI_SAFETY_FLAG.MEDICAL_DIAGNOSIS,
  AI_SAFETY_FLAG.MEDICAL_PRESCRIPTION,
  AI_SAFETY_FLAG.DANGEROUS_LANGUAGE,
]);

const HIGH_RISK_FLAGS = new Set<AISafetyFlag>([
  AI_SAFETY_FLAG.EXTREME_DIET,
  AI_SAFETY_FLAG.EXTREME_FASTING,
  AI_SAFETY_FLAG.AGGRESSIVE_WEIGHT_LOSS,
  AI_SAFETY_FLAG.MISSING_PROFESSIONAL_WARNING,
]);

@Injectable()
export class AISafetyClassifierService {
  classify(content: string): AISafetyResult {
    const normalized = this.normalize(content);
    const flags = new Set<AISafetyFlag>();

    if (
      /\b(?:cura|curar|elimina|eliminar|reverte|reverter)\b.{0,60}\b(?:diabetes|cancer|câncer|hipertensao|hipertensão|obesidade|doenca|doença)\b/i.test(
        normalized,
      ) ||
      /\bgarant(?:e|imos|ido)\b.{0,30}\bcura\b/i.test(normalized)
    ) {
      flags.add(AI_SAFETY_FLAG.CURE_PROMISE);
    }

    if (
      /\b(?:voce|você|isso|seus sintomas?)\b.{0,25}\b(?:tem|indicam?|confirmam?|significam?|esta com|está com)\b.{0,40}\b(?:diabetes|cancer|câncer|hipertensao|hipertensão|anemia|transtorno|doenca|doença)\b/i.test(
        normalized,
      )
    ) {
      flags.add(AI_SAFETY_FLAG.MEDICAL_DIAGNOSIS);
    }

    if (
      /\b(?:tome|tomar|use|usar|inicie|comece|aumente|reduza|suspenda|pare de tomar)\b.{0,50}\b(?:medicamento|remedio|remédio|dose|mg|insulina|antidepressivo|antibiotico|antibiótico|laxante)\b/i.test(
        normalized,
      ) ||
      /\bprescrev(?:o|emos|er)\b/i.test(normalized)
    ) {
      flags.add(AI_SAFETY_FLAG.MEDICAL_PRESCRIPTION);
    }

    if (
      /\b(?:dieta|consuma|coma)\b.{0,40}\b(?:[1-7]\d{2}|[1-6]\d{2})\s*(?:kcal|calorias)\b/i.test(
        normalized,
      ) ||
      /\b(?:coma|consuma)\b.{0,30}\b(?:somente|apenas)\b.{0,30}\b(?:um alimento|agua|água|liquidos|líquidos)\b/i.test(
        normalized,
      )
    ) {
      flags.add(AI_SAFETY_FLAG.EXTREME_DIET);
    }

    if (
      /\bjejum\b.{0,35}\b(?:4[8-9]|[5-9]\d|\d{3,})\s*(?:h|horas)\b/i.test(
        normalized,
      ) ||
      /\b(?:fique|ficar|passe|passar)\b.{0,25}\b(?:dias?|mais de um dia)\b.{0,25}\bsem comer\b/i.test(
        normalized,
      )
    ) {
      flags.add(AI_SAFETY_FLAG.EXTREME_FASTING);
    }

    if (
      /\b(?:perca|perder|emagreca|emagreça)\b.{0,25}\b(?:[2-9]|\d{2,})(?:[,.]\d+)?\s*kg\b.{0,20}\b(?:semana|7 dias)\b/i.test(
        normalized,
      )
    ) {
      flags.add(AI_SAFETY_FLAG.AGGRESSIVE_WEIGHT_LOSS);
    }

    if (
      /\b(?:provoque|induzir|induza)\b.{0,20}\bvomito\b/i.test(normalized) ||
      /\b(?:nao coma|não coma|pare de comer|evite toda comida)\b/i.test(
        normalized,
      ) ||
      /\b(?:ignore|desconsidere)\b.{0,25}\b(?:sintomas?|dor|desmaio|tontura)\b/i.test(
        normalized,
      ) ||
      /\b(?:use|tome)\b.{0,25}\blaxante\b.{0,25}\b(?:emagrecer|perder peso)\b/i.test(
        normalized,
      )
    ) {
      flags.add(AI_SAFETY_FLAG.DANGEROUS_LANGUAGE);
    }

    const hasClinicalTopic =
      /\b(?:doenca|doença|diabetes|cancer|câncer|hipertensao|hipertensão|medicamento|remedio|remédio|diagnostico|diagnóstico|tratamento)\b/i.test(
        normalized,
      );
    const hasProfessionalWarning =
      /\b(?:medico|médico|nutricionista|profissional de saude|profissional de saúde|acompanhamento profissional|orientacao geral|orientação geral|nao substitui|não substitui)\b/i.test(
        normalized,
      );

    if (hasClinicalTopic && !hasProfessionalWarning) {
      flags.add(AI_SAFETY_FLAG.MISSING_PROFESSIONAL_WARNING);
    }

    const hasNutritionScope =
      /\b(?:alimentacao|alimentação|refeicao|refeição|nutri|proteina|proteína|fibra|vegetais?|agua|água|habito|hábito|calorias?|carboidrato|gordura|saude|saúde)\b/i.test(
        normalized,
      );
    const hasForeignScope =
      /\b(?:bitcoin|investimento|acao judicial|ação judicial|processo judicial|codigo fonte|código fonte|programacao|programação|arma|explosivo)\b/i.test(
        normalized,
      );

    if (hasForeignScope && !hasNutritionScope) {
      flags.add(AI_SAFETY_FLAG.OUT_OF_SCOPE);
    }

    const flagList = [...flags];
    const criticalFlags = flagList.filter((flag) => CRITICAL_FLAGS.has(flag));
    const safetyScore = this.score(flagList);
    const riskLevel = this.risk(flagList, criticalFlags, safetyScore);

    return {
      safetyScore,
      riskLevel,
      flags: flagList,
      criticalFlags,
    };
  }

  private score(flags: AISafetyFlag[]): number {
    const penalties: Record<AISafetyFlag, number> = {
      [AI_SAFETY_FLAG.CURE_PROMISE]: 65,
      [AI_SAFETY_FLAG.MEDICAL_DIAGNOSIS]: 65,
      [AI_SAFETY_FLAG.MEDICAL_PRESCRIPTION]: 65,
      [AI_SAFETY_FLAG.EXTREME_DIET]: 45,
      [AI_SAFETY_FLAG.EXTREME_FASTING]: 50,
      [AI_SAFETY_FLAG.AGGRESSIVE_WEIGHT_LOSS]: 45,
      [AI_SAFETY_FLAG.DANGEROUS_LANGUAGE]: 75,
      [AI_SAFETY_FLAG.MISSING_PROFESSIONAL_WARNING]: 35,
      [AI_SAFETY_FLAG.OUT_OF_SCOPE]: 25,
    };

    return Math.max(
      0,
      100 - flags.reduce((total, flag) => total + penalties[flag], 0),
    );
  }

  private risk(
    flags: AISafetyFlag[],
    criticalFlags: AISafetyFlag[],
    safetyScore: number,
  ): AIResponseRiskLevel {
    if (criticalFlags.length > 0) {
      return AIResponseRiskLevel.BLOCKED;
    }

    if (flags.some((flag) => HIGH_RISK_FLAGS.has(flag)) || safetyScore < 70) {
      return AIResponseRiskLevel.HIGH;
    }

    if (flags.length > 0) {
      return AIResponseRiskLevel.MEDIUM;
    }

    return AIResponseRiskLevel.LOW;
  }

  private normalize(content: string): string {
    return content
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20_000);
  }
}
