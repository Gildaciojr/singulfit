import { Prisma } from '@prisma/client';

const nullableText = Object.freeze({
  type: Object.freeze(['string', 'null']),
});

export const COACH_CONVERSATIONAL_QA_V1_PROMPT = Object.freeze({
  name: 'coach_conversational_qa_v1',
  version: 1,
  capability: 'COACH_CONVERSATIONAL_QA',
  model: 'TEXT',
  instructions:
    'Você é o coach conversacional da SingulFit. Responda em português brasileiro usando somente fatos canônicos fornecidos, contexto humano autorizado e conhecimento geral não clínico. Diferencie fato do plano atual, conhecimento geral e aproximação; aproximações devem ser explícitas e fatos canônicos prevalecem. Nunca invente conteúdo do plano atual e preserve como ausente um plano marcado ABSENT ou UNAVAILABLE. Resolva pronomes e referências somente com recentConversation e o contexto fornecido; se a referência continuar incerta, retorne CLARIFY. Orientação pontual nunca altera estado persistido. Se o pedido exigir criar, regenerar, atualizar ou persistir plano, objetivo ou perfil, retorne DEFER_TO_SIDE_EFFECT_PIPELINE sem executar nem afirmar a mudança. Não diagnostique, não prescreva tratamento e não produza uma meta clínica rígida de hidratação sem contexto apropriado. Use SAFE_RESPONSE somente como cautela adicional; ela não substitui nem contorna a rota determinística de sinais graves. Retorne somente JSON válido no schema.',
  schema: Object.freeze({
    name: 'coach_conversational_qa_v1',
    description: 'Resposta conversacional read-only do coach',
    schema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        disposition: Object.freeze({
          type: 'string',
          enum: Object.freeze([
            'ANSWER',
            'CLARIFY',
            'DEFER_TO_SIDE_EFFECT_PIPELINE',
            'SAFE_RESPONSE',
          ]),
        }),
        domain: Object.freeze({
          type: 'string',
          enum: Object.freeze(['NUTRITION', 'WORKOUT', 'PROGRESS', 'GENERAL']),
        }),
        answer: nullableText,
        followUpQuestion: nullableText,
        grounding: Object.freeze({
          type: 'string',
          enum: Object.freeze([
            'CURRENT_PLAN',
            'PROFILE',
            'RECENT_CONTEXT',
            'GENERAL_KNOWLEDGE',
            'MIXED',
          ]),
        }),
        confidence: Object.freeze({
          type: 'string',
          enum: Object.freeze(['HIGH', 'MEDIUM', 'LOW']),
        }),
      }),
      required: Object.freeze([
        'disposition',
        'domain',
        'answer',
        'followUpQuestion',
        'grounding',
        'confidence',
      ]),
      additionalProperties: false,
    }),
  }),
});

export const COACH_CONVERSATIONAL_QA_V1_PROMPT_SEED = Object.freeze({
  ...COACH_CONVERSATIONAL_QA_V1_PROMPT,
  schema: COACH_CONVERSATIONAL_QA_V1_PROMPT.schema as Prisma.InputJsonValue,
});
