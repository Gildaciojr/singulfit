import { Injectable } from '@nestjs/common';
import type {
  ConversationAIResponse,
  ConversationAIValue,
} from '../ai/conversation-ai.contract';
import { ConversationAIService } from '../ai/conversation-ai.service';
import type {
  ConversationLanguageUnit,
  ConversationLanguageUnitClaims,
  ConversationLanguageUnitOmissionReason,
  ConversationLanguageUnitType,
  OmittedConversationLanguageUnit,
} from './conversation-language-unit.contract';
import { ConversationLanguageUnitValidationPolicy } from './conversation-language-unit-validation.policy';
import type {
  LanguageRealizationFallbackReason,
  LanguageRealizationResult,
  LanguageRealizationStatus,
} from './conversation-language-realization.contract';
import type {
  SanitizedConversationDecision,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';
import { SanitizedConversationPayloadReferenceBuilder } from './sanitized-conversation-payload-reference.builder';

type FailureStatus = Exclude<
  LanguageRealizationStatus,
  'COMPLETED' | 'PARTIALLY_COMPLETED'
>;

const REALIZER_TIMEOUT_MS = 20_000;
const UNIT_TYPES = new Set<ConversationLanguageUnitType>([
  'FACTUAL',
  'RELATIONAL',
  'TRANSITION',
  'DISCLAIMER',
  'QUESTION',
  'CLOSING',
]);
const OMISSION_REASONS = new Set<ConversationLanguageUnitOmissionReason>([
  'COMMUNICATIVE_BUDGET',
  'FACT_UNAVAILABLE',
  'STRUCTURE_CONFLICT',
  'SAFETY_RESTRICTION',
  'REALIZATION_FAILURE',
]);

const INSTRUCTIONS = `Você realiza linguagem nutricional para WhatsApp em português brasileiro.
Produza somente unidades estruturadas no schema solicitado, nunca um texto final separado.
Respeite rigorosamente a ordem, decisões, fatos, estilo, limites e apresentação do payload.
Use apenas fatos vinculados a cada bloco. Declare todos os números, alimentos, memória e recomendação usados nos claims da unidade.
Não invente, altere ou amplie fatos, números, alimentos, memórias ou recomendações.
Não crie perguntas, ações, diagnósticos ou promessas não autorizadas.
Use tom próximo, sereno, observador e pragmático, sem linguagem culpabilizante, relatório técnico ou markdown pesado.
Realize disclaimer, pergunta, encerramento, listas e emojis somente quando autorizados.`;

const OUTPUT_SCHEMA = Object.freeze({
  name: 'nutrition_conversation_language_units',
  description: 'Unidades linguísticas rastreáveis para composição local.',
  schema: {
    type: 'object',
    properties: {
      units: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            blockKey: { type: 'string' },
            unitType: {
              type: 'string',
              enum: [...UNIT_TYPES],
            },
            decisionCodes: { type: 'array', items: { type: 'string' } },
            factKeys: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
            claims: {
              type: 'object',
              properties: {
                numbers: { type: 'array', items: { type: 'number' } },
                foods: { type: 'array', items: { type: 'string' } },
                usesMemory: { type: 'boolean' },
                usesRecommendation: { type: 'boolean' },
              },
              required: [
                'numbers',
                'foods',
                'usesMemory',
                'usesRecommendation',
              ],
              additionalProperties: false,
            },
          },
          required: [
            'blockKey',
            'unitType',
            'decisionCodes',
            'factKeys',
            'text',
            'claims',
          ],
          additionalProperties: false,
        },
      },
      omittedUnits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            blockKey: { type: 'string' },
            decisionCodes: { type: 'array', items: { type: 'string' } },
            factKeys: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string', enum: [...OMISSION_REASONS] },
          },
          required: ['blockKey', 'decisionCodes', 'factKeys', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['units', 'omittedUnits'],
    additionalProperties: false,
  },
});

@Injectable()
export class NutritionConversationLanguageRealizer {
  private readonly validationPolicy =
    new ConversationLanguageUnitValidationPolicy();
  private readonly referenceBuilder =
    new SanitizedConversationPayloadReferenceBuilder();

  constructor(private readonly conversationAI: ConversationAIService) {}

  async realize(
    payload: SanitizedConversationPayload,
  ): Promise<LanguageRealizationResult> {
    const reference = this.referenceBuilder.build(payload);
    const response = await this.conversationAI.execute({
      model: 'TEXT',
      instructions: INSTRUCTIONS,
      schema: OUTPUT_SCHEMA,
      payload: payload as unknown as ConversationAIValue,
      maxOutputCharacters: payload.limits.maximumLength,
      timeout: REALIZER_TIMEOUT_MS,
    });

    if (response.status === 'FAILED') {
      return this.fromInfrastructureFailure(reference, response);
    }

    const parsed = this.parseOutput(response.structuredOutput);
    if (!parsed) {
      return this.invalid(reference, 'INVALID_LANGUAGE_UNIT_SCHEMA');
    }
    const validated = this.validationPolicy.validate(payload, parsed.units);
    if (!validated.valid) {
      return this.invalid(
        reference,
        `UNIT_VALIDATION:${validated.violations.join(',')}`,
      );
    }
    if (!this.validateOmissions(payload, parsed.omittedUnits)) {
      return this.invalid(reference, 'INVALID_OMITTED_UNITS');
    }
    if (
      !this.hasCompleteBlockCoverage(
        payload,
        validated.units,
        parsed.omittedUnits,
      )
    ) {
      return this.invalid(reference, 'INCOMPLETE_BLOCK_COVERAGE');
    }
    if (
      parsed.omittedUnits.some((omitted) =>
        payload.structure.blocks.find(
          (block) => block.key === omitted.blockKey && block.required,
        ),
      )
    ) {
      return this.invalid(reference, 'REQUIRED_BLOCK_OMITTED');
    }
    if (
      !this.validateUnitRoles(payload, validated.units, parsed.omittedUnits)
    ) {
      return this.invalid(reference, 'INVALID_UNIT_ROLE');
    }
    if (!this.validateTextClaims(validated.units)) {
      return this.invalid(reference, 'UNDECLARED_TEXT_CLAIM');
    }
    if (!this.validateUnitLimits(payload, validated.units)) {
      return this.invalid(reference, 'UNIT_LIMIT_EXCEEDED');
    }

    const orderedUnits = this.orderUnits(payload, validated.units);
    const candidateText = this.composeCandidateText(payload, orderedUnits);
    const producedLength = Array.from(candidateText).length;
    const producedQuestionCount = this.count(candidateText, '?');
    if (!candidateText.trim()) return this.empty(reference);
    if (producedLength > payload.limits.maximumLength) {
      return this.invalid(reference, 'MAXIMUM_LENGTH_EXCEEDED');
    }
    if (producedQuestionCount > payload.limits.maximumQuestions) {
      return this.invalid(reference, 'QUESTION_LIMIT_EXCEEDED');
    }
    if (!this.validatePresentation(payload, candidateText)) {
      return this.invalid(reference, 'PRESENTATION_NOT_AUTHORIZED');
    }
    if (this.emojiCount(candidateText) > payload.limits.maximumEmojiCount) {
      return this.invalid(reference, 'EMOJI_LIMIT_EXCEEDED');
    }

    const status: 'COMPLETED' | 'PARTIALLY_COMPLETED' =
      parsed.omittedUnits.length > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    return this.success(
      reference,
      status,
      candidateText,
      orderedUnits,
      parsed.omittedUnits,
      producedLength,
      producedQuestionCount,
    );
  }

  private parseOutput(value: unknown): {
    readonly units: readonly ConversationLanguageUnit[];
    readonly omittedUnits: readonly OmittedConversationLanguageUnit[];
  } | null {
    if (
      !this.isRecord(value) ||
      !Array.isArray(value.units) ||
      !Array.isArray(value.omittedUnits)
    )
      return null;
    const units = value.units.map((item) => this.parseUnit(item));
    const omittedUnits = value.omittedUnits.map((item) =>
      this.parseOmission(item),
    );
    if (
      units.some((item) => item === null) ||
      omittedUnits.some((item) => item === null)
    )
      return null;
    return {
      units: units as readonly ConversationLanguageUnit[],
      omittedUnits: omittedUnits as readonly OmittedConversationLanguageUnit[],
    };
  }

  private parseUnit(value: unknown): ConversationLanguageUnit | null {
    if (
      !this.isRecord(value) ||
      typeof value.blockKey !== 'string' ||
      !UNIT_TYPES.has(value.unitType as ConversationLanguageUnitType) ||
      typeof value.text !== 'string' ||
      !value.text.trim()
    )
      return null;
    const decisionCodes = this.stringArray(value.decisionCodes);
    const factKeys = this.stringArray(value.factKeys);
    const claims = this.parseClaims(value.claims);
    if (!decisionCodes || !factKeys || !claims) return null;
    return Object.freeze({
      blockKey: value.blockKey,
      unitType: value.unitType as ConversationLanguageUnitType,
      decisionCodes: Object.freeze(
        decisionCodes as SanitizedConversationDecision[],
      ),
      factKeys: Object.freeze(factKeys),
      text: value.text.trim(),
      claims,
    });
  }

  private parseClaims(value: unknown): ConversationLanguageUnitClaims | null {
    if (
      !this.isRecord(value) ||
      !Array.isArray(value.numbers) ||
      !value.numbers.every(
        (item) => typeof item === 'number' && Number.isFinite(item),
      ) ||
      typeof value.usesMemory !== 'boolean' ||
      typeof value.usesRecommendation !== 'boolean'
    )
      return null;
    const foods = this.stringArray(value.foods);
    if (!foods) return null;
    return Object.freeze({
      numbers: Object.freeze([...value.numbers]),
      foods: Object.freeze(foods),
      usesMemory: value.usesMemory,
      usesRecommendation: value.usesRecommendation,
    });
  }

  private parseOmission(
    value: unknown,
  ): OmittedConversationLanguageUnit | null {
    if (
      !this.isRecord(value) ||
      typeof value.blockKey !== 'string' ||
      !OMISSION_REASONS.has(
        value.reason as ConversationLanguageUnitOmissionReason,
      )
    )
      return null;
    const decisionCodes = this.stringArray(value.decisionCodes);
    const factKeys = this.stringArray(value.factKeys);
    if (!decisionCodes || !factKeys) return null;
    return Object.freeze({
      blockKey: value.blockKey,
      decisionCodes: Object.freeze(
        decisionCodes as SanitizedConversationDecision[],
      ),
      factKeys: Object.freeze(factKeys),
      reason: value.reason as ConversationLanguageUnitOmissionReason,
    });
  }

  private validateOmissions(
    payload: SanitizedConversationPayload,
    omissions: readonly OmittedConversationLanguageUnit[],
  ): boolean {
    const seen = new Set<string>();
    return omissions.every((omission) => {
      const block = payload.structure.blocks.find(
        (item) => item.key === omission.blockKey,
      );
      if (!block || seen.has(omission.blockKey)) return false;
      seen.add(omission.blockKey);
      return (
        omission.decisionCodes.every((decision) =>
          block.decisions.includes(decision),
        ) && omission.factKeys.every((fact) => block.facts.includes(fact))
      );
    });
  }

  private hasCompleteBlockCoverage(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
    omissions: readonly OmittedConversationLanguageUnit[],
  ): boolean {
    const covered = new Set([
      ...units.map((unit) => unit.blockKey),
      ...omissions.map((unit) => unit.blockKey),
    ]);
    return (
      payload.structure.blocks.every((block) => covered.has(block.key)) &&
      covered.size === payload.structure.blocks.length
    );
  }

  private validateUnitRoles(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
    omissions: readonly OmittedConversationLanguageUnit[],
  ): boolean {
    const questionAuthorized =
      payload.selectedDecisions.includes('ASK_QUESTION');
    const closingAuthorized = payload.selectedDecisions.includes(
      'CLOSE_WITHOUT_QUESTION',
    );
    const disclaimerRequired = payload.facts.disclaimerRequired.length > 0;
    const questionUnits = units.filter((unit) => unit.unitType === 'QUESTION');
    const closingUnits = units.filter((unit) => unit.unitType === 'CLOSING');
    const disclaimerUnits = units.filter(
      (unit) => unit.unitType === 'DISCLAIMER',
    );
    const questionOmitted = omissions.some((unit) =>
      unit.decisionCodes.includes('ASK_QUESTION'),
    );
    const closingOmitted = omissions.some((unit) =>
      unit.decisionCodes.includes('CLOSE_WITHOUT_QUESTION'),
    );
    return (
      questionUnits.length <= 1 &&
      closingUnits.length <= 1 &&
      (questionAuthorized
        ? questionUnits.length === 1 || questionOmitted
        : questionUnits.length === 0 && !questionOmitted) &&
      (closingAuthorized
        ? closingUnits.length === 1 || closingOmitted
        : closingUnits.length === 0 && !closingOmitted) &&
      (!disclaimerRequired ||
        (disclaimerUnits.length === 1 &&
          payload.facts.disclaimerRequired.every((fact) =>
            disclaimerUnits[0].factKeys.includes(fact),
          )))
    );
  }

  private validateTextClaims(
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    return units.every((unit) => {
      const textNumbers = this.textNumbers(unit.text);
      const declaredNumbers = unit.claims.numbers;
      if (
        textNumbers.some((number) => !declaredNumbers.includes(number)) ||
        declaredNumbers.some((number) => !textNumbers.includes(number))
      )
        return false;
      return unit.claims.foods.every((food) =>
        this.normalize(unit.text).includes(this.normalize(food)),
      );
    });
  }

  private validateUnitLimits(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    const blocks = new Map(
      payload.structure.blocks.map((block) => [block.key, block]),
    );
    return units.every((unit) => {
      const block = blocks.get(unit.blockKey);
      if (!block || Array.from(unit.text).length > block.maximumLength) {
        return false;
      }
      const questionCount = this.count(unit.text, '?');
      if (unit.unitType === 'QUESTION') return questionCount === 1;
      return questionCount === 0;
    });
  }
  private orderUnits(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
  ): readonly ConversationLanguageUnit[] {
    const order = new Map(
      payload.structure.blocks.map((block) => [block.key, block.order]),
    );
    return Object.freeze(
      [...units].sort(
        (left, right) =>
          (order.get(left.blockKey) ?? 0) - (order.get(right.blockKey) ?? 0),
      ),
    );
  }

  private composeCandidateText(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
  ): string {
    const blockByKey = new Map(
      payload.structure.blocks.map((block) => [block.key, block]),
    );
    const paragraphs = new Map<number, string[]>();
    for (const unit of units) {
      const paragraph = blockByKey.get(unit.blockKey)?.paragraph ?? 0;
      paragraphs.set(paragraph, [
        ...(paragraphs.get(paragraph) ?? []),
        unit.text,
      ]);
    }
    return [...paragraphs.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, texts]) => texts.join(' '))
      .join('\n\n')
      .trim();
  }

  private validatePresentation(
    payload: SanitizedConversationPayload,
    text: string,
  ): boolean {
    const hasBullets = /^(?:[-*•]|\d+[.)])\s+/m.test(text);
    return payload.structure.presentation !== 'PROSE' || !hasBullets;
  }

  private success(
    reference: string,
    status: 'COMPLETED' | 'PARTIALLY_COMPLETED',
    candidateText: string,
    units: readonly ConversationLanguageUnit[],
    omissions: readonly OmittedConversationLanguageUnit[],
    producedLength: number,
    producedQuestionCount: number,
  ): LanguageRealizationResult {
    const realizedFacts = Object.freeze([
      ...new Set(units.flatMap((unit) => unit.factKeys)),
    ]);
    const realizedDecisions = Object.freeze([
      ...new Set(units.flatMap((unit) => unit.decisionCodes)),
    ]);
    return Object.freeze({
      id: `language-realization:${reference.slice('sanitized-payload:'.length)}`,
      sanitizedPayloadReference: reference,
      status,
      candidateText,
      candidateTextSource: 'VALIDATED_UNITS',
      realizedUnits: units,
      omittedUnits: Object.freeze([...omissions]),
      realizedFacts,
      omittedFacts: Object.freeze(
        omissions.flatMap((unit) =>
          unit.factKeys.map((fact) =>
            Object.freeze({ fact, reason: unit.reason }),
          ),
        ),
      ),
      realizedDecisions,
      omittedDecisions: Object.freeze(
        omissions.flatMap((unit) =>
          unit.decisionCodes.map((decision) =>
            Object.freeze({ decision, reason: unit.reason }),
          ),
        ),
      ),
      disclaimerRealized: units.some((unit) => unit.unitType === 'DISCLAIMER'),
      questionRealized: units.some((unit) => unit.unitType === 'QUESTION'),
      closingRealized: units.some((unit) => unit.unitType === 'CLOSING'),
      producedLength,
      producedQuestionCount,
      warningCodes: Object.freeze(
        status === 'PARTIALLY_COMPLETED' ? ['OPTIONAL_UNITS_OMITTED'] : [],
      ),
    });
  }

  private fromInfrastructureFailure(
    reference: string,
    response: Extract<ConversationAIResponse, { status: 'FAILED' }>,
  ): LanguageRealizationResult {
    const mapping: Record<
      string,
      {
        status: FailureStatus;
        fallbackReason?: LanguageRealizationFallbackReason;
      }
    > = {
      TIMEOUT: { status: 'TIMED_OUT', fallbackReason: 'TIMEOUT' },
      PROVIDER_FAILURE: {
        status: 'FALLBACK',
        fallbackReason: 'PROVIDER_FAILURE',
      },
      INVALID_RESPONSE: {
        status: 'INVALID_STRUCTURE',
        fallbackReason: 'INVALID_STRUCTURE',
      },
      INVALID_SCHEMA: {
        status: 'INVALID_STRUCTURE',
        fallbackReason: 'INVALID_STRUCTURE',
      },
      EMPTY_RESPONSE: { status: 'EMPTY', fallbackReason: 'EMPTY_RESPONSE' },
      UNKNOWN_FAILURE: { status: 'FAILED' },
    };
    const mapped = mapping[response.errorCode];
    return this.failure(
      reference,
      mapped.status,
      response.errorCode,
      mapped.fallbackReason,
    );
  }

  private invalid(reference: string, code: string): LanguageRealizationResult {
    return this.failure(
      reference,
      'INVALID_STRUCTURE',
      code,
      'INVALID_STRUCTURE',
    );
  }

  private empty(reference: string): LanguageRealizationResult {
    return this.failure(
      reference,
      'EMPTY',
      'EMPTY_CANDIDATE_TEXT',
      'EMPTY_RESPONSE',
    );
  }

  private failure(
    reference: string,
    status: FailureStatus,
    failureCode: string,
    fallbackReason?: LanguageRealizationFallbackReason,
  ): LanguageRealizationResult {
    const base = {
      id: `language-realization:${reference.slice('sanitized-payload:'.length)}`,
      sanitizedPayloadReference: reference,
      candidateText: null,
      candidateTextSource: 'VALIDATED_UNITS' as const,
      realizedUnits: Object.freeze([]),
      omittedUnits: Object.freeze([]),
      realizedFacts: Object.freeze([]),
      omittedFacts: Object.freeze([]),
      realizedDecisions: Object.freeze([]),
      omittedDecisions: Object.freeze([]),
      disclaimerRealized: false,
      questionRealized: false,
      closingRealized: false,
      producedLength: 0,
      producedQuestionCount: 0,
      warningCodes: Object.freeze([]),
      failureCode,
    };
    if (status === 'INVALID_STRUCTURE')
      return Object.freeze({
        ...base,
        status,
        fallbackReason: 'INVALID_STRUCTURE',
      });
    if (status === 'FALLBACK')
      return Object.freeze({
        ...base,
        status,
        fallbackReason: fallbackReason ?? 'PROVIDER_FAILURE',
      });
    return Object.freeze({
      ...base,
      status,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  }

  private stringArray(value: unknown): string[] | null {
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string') ||
      new Set(value).size !== value.length
    )
      return null;
    return [...value];
  }

  private textNumbers(value: string): number[] {
    return [...value.matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?/gu)].map((match) =>
      Number(match[0].replace(',', '.')),
    );
  }

  private emojiCount(value: string): number {
    return [...value.matchAll(/\p{Extended_Pictographic}/gu)].length;
  }

  private count(value: string, character: string): number {
    return Array.from(value).filter((item) => item === character).length;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
