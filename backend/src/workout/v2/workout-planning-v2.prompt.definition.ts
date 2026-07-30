import type { Prisma } from '@prisma/client';
import type { OpenAIJsonSchema } from '../../ai/interfaces/openai.interface';

export const WORKOUT_PLANNING_V2_PROMPT = Object.freeze({
  name: 'workout_planning_v2',
  version: 1,
  capability: 'WORKOUT_PLANNING_V2',
  model: 'TEXT' as const,
  instructions: `Você preenche um artefato estruturado de treino usando exclusivamente o contexto e a estratégia autorizados.
Não altere artefato, modalidade, objetivo, frequência, duração, ambiente, equipamentos, limitações, intensidade ou progressão definidos na estratégia.
Todo exercício deve declarar source MODEL_GENERATED. Não alegue catálogo canônico.
Não invente carga, 1RM, pace, frequência cardíaca máxima, potência, FTP ou zonas precisas. Use esforço percebido e ritmo conversacional quando autorizado.
Não inclua equipamento fora de authorizedEquipment. Não inclua movimento conflitante com appliedConstraints.
Iniciantes não podem receber movimentos técnicos avançados, intensidade alta ou progressão agressiva.
Corrida inicial deve alternar corrida e caminhada quando adequado, sem exigir pace. Ciclismo sem métricas usa esforço percebido. CrossFit iniciante exige escala e movimentos simples.
Não diagnostique, não trate dor, não prescreva reabilitação e não substitua avaliação profissional.
Retorne somente JSON válido no schema solicitado.`,
  schema: Object.freeze({
    name: 'workout_plan_v2_candidate',
    description:
      'Candidato multimodal estruturado do Workout Planning Engine V2.',
    schema: {
      type: 'object',
      properties: {
        artifactType: {
          type: 'string',
          enum: [
            'POINT_GUIDANCE',
            'SINGLE_SESSION',
            'WEEKLY_PLAN',
            'PLAN_REVIEW',
            'PLAN_ADAPTATION',
            'EXERCISE_SUBSTITUTION',
            'CURRENT_PLAN_PRESENTATION',
            'ACTIVE_RECOVERY_SESSION',
            'MOBILITY_SESSION',
          ],
        },
        modality: {
          type: 'string',
          enum: [
            'GYM_STRENGTH',
            'HOME_WORKOUT',
            'OUTDOOR_WORKOUT',
            'CALISTHENICS',
            'FUNCTIONAL',
            'CROSSFIT',
            'RUNNING',
            'WALKING',
            'CYCLING',
            'MOBILITY',
            'CARDIO_CONDITIONING',
            'ACTIVE_RECOVERY',
            'GENERAL_FITNESS',
          ],
        },
        objective: {
          type: 'string',
          enum: [
            'WEIGHT_LOSS',
            'HYPERTROPHY',
            'STRENGTH',
            'CONDITIONING',
            'GENERAL_HEALTH',
            'MOBILITY',
            'ACTIVE_RECOVERY',
            'COMPLETE_DISTANCE',
          ],
        },
        title: { type: 'string' },
        sessions: { type: 'array', items: { type: 'object' } },
        progression: { type: 'array', items: { type: 'object' } },
        substitutions: { type: 'array', items: { type: 'object' } },
        adaptationRules: { type: 'array', items: { type: 'string' } },
        safetyFlags: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'artifactType',
        'modality',
        'objective',
        'title',
        'sessions',
        'progression',
        'substitutions',
        'adaptationRules',
        'safetyFlags',
      ],
      additionalProperties: false,
    },
  } satisfies OpenAIJsonSchema & Prisma.InputJsonObject),
});
