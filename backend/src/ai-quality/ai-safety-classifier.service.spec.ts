import { AIResponseRiskLevel } from '@prisma/client';
import { AISafetyClassifierService } from './ai-safety-classifier.service';
import { AI_SAFETY_FLAG } from './interfaces/ai-quality.interface';

describe('AISafetyClassifierService', () => {
  const service = new AISafetyClassifierService();

  it('keeps general nutrition guidance at low risk', () => {
    const result = service.classify(
      'Inclua uma fonte de proteína e vegetais na próxima refeição, respeitando sua fome.',
    );

    expect(result).toEqual({
      safetyScore: 100,
      riskLevel: AIResponseRiskLevel.LOW,
      flags: [],
      criticalFlags: [],
    });
  });

  it('blocks cure promises, diagnoses and medical prescriptions', () => {
    const result = service.classify(
      'Você tem diabetes. Tome 20 mg deste medicamento porque ele garante a cura da doença.',
    );

    expect(result.riskLevel).toBe(AIResponseRiskLevel.BLOCKED);
    expect(result.safetyScore).toBe(0);
    expect(result.flags).toEqual(
      expect.arrayContaining([
        AI_SAFETY_FLAG.CURE_PROMISE,
        AI_SAFETY_FLAG.MEDICAL_DIAGNOSIS,
        AI_SAFETY_FLAG.MEDICAL_PRESCRIPTION,
      ]),
    );
  });

  it('classifies extreme fasting and aggressive weight loss as high risk', () => {
    const result = service.classify(
      'Faça jejum por 72 horas para perder 4 kg em uma semana.',
    );

    expect(result.riskLevel).toBe(AIResponseRiskLevel.HIGH);
    expect(result.flags).toEqual(
      expect.arrayContaining([
        AI_SAFETY_FLAG.EXTREME_FASTING,
        AI_SAFETY_FLAG.AGGRESSIVE_WEIGHT_LOSS,
      ]),
    );
  });

  it('requires a professional warning when clinical topics are mentioned', () => {
    const unsafe = service.classify(
      'Diabetes pode ser tratada mudando apenas sua alimentação.',
    );
    const safe = service.classify(
      'Para diabetes, estas são orientações gerais e o acompanhamento médico ou nutricionista é necessário.',
    );

    expect(unsafe.flags).toContain(AI_SAFETY_FLAG.MISSING_PROFESSIONAL_WARNING);
    expect(safe.flags).not.toContain(
      AI_SAFETY_FLAG.MISSING_PROFESSIONAL_WARNING,
    );
  });
});
