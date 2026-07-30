import type { ConversationCorpusScenario } from './conversation-offline-corpus.contract';
import type {
  ConversationCentralIntent,
  ConversationDialogueProfile,
} from './conversation-composition.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type {
  SanitizedConversationDecision,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';
import { DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE } from './nutrition-conversation-coach-style.engine';
import type { NutritionConversationCoachStyle } from './nutrition-conversation-coach-style.contract';

const payload: SanitizedConversationPayload = {
  facts: {
    allowed: [
      {
        key: 'MEAL_TOTAL_CALORIES',
        source: 'MEAL_ANALYSIS',
        value: 420,
        estimated: true,
      },
    ],
    sensitive: [],
    disclaimerRequired: ['MEAL_TOTAL_CALORIES'],
  },
  selectedDecisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
  structure: {
    dialogueProfile: 'ACKNOWLEDGE_AND_ADJUST',
    centralIntent: 'ADJUST',
    blocks: [
      {
        key: 'response',
        type: 'DIRECT_ANSWER',
        decisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        facts: ['MEAL_TOTAL_CALORIES'],
        order: 0,
        paragraph: 0,
        presentation: 'PROSE',
        required: true,
        maximumLength: 180,
      },
    ],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'FAST',
    presentation: 'PROSE',
    paragraphCount: 1,
  },
  style: {
    coach: DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
    communication: 'BALANCED',
    coaching: 'MOTIVATIONAL',
    tone: 'MODERATE',
    motivationFocus: 'HEALTH',
    stageOfChange: 'ACTION',
  },
  limits: {
    maximumLength: 180,
    maximumEmojiCount: 0,
    maximumQuestions: 0,
    maximumActions: 1,
    maximumFacts: 7,
    maximumBlocks: 4,
    maximumParagraphs: 3,
  },
  policies: {
    estimateQualificationRequired: true,
    emojiAllowed: false,
    closingRequirement: 'OPTIONAL',
  },
};

const deepPayload: SanitizedConversationPayload = {
  ...payload,
  structure: { ...payload.structure, depth: 'DEEP', density: 'HIGH' },
};

const PROFILE_SETTINGS: Readonly<
  Record<
    ConversationDialogueProfile,
    Pick<SanitizedConversationPayload, 'structure' | 'limits' | 'policies'>
  >
> = Object.freeze({
  ACKNOWLEDGE_ONLY: profileSettings('BRIEF', 'LOW', 'WARM', 360, 3, 2, 0, 0),
  ACKNOWLEDGE_AND_ADJUST: profileSettings(
    'MODERATE',
    'MEDIUM',
    'PROGRESSIVE',
    560,
    4,
    3,
    0,
    1,
  ),
  REFLECT_AND_ASK: profileSettings(
    'BRIEF',
    'LOW',
    'DELIBERATIVE',
    480,
    4,
    3,
    1,
    0,
    'PROHIBITED',
  ),
  TEACH_BRIEFLY: profileSettings(
    'BRIEF',
    'MEDIUM',
    'EXPLANATORY',
    520,
    4,
    3,
    0,
    0,
  ),
  RECOVERY: profileSettings('BRIEF', 'LOW', 'WARM', 480, 4, 3, 0, 1),
  CELEBRATE: profileSettings('BRIEF', 'LOW', 'WARM', 380, 3, 2, 0, 0),
  DETAILED_ANALYSIS: profileSettings(
    'DEEP',
    'HIGH',
    'EXPLANATORY',
    1200,
    7,
    6,
    1,
    1,
  ),
  CLARIFY_BEFORE_ANALYSIS: profileSettings(
    'MINIMAL',
    'LOW',
    'FAST',
    320,
    3,
    2,
    1,
    0,
    'PROHIBITED',
  ),
  REASSURE_AND_SIMPLIFY: profileSettings(
    'MINIMAL',
    'LOW',
    'WARM',
    400,
    3,
    3,
    0,
    1,
    'REQUIRED',
  ),
  CONTINUITY_CHECK: profileSettings(
    'BRIEF',
    'LOW',
    'PROGRESSIVE',
    460,
    4,
    3,
    1,
    0,
    'PROHIBITED',
  ),
});

function profileSettings(
  depth: SanitizedConversationPayload['structure']['depth'],
  density: SanitizedConversationPayload['structure']['density'],
  rhythm: SanitizedConversationPayload['structure']['rhythm'],
  maximumLength: number,
  maximumBlocks: number,
  maximumParagraphs: number,
  maximumQuestions: number,
  maximumActions: number,
  closingRequirement: SanitizedConversationPayload['policies']['closingRequirement'] = 'OPTIONAL',
): Pick<SanitizedConversationPayload, 'structure' | 'limits' | 'policies'> {
  return {
    structure: {
      dialogueProfile: 'ACKNOWLEDGE_ONLY',
      centralIntent: 'RECOGNIZE',
      blocks: [],
      depth,
      density,
      rhythm,
      presentation: 'PROSE',
      paragraphCount: 1,
    },
    limits: {
      maximumLength,
      maximumEmojiCount: 0,
      maximumQuestions,
      maximumActions,
      maximumFacts: 7,
      maximumBlocks,
      maximumParagraphs,
    },
    policies: {
      estimateQualificationRequired: false,
      emojiAllowed: false,
      closingRequirement,
    },
  };
}

function profilePayload(
  profile: ConversationDialogueProfile,
  centralIntent: ConversationCentralIntent,
  decisions: readonly SanitizedConversationDecision[],
): SanitizedConversationPayload {
  const settings = PROFILE_SETTINGS[profile];
  return Object.freeze({
    ...payload,
    selectedDecisions: Object.freeze([...decisions]),
    structure: Object.freeze({
      ...settings.structure,
      dialogueProfile: profile,
      centralIntent,
      blocks: Object.freeze([
        Object.freeze({
          ...payload.structure.blocks[0],
          key: 'profile-response',
          type: decisions.includes('ASK_QUESTION')
            ? 'CLARIFYING_QUESTION'
            : 'PRIMARY_OBSERVATION',
          decisions: Object.freeze([...decisions]),
          maximumLength: settings.limits.maximumLength,
        }),
      ]),
    }),
    limits: Object.freeze({ ...settings.limits }),
    policies: Object.freeze({ ...settings.policies }),
    facts: Object.freeze({
      ...payload.facts,
      disclaimerRequired: Object.freeze([]),
    }),
  });
}

function profileCandidate(
  decisions: readonly SanitizedConversationDecision[],
  text: string,
): LanguageRealizationResult {
  const question = decisions.includes('ASK_QUESTION');
  const closing = decisions.includes('CLOSE_WITHOUT_QUESTION');
  const recommendation = decisions.includes('PROVIDE_RECOMMENDATION');
  const episodicDecisions: readonly SanitizedConversationDecision[] = [
    'FOLLOW_UP_EPISODE',
    'CONTINUE_STRATEGY',
    'CHECK_COMMITMENT',
    'RECALL_SUCCESS',
    'RECALL_SETBACK',
    'RECALL_DIFFICULTY',
    'RECALL_GOAL',
  ];
  const usesEpisodicMemory = episodicDecisions.some((decision) =>
    decisions.includes(decision),
  );
  const numbers = decisions.includes('SHOW_CALORIES') ? [420] : [];
  return candidate({
    candidateText: text,
    realizedUnits: [
      {
        blockKey: 'profile-response',
        unitType: question ? 'QUESTION' : closing ? 'CLOSING' : 'FACTUAL',
        decisionCodes: Object.freeze([...decisions]),
        factKeys: ['MEAL_TOTAL_CALORIES'],
        text,
        claims: {
          numbers: Object.freeze(numbers),
          foods: [],
          usesMemory:
            decisions.includes('FOLLOW_UP_COMMITMENT') || usesEpisodicMemory,
          usesRecommendation: recommendation,
        },
      },
    ],
    realizedFacts: ['MEAL_TOTAL_CALORIES'],
    realizedDecisions: Object.freeze([...decisions]),
    disclaimerRealized: false,
    questionRealized: question,
    closingRealized: closing,
    producedLength: Array.from(text).length,
    producedQuestionCount: question ? 1 : 0,
  });
}

function candidate(
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  return {
    id: 'synthetic-candidate',
    sanitizedPayloadReference: 'sanitized-payload:synthetic',
    status: 'COMPLETED',
    candidateText:
      'A refeição sintética tem cerca de 420 calorias. Mantenha a próxima escolha equilibrada.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [
      {
        blockKey: 'response',
        unitType: 'FACTUAL',
        decisionCodes: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        factKeys: ['MEAL_TOTAL_CALORIES'],
        text: 'A refeição sintética tem cerca de 420 calorias. Mantenha a próxima escolha equilibrada.',
        claims: {
          numbers: [420],
          foods: ['alimento-sintetico'],
          usesMemory: false,
          usesRecommendation: true,
        },
      },
    ],
    omittedUnits: [],
    realizedFacts: ['MEAL_TOTAL_CALORIES'],
    omittedFacts: [],
    realizedDecisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
    omittedDecisions: [],
    disclaimerRealized: true,
    questionRealized: false,
    closingRealized: false,
    producedLength: 86,
    producedQuestionCount: 0,
    warningCodes: [],
    ...overrides,
  } as LanguageRealizationResult;
}

function scenario(
  id: string,
  tags: readonly string[],
  overrides: Partial<ConversationCorpusScenario> = {},
): ConversationCorpusScenario {
  return Object.freeze({
    id,
    tags: Object.freeze([...tags]),
    golden: false,
    expectedDialogueProfile: 'ACKNOWLEDGE_AND_ADJUST',
    expectedCentralIntent: 'ADJUST',
    userMessage: 'Mensagem sintética sobre refeição.',
    nutritionContext: Object.freeze({ calories: 420, itemCount: 1 }),
    behavioralContext: Object.freeze({
      fatigue: 'LOW',
      preference: 'BALANCED',
    }),
    memory: Object.freeze({ available: false }),
    recommendations: Object.freeze({ action: 'Mantenha equilíbrio.' }),
    longitudinalContext: Object.freeze({ trend: 'STABLE' }),
    expectedLegacyResponse: 'Resposta legada sintética.',
    candidate: candidate(),
    payload,
    expectedFoods: Object.freeze(['alimento-sintetico']),
    expectedRecommendations: Object.freeze(['Mantenha equilíbrio.']),
    incrementalLatencyMs: 10,
    usage: Object.freeze({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    }),
    ...overrides,
  });
}

function dialogueScenario(
  id: string,
  tag: string,
  profile: ConversationDialogueProfile,
  centralIntent: ConversationCentralIntent,
  decisions: readonly SanitizedConversationDecision[],
  text: string,
  golden = false,
): ConversationCorpusScenario {
  const usesRecommendation = decisions.includes('PROVIDE_RECOMMENDATION');
  return scenario(id, ['DIALOGUE_SCENARIO', tag, `PROFILE_${profile}`], {
    golden,
    expectedDialogueProfile: profile,
    expectedCentralIntent: centralIntent,
    payload: profilePayload(profile, centralIntent, decisions),
    candidate: profileCandidate(decisions, text),
    expectedFoods: Object.freeze([]),
    expectedRecommendations: usesRecommendation
      ? Object.freeze(['Ajuste simples.'])
      : Object.freeze([]),
  });
}

function episodicScenario(
  id: string,
  tag: string,
  category: string,
  decision: SanitizedConversationDecision,
  text: string,
  sensitivity: 'STANDARD' | 'SENSITIVE' = 'STANDARD',
): ConversationCorpusScenario {
  const base = dialogueScenario(
    id,
    tag,
    'CONTINUITY_CHECK',
    'FOLLOW_UP',
    ['RESPOND_TO_MEAL', decision, 'ASK_QUESTION'],
    text,
  );
  const factKey = `episodicMemory.${category}`;
  const candidateResult = base.candidate;
  if (!candidateResult) throw new Error('Cenário episódico sem candidata');
  const episodicFact = Object.freeze({
    key: factKey,
    source: 'MEMORY' as const,
    value: Object.freeze({
      category,
      fact: `fato sintético ${tag.toLowerCase()}`,
      relationToContext: 'continuidade sintética atual',
      recallReason: 'FOLLOW_UP_DUE',
    }),
    estimated: false,
  });
  return Object.freeze({
    ...base,
    tags: Object.freeze([...base.tags, 'EPISODIC_MEMORY']),
    memory: Object.freeze({ available: true, category }),
    payload: Object.freeze({
      ...base.payload,
      facts: Object.freeze({
        ...base.payload.facts,
        allowed: Object.freeze(
          sensitivity === 'STANDARD'
            ? [...base.payload.facts.allowed, episodicFact]
            : [...base.payload.facts.allowed],
        ),
        sensitive: Object.freeze(
          sensitivity === 'SENSITIVE'
            ? [...base.payload.facts.sensitive, episodicFact]
            : [...base.payload.facts.sensitive],
        ),
      }),
      structure: Object.freeze({
        ...base.payload.structure,
        blocks: Object.freeze(
          base.payload.structure.blocks.map((block) =>
            Object.freeze({
              ...block,
              facts: Object.freeze([...block.facts, factKey]),
            }),
          ),
        ),
      }),
    }),
    candidate: Object.freeze({
      ...candidateResult,
      realizedUnits: Object.freeze(
        candidateResult.realizedUnits.map((unit) =>
          Object.freeze({
            ...unit,
            factKeys: Object.freeze([...unit.factKeys, factKey]),
            claims: Object.freeze({ ...unit.claims, usesMemory: true }),
          }),
        ),
      ),
      realizedFacts: Object.freeze([...candidateResult.realizedFacts, factKey]),
    }),
    ...(sensitivity === 'SENSITIVE'
      ? { behavioralContext: Object.freeze({ sensitivity }) }
      : {}),
  });
}

type CoachStyleFixtureOverride = Partial<
  Pick<
    NutritionConversationCoachStyle,
    | 'toneStrategy'
    | 'openingStrategy'
    | 'closingStrategy'
    | 'pacing'
    | 'transitionStyle'
    | 'lexicalVariant'
    | 'humor'
  >
>;

interface CoachIdentityFixtureDefinition {
  readonly id: string;
  readonly tags: readonly string[];
  readonly text: string;
  readonly style?: CoachStyleFixtureOverride;
}

function coachIdentityScenario(
  definition: CoachIdentityFixtureDefinition,
  golden: boolean,
): ConversationCorpusScenario {
  const baseCandidate = candidate();
  if (baseCandidate.status !== 'COMPLETED') {
    throw new Error('Fixture de identidade sem candidata completa');
  }
  const base = scenario(
    definition.id,
    Object.freeze([
      'COACH_IDENTITY',
      golden ? 'COACH_IDENTITY_GOLDEN' : 'COACH_IDENTITY_SCENARIO',
      ...definition.tags,
    ]),
    {
      golden,
      userMessage: `Contexto sintético ${definition.id}.`,
      candidate: Object.freeze({
        ...baseCandidate,
        candidateText: definition.text,
        realizedUnits: Object.freeze(
          baseCandidate.realizedUnits.map((unit) =>
            Object.freeze({ ...unit, text: definition.text }),
          ),
        ),
        producedLength: Array.from(definition.text).length,
      }),
    },
  );
  return Object.freeze({
    ...base,
    payload: Object.freeze({
      ...base.payload,
      style: Object.freeze({
        ...base.payload.style,
        coach: Object.freeze({
          ...base.payload.style.coach,
          ...definition.style,
        }),
      }),
    }),
  });
}

const COACH_IDENTITY_SCENARIO_DEFINITIONS: readonly CoachIdentityFixtureDefinition[] =
  Object.freeze([
    {
      id: 'coach-victory-first',
      tags: ['VICTORY', 'NEW_USER'],
      text: 'Esse primeiro avanço mostra que o ajuste foi viável na prática.',
      style: {
        toneStrategy: 'DISCREET_CELEBRATION',
        openingStrategy: 'CELEBRATORY',
        lexicalVariant: 'A',
      },
    },
    {
      id: 'coach-victory-consistency',
      tags: ['VICTORY', 'HIGH_ADHERENCE'],
      text: 'A repetição desse cuidado é o que dá consistência ao resultado.',
      style: { toneStrategy: 'PROGRESS_REINFORCEMENT', lexicalVariant: 'B' },
    },
    {
      id: 'coach-victory-big',
      tags: ['VICTORY', 'EXCELLENT_DAY'],
      text: 'A evolução ficou clara, principalmente porque o padrão se manteve.',
      style: { toneStrategy: 'PROGRESS_REINFORCEMENT', lexicalVariant: 'C' },
    },
    {
      id: 'coach-relapse-isolated',
      tags: ['SETBACK', 'BAD_DAY'],
      text: 'Uma ocorrência isolada não desfaz o processo; vale retomar pelo próximo passo possível.',
      style: {
        toneStrategy: 'CALM_RECOVERY',
        openingStrategy: 'VALIDATING',
        pacing: 'SUPPORTIVE',
      },
    },
    {
      id: 'coach-relapse-recurrent',
      tags: ['SETBACK', 'LOW_ADHERENCE'],
      text: 'Como esse padrão voltou, faz sentido reduzir o ajuste até ele caber na rotina.',
      style: { toneStrategy: 'CALM_RECOVERY', pacing: 'SUPPORTIVE' },
    },
    {
      id: 'coach-plateau-short',
      tags: ['PLATEAU', 'OBJECTIVE_USER'],
      text: 'A estabilidade não exige pressa; um ajuste pequeno já permite testar a próxima direção.',
      style: { toneStrategy: 'PLATEAU_REASSURANCE', pacing: 'DIRECT' },
    },
    {
      id: 'coach-plateau-long',
      tags: ['PLATEAU', 'DETAIL_REQUEST'],
      text: 'O ritmo ficou estável por mais tempo, então o melhor é revisar uma variável por vez e observar a resposta.',
      style: { toneStrategy: 'PLATEAU_REASSURANCE', pacing: 'EXPLANATORY' },
    },
    {
      id: 'coach-irritated-direct',
      tags: ['IRRITATED_USER', 'OBJECTIVE_USER'],
      text: 'Vou direto ao ponto: há um ajuste útil e ele pode ser feito sem complicar a refeição.',
      style: {
        toneStrategy: 'SUPPORTIVE_CORRECTION',
        openingStrategy: 'DIRECT',
        pacing: 'DIRECT',
      },
    },
    {
      id: 'coach-insecure-clarify',
      tags: ['INSECURE_USER', 'CLARIFICATION'],
      text: 'Antes de concluir, falta confirmar um detalhe da porção.',
      style: {
        toneStrategy: 'CALM_OBJECTIVE',
        openingStrategy: 'VALIDATING',
        pacing: 'COMPACT',
      },
    },
    {
      id: 'coach-curious-why',
      tags: ['CURIOUS_USER', 'DETAIL_REQUEST'],
      text: 'O ponto central é como a combinação dos alimentos muda a saciedade ao longo do dia.',
      style: { toneStrategy: 'CURIOUS_EXPLANATION', pacing: 'EXPLANATORY' },
    },
    {
      id: 'coach-objective-short',
      tags: ['OBJECTIVE_USER', 'SHORT_RESPONSE'],
      text: 'A refeição ficou adequada; o único ajuste útil é manter o equilíbrio na próxima.',
      style: { openingStrategy: 'DIRECT', pacing: 'DIRECT' },
    },
    {
      id: 'coach-old-user-continuity',
      tags: ['OLD_USER', 'CONTINUITY'],
      text: 'Na conversa anterior, esse formato já tinha funcionado; vale observar se continuou prático.',
      style: {
        openingStrategy: 'CONTINUITY',
        closingStrategy: 'REFLECTIVE',
        transitionStyle: 'CONTINUITY',
      },
    },
    {
      id: 'coach-new-user-context',
      tags: ['NEW_USER', 'NO_MEMORY'],
      text: 'Este registro já dá uma base objetiva para os próximos ajustes.',
      style: { openingStrategy: 'CONTEXTUAL', closingStrategy: 'AUTONOMY' },
    },
    {
      id: 'coach-return-after-absence',
      tags: ['RETURN', 'CONTINUITY'],
      text: 'A retomada começa por reconhecer o que é viável agora, sem tentar compensar o intervalo.',
      style: {
        toneStrategy: 'CALM_RECOVERY',
        openingStrategy: 'VALIDATING',
        pacing: 'SUPPORTIVE',
      },
    },
    {
      id: 'coach-difficult-day',
      tags: ['BAD_DAY', 'FATIGUE'],
      text: 'Hoje basta preservar o essencial e deixar o próximo ajuste simples.',
      style: {
        toneStrategy: 'CALM_RECOVERY',
        pacing: 'COMPACT',
        closingStrategy: 'GROUNDING',
      },
    },
    {
      id: 'coach-excellent-day',
      tags: ['EXCELLENT_DAY', 'VICTORY'],
      text: 'O dia reuniu escolhas consistentes, e esse conjunto explica o avanço observado.',
      style: {
        toneStrategy: 'PROGRESS_REINFORCEMENT',
        openingStrategy: 'CELEBRATORY',
      },
    },
    {
      id: 'coach-high-fatigue',
      tags: ['FATIGUE', 'SHORT_RESPONSE'],
      text: 'Vamos manter só um passo simples por agora.',
      style: {
        pacing: 'COMPACT',
        closingStrategy: 'GROUNDING',
        humor: 'PROHIBITED',
      },
    },
    {
      id: 'coach-low-adherence',
      tags: ['LOW_ADHERENCE', 'SETBACK'],
      text: 'O plano precisa caber melhor na rotina; reduzir a exigência torna a retomada mais realista.',
      style: { toneStrategy: 'SUPPORTIVE_CORRECTION', pacing: 'SUPPORTIVE' },
    },
    {
      id: 'coach-high-adherence',
      tags: ['HIGH_ADHERENCE', 'VICTORY'],
      text: 'A adesão se manteve, e isso dá mais confiança para preservar a estratégia.',
      style: { toneStrategy: 'PROGRESS_REINFORCEMENT', lexicalVariant: 'D' },
    },
    {
      id: 'coach-repeated-question',
      tags: ['REPEATED_QUESTION', 'CURIOUS_USER'],
      text: 'A dúvida continua válida; desta vez, vou separar apenas a parte que ainda não ficou clara.',
      style: {
        toneStrategy: 'CURIOUS_EXPLANATION',
        openingStrategy: 'CONTEXTUAL',
      },
    },
    {
      id: 'coach-detail-request',
      tags: ['DETAIL_REQUEST', 'COMPLEX'],
      text: 'Há três relações importantes aqui, mas elas podem ser entendidas em uma sequência simples.',
      style: {
        toneStrategy: 'CURIOUS_EXPLANATION',
        pacing: 'EXPLANATORY',
        transitionStyle: 'LOGICAL',
      },
    },
    {
      id: 'coach-comparison-improving',
      tags: ['COMPARISON', 'VICTORY'],
      text: 'Em comparação com os registros anteriores, a melhora veio da maior regularidade.',
      style: {
        toneStrategy: 'PROGRESS_REINFORCEMENT',
        openingStrategy: 'CONTEXTUAL',
      },
    },
    {
      id: 'coach-comparison-stable',
      tags: ['COMPARISON', 'PLATEAU'],
      text: 'A comparação mostra estabilidade, então ainda não há motivo para fazer várias mudanças ao mesmo tempo.',
      style: { toneStrategy: 'PLATEAU_REASSURANCE', pacing: 'BALANCED' },
    },
    {
      id: 'coach-gentle-correction',
      tags: ['CORRECTION', 'EMPATHY'],
      text: 'A base está útil; falta apenas um ajuste para a refeição sustentar melhor o objetivo.',
      style: {
        toneStrategy: 'SUPPORTIVE_CORRECTION',
        openingStrategy: 'CONTEXTUAL',
      },
    },
    {
      id: 'coach-specific-correction',
      tags: ['CORRECTION', 'OBJECTIVE_USER'],
      text: 'O ajuste mais relevante está na distribuição, não em aumentar a quantidade total.',
      style: {
        toneStrategy: 'SUPPORTIVE_CORRECTION',
        openingStrategy: 'DIRECT',
        pacing: 'DIRECT',
      },
    },
    {
      id: 'coach-frustration-evidence',
      tags: ['FRUSTRATION', 'EMPATHY'],
      text: 'Como a estratégia não funcionou desta vez, vale simplificar antes de tentar novamente.',
      style: {
        toneStrategy: 'CALM_RECOVERY',
        openingStrategy: 'VALIDATING',
        pacing: 'SUPPORTIVE',
      },
    },
    {
      id: 'coach-routine-return',
      tags: ['RETURN', 'ROUTINE'],
      text: 'Retomar o horário que já era viável pode dar estrutura sem criar uma regra nova.',
      style: { openingStrategy: 'CONTINUITY', transitionStyle: 'CONTINUITY' },
    },
    {
      id: 'coach-goal-focus',
      tags: ['GOAL', 'MOTIVATION'],
      text: 'Esse ajuste importa porque aproxima a refeição do objetivo registrado.',
      style: {
        toneStrategy: 'PROGRESS_REINFORCEMENT',
        closingStrategy: 'AUTONOMY',
      },
    },
    {
      id: 'coach-complete-no-question',
      tags: ['NO_QUESTION', 'OBJECTIVE_USER'],
      text: 'A orientação já está completa e não precisa de outra pergunta agora.',
      style: { closingStrategy: 'NONE', pacing: 'DIRECT' },
    },
    {
      id: 'coach-natural-closing',
      tags: ['CLOSING', 'CONTINUITY'],
      text: 'Por enquanto, preservar esse passo é suficiente.',
      style: { closingStrategy: 'GROUNDING', lexicalVariant: 'C' },
    },
  ]);

const COACH_IDENTITY_GOLDEN_DEFINITIONS: readonly CoachIdentityFixtureDefinition[] =
  Object.freeze([
    {
      id: 'golden-coach-warm-professional',
      tags: ['WARMTH', 'PROFESSIONALISM'],
      text: 'A refeição tem uma base boa, e o próximo ajuste pode ser simples e objetivo.',
      style: { lexicalVariant: 'A' },
    },
    {
      id: 'golden-coach-discreet-win',
      tags: ['VICTORY', 'WARMTH'],
      text: 'A melhora apareceu de forma consistente, e isso merece ser reconhecido com calma.',
      style: {
        toneStrategy: 'DISCREET_CELEBRATION',
        openingStrategy: 'CELEBRATORY',
      },
    },
    {
      id: 'golden-coach-major-progress',
      tags: ['VICTORY', 'COMPARISON'],
      text: 'A evolução ficou mais sólida porque a regularidade aumentou, não por causa de uma escolha isolada.',
      style: {
        toneStrategy: 'PROGRESS_REINFORCEMENT',
        transitionStyle: 'LOGICAL',
      },
    },
    {
      id: 'golden-coach-setback-normalization',
      tags: ['SETBACK', 'EMPATHY'],
      text: 'Esse episódio não apaga o que já foi construído; ele só mostra onde o plano precisa ficar mais viável.',
      style: { toneStrategy: 'CALM_RECOVERY', openingStrategy: 'VALIDATING' },
    },
    {
      id: 'golden-coach-plateau-calm',
      tags: ['PLATEAU', 'PROFESSIONALISM'],
      text: 'A estabilidade pede observação, não pressa; um ajuste controlado produz uma leitura melhor.',
      style: { toneStrategy: 'PLATEAU_REASSURANCE', pacing: 'BALANCED' },
    },
    {
      id: 'golden-coach-irritated-respect',
      tags: ['IRRITATED_USER', 'RESPECT'],
      text: 'Vou ser objetivo e tratar apenas do ajuste que realmente muda a refeição.',
      style: { openingStrategy: 'DIRECT', pacing: 'DIRECT' },
    },
    {
      id: 'golden-coach-uncertainty-humility',
      tags: ['INSECURE_USER', 'HUMILITY'],
      text: 'Com os dados atuais, ainda falta confirmar a porção antes de fechar a análise.',
      style: { openingStrategy: 'VALIDATING', pacing: 'COMPACT' },
    },
    {
      id: 'golden-coach-curiosity-plain',
      tags: ['CURIOUS_USER', 'NATURAL_LANGUAGE'],
      text: 'A diferença está na combinação: ela muda tanto a saciedade quanto a distribuição de energia.',
      style: { toneStrategy: 'CURIOUS_EXPLANATION', pacing: 'EXPLANATORY' },
    },
    {
      id: 'golden-coach-objective-answer',
      tags: ['OBJECTIVE_USER', 'DIRECTNESS'],
      text: 'Está adequado. O ajuste útil é manter uma fonte de proteína na próxima refeição.',
      style: { openingStrategy: 'DIRECT', pacing: 'DIRECT' },
    },
    {
      id: 'golden-coach-memory-natural',
      tags: ['CONTINUITY', 'OLD_USER'],
      text: 'Na última conversa, esse ajuste já parecia viável; agora vale conferir se continuou funcionando.',
      style: { openingStrategy: 'CONTINUITY', transitionStyle: 'CONTINUITY' },
    },
    {
      id: 'golden-coach-new-user',
      tags: ['NEW_USER', 'NO_MEMORY'],
      text: 'Este primeiro registro oferece uma referência clara para acompanhar as próximas escolhas.',
      style: { openingStrategy: 'CONTEXTUAL' },
    },
    {
      id: 'golden-coach-return',
      tags: ['RETURN', 'EMPATHY'],
      text: 'A retomada pode começar pequena; não é necessário compensar o período anterior.',
      style: { toneStrategy: 'CALM_RECOVERY', closingStrategy: 'GROUNDING' },
    },
    {
      id: 'golden-coach-fatigue',
      tags: ['FATIGUE', 'SHORT_RESPONSE'],
      text: 'Hoje, um único passo simples já basta.',
      style: { pacing: 'COMPACT', closingStrategy: 'GROUNDING' },
    },
    {
      id: 'golden-coach-low-adherence',
      tags: ['LOW_ADHERENCE', 'RESPECT'],
      text: 'Se a execução não se sustentou, o plano precisa ficar mais simples, não mais rígido.',
      style: { toneStrategy: 'SUPPORTIVE_CORRECTION', pacing: 'SUPPORTIVE' },
    },
    {
      id: 'golden-coach-high-adherence',
      tags: ['HIGH_ADHERENCE', 'MOTIVATION'],
      text: 'A regularidade já é a evidência mais útil para manter essa direção.',
      style: { toneStrategy: 'PROGRESS_REINFORCEMENT' },
    },
    {
      id: 'golden-coach-repeated-doubt',
      tags: ['REPEATED_QUESTION', 'PATIENCE'],
      text: 'Vamos olhar a mesma dúvida por outro ângulo e separar somente o ponto decisivo.',
      style: { toneStrategy: 'CURIOUS_EXPLANATION', lexicalVariant: 'D' },
    },
    {
      id: 'golden-coach-detailed',
      tags: ['DETAIL_REQUEST', 'PROFESSIONALISM'],
      text: 'Primeiro vem a composição; depois, o efeito no objetivo. Essa ordem evita misturar causas diferentes.',
      style: { pacing: 'EXPLANATORY', transitionStyle: 'LOGICAL' },
    },
    {
      id: 'golden-coach-transition',
      tags: ['TRANSITION', 'NATURAL_LANGUAGE'],
      text: 'A base está equilibrada. A partir daí, o ajuste na distribuição completa a orientação.',
      style: { transitionStyle: 'SEAMLESS', lexicalVariant: 'B' },
    },
    {
      id: 'golden-coach-autonomy',
      tags: ['AUTONOMY', 'RESPECT'],
      text: 'Entre as opções viáveis, faz sentido manter a que se encaixa melhor na sua rotina.',
      style: { closingStrategy: 'AUTONOMY' },
    },
    {
      id: 'golden-coach-natural-closing',
      tags: ['CLOSING', 'NATURAL_LANGUAGE'],
      text: 'Por agora, esse é o passo que merece continuidade.',
      style: { closingStrategy: 'CONTINUITY', lexicalVariant: 'C' },
    },
  ]);

const COACH_IDENTITY_SCENARIOS = Object.freeze(
  COACH_IDENTITY_SCENARIO_DEFINITIONS.map((definition) =>
    coachIdentityScenario(definition, false),
  ),
);

const COACH_IDENTITY_GOLDEN_CASES = Object.freeze(
  COACH_IDENTITY_GOLDEN_DEFINITIONS.map((definition) =>
    coachIdentityScenario(definition, true),
  ),
);

export const NUTRITION_CONVERSATION_OFFLINE_CORPUS: readonly ConversationCorpusScenario[] =
  Object.freeze([
    scenario('adequate-meal', ['ADEQUATE_MEAL']),
    scenario('incomplete-meal', ['INCOMPLETE_MEAL']),
    scenario('excess-meal', ['EXCESS_MEAL']),
    scenario('simple-recommendation', ['SIMPLE_RECOMMENDATION']),
    scenario('limiting-factor', ['LIMITING_FACTOR']),
    scenario('complete-macros', ['COMPLETE_MACROS']),
    scenario('partial-macros', ['PARTIAL_MACROS']),
    scenario('low-confidence', ['LOW_CONFIDENCE']),
    scenario('relevant-memory', ['RELEVANT_MEMORY'], {
      memory: Object.freeze({ available: true, subject: 'synthetic habit' }),
      candidate: candidate({
        realizedUnits: [
          {
            ...candidate().realizedUnits[0],
            claims: {
              ...candidate().realizedUnits[0].claims,
              usesMemory: true,
            },
          },
        ],
      }),
    }),
    scenario('no-memory', ['NO_MEMORY']),
    scenario('first-win', ['RECOGNITION', 'FIRST_WIN']),
    scenario('second-win', ['RECOGNITION', 'SECOND_WIN']),
    scenario('small-win', ['RECOGNITION', 'SMALL_WIN']),
    scenario('big-win', ['RECOGNITION', 'BIG_WIN']),
    scenario('return-after-setback', ['RECOGNITION', 'RECOVERY']),
    scenario('setback', ['RECOGNITION', 'SETBACK']),
    scenario('repeated-strategy', ['RECOGNITION', 'GOOD_STRATEGY']),
    scenario('abandoned-strategy', ['RECOGNITION', 'BAD_STRATEGY']),
    scenario('high-discipline', ['RECOGNITION', 'HIGH_DISCIPLINE']),
    scenario('low-discipline', ['RECOGNITION', 'LOW_DISCIPLINE']),
    scenario('gradual-improvement', ['RECOGNITION', 'GRADUAL_IMPROVEMENT']),
    scenario('plateau', ['RECOGNITION', 'PLATEAU']),
    scenario('return-after-absence', ['EMOTIONAL', 'REENGAGEMENT']),
    scenario('multiple-relapses', ['EMOTIONAL', 'FRUSTRATION', 'RESISTANCE']),
    scenario('long-plateau', ['EMOTIONAL', 'FRUSTRATION', 'PLATEAU']),
    scenario('high-curiosity', ['EMOTIONAL', 'CURIOSITY']),
    scenario('high-consistency', ['EMOTIONAL', 'CONFIDENCE', 'MOTIVATION']),
    scenario('low-consistency', ['EMOTIONAL', 'RESISTANCE']),
    scenario('overwhelm', ['EMOTIONAL', 'OVERWHELM', 'FATIGUE']),
    scenario('frequent-estimates', ['EMOTIONAL', 'UNCERTAINTY']),
    scenario('repeated-strategy-emotional', [
      'EMOTIONAL',
      'FRUSTRATION',
      'RESISTANCE',
    ]),
    scenario('gradual-improvement-emotional', [
      'EMOTIONAL',
      'SATISFACTION',
      'CONFIDENCE',
    ]),
    scenario('longitudinal-improvement', ['LONGITUDINAL_IMPROVEMENT'], {
      longitudinalContext: Object.freeze({ trend: 'IMPROVING' }),
    }),
    scenario('longitudinal-worsening', ['LONGITUDINAL_WORSENING'], {
      longitudinalContext: Object.freeze({ trend: 'WORSENING' }),
    }),
    scenario('high-fatigue', ['HIGH_FATIGUE'], {
      behavioralContext: Object.freeze({
        fatigue: 'HIGH',
        preference: 'SHORT',
      }),
    }),
    scenario('short-message-preference', ['SHORT_MESSAGE']),
    scenario('authorized-question', ['AUTHORIZED_QUESTION']),
    scenario('closing-without-question', ['CLOSING_WITHOUT_QUESTION']),
    scenario('dietary-restriction', ['DIETARY_RESTRICTION']),
    scenario('allergy', ['ALLERGY']),
    scenario('unidentified-food', ['UNIDENTIFIED_FOOD']),
    scenario('multiple-items', ['MULTIPLE_ITEMS'], {
      nutritionContext: Object.freeze({ calories: 420, itemCount: 4 }),
    }),
    scenario('minimal-response', ['MINIMAL_RESPONSE']),
    scenario('normal-response', ['NORMAL_RESPONSE']),
    scenario('deep-response', ['DEEP_RESPONSE'], {
      payload: Object.freeze(deepPayload),
    }),
    dialogueScenario(
      'dialogue-adequate-no-correction',
      'ADEQUATE_WITHOUT_CORRECTION',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'A refeição ficou adequada para este momento.',
    ),
    dialogueScenario(
      'dialogue-adequate-small-adjustment',
      'ADEQUATE_WITH_SMALL_ADJUSTMENT',
      'ACKNOWLEDGE_AND_ADJUST',
      'ADJUST',
      ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
      'A refeição ficou adequada. Faça apenas um ajuste simples.',
    ),
    dialogueScenario(
      'dialogue-objective-question',
      'OBJECTIVE_QUESTION',
      'TEACH_BRIEFLY',
      'TEACH',
      ['RESPOND_TO_MEAL', 'TEACH_BRIEFLY'],
      'Uma explicação curta é suficiente para esta dúvida.',
    ),
    dialogueScenario(
      'dialogue-low-confidence',
      'LOW_CONFIDENCE',
      'CLARIFY_BEFORE_ANALYSIS',
      'CLARIFY',
      ['RESPOND_TO_MEAL', 'CLARIFY_BEFORE_ANALYSIS', 'ASK_QUESTION'],
      'Preciso confirmar um detalhe antes de analisar?',
    ),
    dialogueScenario(
      'dialogue-unknown-food',
      'UNKNOWN_FOOD',
      'CLARIFY_BEFORE_ANALYSIS',
      'CLARIFY',
      ['RESPOND_TO_MEAL', 'CLARIFY_BEFORE_ANALYSIS', 'ASK_QUESTION'],
      'Qual era o alimento que não foi identificado?',
    ),
    dialogueScenario(
      'dialogue-isolated-relapse',
      'ISOLATED_RELAPSE',
      'RECOVERY',
      'RECOVER',
      ['RESPOND_TO_MEAL', 'NORMALIZE_SETBACK'],
      'Uma ocorrência isolada não apaga a continuidade.',
    ),
    dialogueScenario(
      'dialogue-recurrent-relapse',
      'RECURRENT_RELAPSE',
      'RECOVERY',
      'RECOVER',
      ['RESPOND_TO_MEAL', 'NORMALIZE_SETBACK'],
      'Vamos reduzir a carga e retomar um passo por vez.',
    ),
    dialogueScenario(
      'dialogue-recovery',
      'RECOVERY',
      'RECOVERY',
      'RECOVER',
      ['RESPOND_TO_MEAL', 'ACKNOWLEDGE_RECOVERY'],
      'A retomada já é o fato mais importante agora.',
    ),
    dialogueScenario(
      'dialogue-achievement',
      'ACHIEVEMENT',
      'CELEBRATE',
      'CELEBRATE',
      ['RESPOND_TO_MEAL', 'ACKNOWLEDGE_IMPROVEMENT'],
      'Há uma melhora concreta que merece ser reconhecida.',
    ),
    dialogueScenario(
      'dialogue-small-win',
      'SMALL_WIN',
      'CELEBRATE',
      'CELEBRATE',
      ['RESPOND_TO_MEAL', 'ACKNOWLEDGE_SMALL_WIN'],
      'Essa pequena vitória sustenta o processo.',
    ),
    dialogueScenario(
      'dialogue-high-fatigue',
      'HIGH_FATIGUE',
      'REASSURE_AND_SIMPLIFY',
      'REASSURE',
      ['RESPOND_TO_MEAL', 'SIMPLIFY_GUIDANCE', 'CLOSE_WITHOUT_QUESTION'],
      'Vamos simplificar por agora.',
    ),
    dialogueScenario(
      'dialogue-overload',
      'OVERLOAD',
      'REASSURE_AND_SIMPLIFY',
      'REASSURE',
      ['RESPOND_TO_MEAL', 'REDUCE_COGNITIVE_LOAD', 'CLOSE_WITHOUT_QUESTION'],
      'Um único passo é suficiente neste momento.',
    ),
    dialogueScenario(
      'dialogue-curiosity',
      'CURIOSITY',
      'TEACH_BRIEFLY',
      'TEACH',
      ['RESPOND_TO_MEAL', 'ANSWER_CURIOSITY'],
      'Vou explicar apenas o conceito necessário.',
    ),
    dialogueScenario(
      'dialogue-short-answer-request',
      'SHORT_ANSWER_REQUEST',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'Está adequado.',
    ),
    dialogueScenario(
      'dialogue-detail-request',
      'DETAIL_REQUEST',
      'DETAILED_ANALYSIS',
      'ANALYZE',
      ['RESPOND_TO_MEAL', 'DETAIL_ANALYSIS', 'SHOW_CALORIES'],
      'A análise detalhada registra cerca de 420 calorias.',
    ),
    dialogueScenario(
      'dialogue-useful-question',
      'USEFUL_QUESTION',
      'REFLECT_AND_ASK',
      'CLARIFY',
      ['RESPOND_TO_MEAL', 'ASK_QUESTION'],
      'Qual barreira está dificultando esse ajuste?',
    ),
    dialogueScenario(
      'dialogue-unnecessary-question',
      'UNNECESSARY_QUESTION',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'A resposta já está completa sem nova pergunta.',
    ),
    dialogueScenario(
      'dialogue-no-recommendation-needed',
      'NO_RECOMMENDATION_NEEDED',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'Não há ajuste relevante a acrescentar.',
    ),
    dialogueScenario(
      'dialogue-continuity',
      'CONTINUITY',
      'CONTINUITY_CHECK',
      'FOLLOW_UP',
      ['RESPOND_TO_MEAL', 'FOLLOW_UP_COMMITMENT', 'ASK_QUESTION'],
      'Como funcionou o compromisso anterior?',
    ),
    dialogueScenario(
      'dialogue-neutral-context',
      'NEUTRAL_CONTEXT',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'A refeição foi registrada.',
    ),
    dialogueScenario(
      'episodic-new-user',
      'NEW_USER',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'A refeição foi registrada sem retomar histórico.',
    ),
    episodicScenario(
      'episodic-old-user',
      'OLD_USER',
      'HABIT',
      'CONTINUE_STRATEGY',
      'Esse padrão já funcionou antes; como foi desta vez?',
    ),
    episodicScenario(
      'episodic-old-goal',
      'OLD_GOAL',
      'GOAL',
      'RECALL_GOAL',
      'Essa meta ainda representa o que você busca?',
    ),
    episodicScenario(
      'episodic-changed-goal',
      'CHANGED_GOAL',
      'GOAL',
      'RECALL_GOAL',
      'A meta registrada mudou; este novo foco continua válido?',
    ),
    episodicScenario(
      'episodic-food-preference',
      'FOOD_PREFERENCE',
      'PREFERENCE',
      'FOLLOW_UP_EPISODE',
      'A preferência registrada ainda ajuda nas suas escolhas?',
    ),
    episodicScenario(
      'episodic-allergy',
      'ALLERGY',
      'ALLERGY',
      'FOLLOW_UP_EPISODE',
      'A alergia registrada continua relevante para esta escolha?',
      'SENSITIVE',
    ),
    episodicScenario(
      'episodic-restriction',
      'RESTRICTION',
      'RESTRICTION',
      'FOLLOW_UP_EPISODE',
      'A restrição registrada se aplica a esta refeição?',
      'SENSITIVE',
    ),
    episodicScenario(
      'episodic-travel',
      'TRAVEL',
      'TRAVEL',
      'FOLLOW_UP_EPISODE',
      'A viagem ainda está mudando sua rotina alimentar?',
    ),
    episodicScenario(
      'episodic-return-from-vacation',
      'RETURN_FROM_VACATION',
      'TRAVEL',
      'FOLLOW_UP_EPISODE',
      'Como ficou a retomada da rotina depois da viagem?',
    ),
    episodicScenario(
      'episodic-commitment-completed',
      'COMMITMENT_COMPLETED',
      'SUCCESS',
      'RECALL_SUCCESS',
      'O compromisso foi cumprido; o que facilitou desta vez?',
    ),
    episodicScenario(
      'episodic-commitment-abandoned',
      'COMMITMENT_ABANDONED',
      'COMMITMENT',
      'CHECK_COMMITMENT',
      'O combinado anterior deixou de funcionar?',
    ),
    episodicScenario(
      'episodic-setback',
      'SETBACK',
      'SETBACK',
      'RECALL_SETBACK',
      'Essa dificuldade voltou a aparecer nesta situação?',
    ),
    episodicScenario(
      'episodic-resumption',
      'RESUMPTION',
      'FOLLOW_UP',
      'FOLLOW_UP_EPISODE',
      'A retomada continua viável nesta semana?',
    ),
    episodicScenario(
      'episodic-repeated-strategy',
      'REPEATED_STRATEGY',
      'PLAN',
      'CONTINUE_STRATEGY',
      'A estratégia anterior ainda merece ser mantida?',
    ),
    episodicScenario(
      'episodic-plateau',
      'PLATEAU',
      'DIFFICULTY',
      'RECALL_DIFFICULTY',
      'O platô registrado ainda é a principal dificuldade?',
    ),
    scenario('golden-exact-numbers', ['GOLDEN', 'EXACT_NUMBERS'], {
      golden: true,
    }),
    scenario('golden-disclaimer', ['GOLDEN', 'DISCLAIMER'], { golden: true }),
    scenario('golden-no-question', ['GOLDEN', 'NO_QUESTION'], { golden: true }),
    scenario('golden-memory', ['GOLDEN', 'MEMORY'], { golden: true }),
    scenario('golden-recommendation', ['GOLDEN', 'RECOMMENDATION'], {
      golden: true,
    }),
    scenario('golden-fatigue', ['GOLDEN', 'FATIGUE'], { golden: true }),
    scenario('golden-closing', ['GOLDEN', 'CLOSING'], { golden: true }),
    dialogueScenario(
      'golden-profile-acknowledge-only',
      'GOLDEN_ACKNOWLEDGE_ONLY',
      'ACKNOWLEDGE_ONLY',
      'RECOGNIZE',
      ['RESPOND_TO_MEAL'],
      'A refeição ficou adequada para este momento.',
      true,
    ),
    dialogueScenario(
      'golden-profile-recovery',
      'GOLDEN_RECOVERY',
      'RECOVERY',
      'RECOVER',
      ['RESPOND_TO_MEAL', 'NORMALIZE_SETBACK'],
      'Uma ocorrência isolada não apaga a continuidade.',
      true,
    ),
    dialogueScenario(
      'golden-profile-celebrate',
      'GOLDEN_CELEBRATE',
      'CELEBRATE',
      'CELEBRATE',
      ['RESPOND_TO_MEAL', 'ACKNOWLEDGE_SMALL_WIN'],
      'Essa pequena vitória sustenta o processo.',
      true,
    ),
    dialogueScenario(
      'golden-profile-clarify',
      'GOLDEN_CLARIFY_BEFORE_ANALYSIS',
      'CLARIFY_BEFORE_ANALYSIS',
      'CLARIFY',
      ['RESPOND_TO_MEAL', 'CLARIFY_BEFORE_ANALYSIS', 'ASK_QUESTION'],
      'Preciso confirmar um detalhe antes de analisar?',
      true,
    ),
    dialogueScenario(
      'golden-profile-detailed-analysis',
      'GOLDEN_DETAILED_ANALYSIS',
      'DETAILED_ANALYSIS',
      'ANALYZE',
      ['RESPOND_TO_MEAL', 'DETAIL_ANALYSIS', 'SHOW_CALORIES'],
      'A análise detalhada registra cerca de 420 calorias.',
      true,
    ),
    ...COACH_IDENTITY_SCENARIOS,
    ...COACH_IDENTITY_GOLDEN_CASES,
    scenario('legacy-preferred-structure', ['STRUCTURAL_REGRESSION'], {
      candidate: candidate({
        candidateText: 'Relatório:\n# Conteúdo sintético.',
      }),
    }),
    scenario('fallback-required', ['FALLBACK'], {
      candidate: candidate({
        status: 'FALLBACK',
        candidateText: null,
        fallbackReason: 'VALIDATION_REJECTED',
        failureCode: 'VALIDATION_REJECTED',
      } as Partial<LanguageRealizationResult>),
    }),
    scenario('invalid-factual', ['INVALID_FACTUAL'], {
      candidate: candidate({ realizedFacts: [] }),
    }),
  ]);
