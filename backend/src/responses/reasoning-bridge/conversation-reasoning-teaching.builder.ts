import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningStrategyEvidence,
  ConversationReasoningTeachingEvidence,
  ConversationReasoningTeachingTopic,
} from './conversation-reasoning-bridge.contract';

const TOPICS: readonly {
  readonly match: string;
  readonly topic: ConversationReasoningTeachingTopic;
  readonly purpose: string;
}[] = Object.freeze([
  {
    match: 'proteína',
    topic: 'proteína',
    purpose:
      'explicar como a distribuição proteica apoia saciedade e recuperação',
  },
  {
    match: 'hidratação',
    topic: 'hidratação',
    purpose: 'explicar como a regularidade hídrica apoia o dia e o treino',
  },
  {
    match: 'energia para o treino',
    topic: 'energia para o treino',
    purpose: 'explicar como energia disponível influencia desempenho',
  },
  {
    match: 'recuperação',
    topic: 'recuperação',
    purpose: 'explicar por que recuperação também faz parte da progressão',
  },
  {
    match: 'saciedade',
    topic: 'fibras e saciedade',
    purpose: 'explicar como estrutura e fibras ajudam na saciedade',
  },
  {
    match: 'aderência',
    topic: 'regularidade',
    purpose:
      'explicar por que uma ação repetível vale mais que um ajuste perfeito',
  },
  {
    match: 'prática',
    topic: 'escolhas práticas',
    purpose: 'ensinar a simplificar escolhas sem perder o objetivo',
  },
  {
    match: 'técnica',
    topic: 'técnica de treino',
    purpose: 'explicar por que a execução vem antes do aumento de intensidade',
  },
  {
    match: 'progressão',
    topic: 'progressão de treino',
    purpose: 'explicar como evoluir uma variável por vez',
  },
  {
    match: 'consistência',
    topic: 'consistência',
    purpose: 'explicar como regularidade sustenta resultado no longo prazo',
  },
]);

export class ConversationReasoningTeachingBuilder {
  build(
    input: ConversationReasoningBridgeInput,
    strategies: readonly ConversationReasoningStrategyEvidence[],
  ): readonly ConversationReasoningTeachingEvidence[] {
    const taught = new Set(input.previouslyTaughtTopics ?? []);
    const found = new Map<
      ConversationReasoningTeachingTopic,
      ConversationReasoningTeachingEvidence
    >();
    for (const strategy of strategies) {
      const normalized =
        `${strategy.name} ${strategy.purpose}`.toLocaleLowerCase('pt-BR');
      const definition = TOPICS.find((item) => normalized.includes(item.match));
      if (!definition || taught.has(definition.topic)) continue;
      found.set(
        definition.topic,
        Object.freeze({ topic: definition.topic, purpose: definition.purpose }),
      );
    }
    return Object.freeze([...found.values()].slice(0, 3));
  }
}
