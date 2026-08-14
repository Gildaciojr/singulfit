import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ConversationAIResponse,
  ConversationAIValue,
} from '../ai/conversation-ai.contract';
import type { OpenAIJsonSchema } from '../ai/interfaces/openai.interface';
import { ConversationAIService } from '../ai/conversation-ai.service';
import type {
  ConversationLanguageUnit,
  ConversationLanguageUnitClaims,
  ConversationLanguageUnitOmissionReason,
  ConversationLanguageUnitViolationDetail,
  OmittedConversationLanguageUnit,
} from './conversation-language-unit.contract';
import { ConversationLanguageUnitRolePolicy } from './conversation-language-unit-role.policy';
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
import { NutritionConversationCoachStyleEngine } from './nutrition-conversation-coach-style.engine';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';
import { ProviderRealizationViewBuilder } from './provider-realization-view.builder';
import type { ConversationReasoningEvidence } from './reasoning-bridge/conversation-reasoning-bridge.contract';

export interface NutritionConversationLanguageRealizerExecution {
  readonly prompt: {
    readonly model: 'TEXT';
    readonly instructions: string;
    readonly schema: OpenAIJsonSchema;
  };
  readonly operation?: {
    readonly aiJobId: string;
    readonly promptVersionId: string;
  };
}

type FailureStatus = Exclude<
  LanguageRealizationStatus,
  'COMPLETED' | 'PARTIALLY_COMPLETED'
>;

type UnitRoleViolation =
  | 'QUESTION_CARDINALITY'
  | 'QUESTION_AUTHORIZATION'
  | 'CLOSING_CARDINALITY'
  | 'CLOSING_AUTHORIZATION'
  | 'DISCLAIMER_CARDINALITY'
  | 'DISCLAIMER_MISSING'
  | 'DISCLAIMER_FACT_COVERAGE';

const REALIZER_TIMEOUT_MS = 20_000;
const OMISSION_REASONS = new Set<ConversationLanguageUnitOmissionReason>([
  'COMMUNICATIVE_BUDGET',
  'FACT_UNAVAILABLE',
  'STRUCTURE_CONFLICT',
  'SAFETY_RESTRICTION',
  'REALIZATION_FAILURE',
]);
const RECOGNITION_DECISIONS = new Set<SanitizedConversationDecision>([
  'ACKNOWLEDGE_EFFORT',
  'ACKNOWLEDGE_PROGRESS',
  'ACKNOWLEDGE_RECOVERY',
  'ACKNOWLEDGE_SMALL_WIN',
  'ACKNOWLEDGE_CONSISTENCY',
  'ACKNOWLEDGE_STRATEGY',
  'ACKNOWLEDGE_DISCIPLINE',
  'ACKNOWLEDGE_IMPROVEMENT',
]);
const EMOTIONAL_DECISIONS = new Set<SanitizedConversationDecision>([
  'VALIDATE_FRUSTRATION',
  'REINFORCE_CONFIDENCE',
  'REDUCE_COGNITIVE_LOAD',
  'NORMALIZE_SETBACK',
  'SIMPLIFY_GUIDANCE',
  'ENCOURAGE_CONTINUITY',
  'ANSWER_CURIOSITY',
]);
const EPISODIC_MEMORY_DECISIONS = new Set<SanitizedConversationDecision>([
  'FOLLOW_UP_EPISODE',
  'CONTINUE_STRATEGY',
  'CHECK_COMMITMENT',
  'RECALL_SUCCESS',
  'RECALL_SETBACK',
  'RECALL_DIFFICULTY',
  'RECALL_GOAL',
]);
const UNSAFE_EMOTIONAL_LANGUAGE = [
  /\bvoc[eê] (?:est[aá]|parece) (?:triste|ansios[oa]|desmotivad[oa]|frustrad[oa]|sobrecarregad[oa]|satisfeit[oa]|confiante|resistente|curios[oa]|cansad[oa])\b/iu,
  /\b(?:a culpa [ée] sua|voc[eê] falhou|se voc[eê] realmente quisesse|tenho pena|coitad[oa]|garanto que|prometo que)\b/iu,
] as const;

@Injectable()
export class NutritionConversationLanguageRealizer {
  private readonly validationPolicy =
    new ConversationLanguageUnitValidationPolicy();
  private readonly referenceBuilder =
    new SanitizedConversationPayloadReferenceBuilder();
  private readonly coachStyleEngine =
    new NutritionConversationCoachStyleEngine();
  private readonly providerViewBuilder = new ProviderRealizationViewBuilder();
  private readonly unitRolePolicy = new ConversationLanguageUnitRolePolicy();

  constructor(private readonly conversationAI: ConversationAIService) {}

  async realize(
    payload: SanitizedConversationPayload,
    execution: NutritionConversationLanguageRealizerExecution = {
      prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT,
    },
    reasoning: ConversationReasoningEvidence | null = null,
  ): Promise<LanguageRealizationResult> {
    const reference = this.referenceBuilder.build(payload);
    const response = await this.conversationAI.execute({
      model: execution.prompt.model,
      instructions: execution.prompt.instructions,
      schema: execution.prompt.schema,
      payload: this.realizationPayload(payload, reasoning),
      maxOutputCharacters: payload.limits.maximumLength,
      timeout: REALIZER_TIMEOUT_MS,
    });

    if (response.status === 'FAILED') {
      return this.withOperationalMetadata(
        this.fromInfrastructureFailure(reference, response),
        response,
        execution.operation,
      );
    }

    const finalize = (result: LanguageRealizationResult) =>
      this.withOperationalMetadata(result, response, execution.operation);

    let parsed: ReturnType<
      NutritionConversationLanguageRealizer['parseOutput']
    >;
    try {
      parsed = this.parseOutput(payload, response.structuredOutput);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'UNSUPPORTED_CONVERSATION_BLOCK_TYPE'
      ) {
        return finalize(this.invalid(reference, error.message));
      }
      throw error;
    }
    if (!parsed) {
      return finalize(this.invalid(reference, 'INVALID_LANGUAGE_UNIT_SCHEMA'));
    }
    const validated = this.validationPolicy.validate(payload, parsed.units);
    if (!validated.valid) {
      return finalize(
        this.invalid(
          reference,
          `UNIT_VALIDATION:${validated.violations.join(',')}`,
          validated.violationDetails,
        ),
      );
    }
    if (!this.validateOmissions(payload, parsed.omittedUnits)) {
      return finalize(this.invalid(reference, 'INVALID_OMITTED_UNITS'));
    }
    if (
      !this.hasCompleteBlockCoverage(
        payload,
        validated.units,
        parsed.omittedUnits,
      )
    ) {
      return finalize(this.invalid(reference, 'INCOMPLETE_BLOCK_COVERAGE'));
    }
    const unitRoleViolation = this.validateUnitRoles(
      payload,
      validated.units,
      parsed.omittedUnits,
    );
    if (unitRoleViolation) {
      return finalize(
        this.invalid(reference, `INVALID_UNIT_ROLE:${unitRoleViolation}`),
      );
    }
    if (
      parsed.omittedUnits.some((omitted) =>
        payload.structure.blocks.find(
          (block) => block.key === omitted.blockKey && block.required,
        ),
      )
    ) {
      return finalize(this.invalid(reference, 'REQUIRED_BLOCK_OMITTED'));
    }
    const textClaimValidation = this.validateTextClaims(validated.units);
    if (!textClaimValidation.valid) {
      return finalize(
        this.invalid(
          reference,
          'UNDECLARED_TEXT_CLAIM',
          textClaimValidation.violationDetails,
        ),
      );
    }
    if (!this.validateRecognition(validated.units)) {
      return finalize(this.invalid(reference, 'INVALID_RECOGNITION'));
    }
    if (!this.validateEmotionalIntelligence(validated.units)) {
      return finalize(
        this.invalid(reference, 'INVALID_EMOTIONAL_INTELLIGENCE'),
      );
    }
    if (!this.validateEpisodicMemory(validated.units)) {
      return finalize(this.invalid(reference, 'INVALID_EPISODIC_MEMORY'));
    }
    if (!this.validateDialogueProfile(payload, validated.units)) {
      return finalize(this.invalid(reference, 'DIALOGUE_PROFILE_VIOLATION'));
    }
    if (!this.validateUnitLimits(payload, validated.units)) {
      return finalize(this.invalid(reference, 'UNIT_LIMIT_EXCEEDED'));
    }

    const orderedUnits = this.orderUnits(payload, validated.units);
    const candidateText = this.composeCandidateText(payload, orderedUnits);
    const producedLength = Array.from(candidateText).length;
    const producedQuestionCount = this.count(candidateText, '?');
    if (!candidateText.trim()) return finalize(this.empty(reference));
    if (producedLength > payload.limits.maximumLength) {
      return finalize(this.invalid(reference, 'MAXIMUM_LENGTH_EXCEEDED'));
    }
    if (producedQuestionCount > payload.limits.maximumQuestions) {
      return finalize(this.invalid(reference, 'QUESTION_LIMIT_EXCEEDED'));
    }
    if (!this.validatePresentation(payload, candidateText)) {
      return finalize(this.invalid(reference, 'PRESENTATION_NOT_AUTHORIZED'));
    }
    if (!this.validateNaturalLanguage(candidateText)) {
      return finalize(this.invalid(reference, 'ROBOTIC_LANGUAGE_PATTERN'));
    }
    if (this.emojiCount(candidateText) > payload.limits.maximumEmojiCount) {
      return finalize(this.invalid(reference, 'EMOJI_LIMIT_EXCEEDED'));
    }
    const humanization = this.coachStyleEngine.evaluate(
      payload,
      candidateText,
      orderedUnits,
    );
    if (!humanization.valid) {
      return finalize(
        this.invalid(
          reference,
          `COACH_STYLE:${humanization.violations.join(',')}`,
        ),
      );
    }

    const status: 'COMPLETED' | 'PARTIALLY_COMPLETED' =
      parsed.omittedUnits.length > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    return finalize(
      this.success(
        reference,
        status,
        candidateText,
        orderedUnits,
        parsed.omittedUnits,
        producedLength,
        producedQuestionCount,
      ),
    );
  }

  private realizationPayload(
    payload: SanitizedConversationPayload,
    reasoning: ConversationReasoningEvidence | null,
  ): ConversationAIValue {
    const conversation = this.toConversationAIValue(
      this.providerViewBuilder.build(payload),
    );
    if (!reasoning) return conversation;
    if (!this.isRecord(conversation)) {
      throw new Error('Payload conversacional possui estrutura inválida');
    }
    return Object.freeze({
      ...conversation,
      reasoning: this.toConversationAIValue(reasoning),
    });
  }

  private toConversationAIValue(value: unknown): ConversationAIValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item) => this.toConversationAIValue(item)),
      );
    }
    if (this.isRecord(value)) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.toConversationAIValue(item),
          ]),
        ),
      );
    }
    throw new Error('Payload conversacional contém valor não serializável');
  }

  private withOperationalMetadata(
    result: LanguageRealizationResult,
    response: ConversationAIResponse,
    operation:
      | {
          readonly aiJobId: string;
          readonly promptVersionId: string;
        }
      | undefined,
  ): LanguageRealizationResult {
    if (!operation) return result;

    return Object.freeze({
      ...result,
      operationalMetadata: Object.freeze({
        aiJobId: operation.aiJobId,
        promptVersionId: operation.promptVersionId,
        providerResponseId: response.provider?.responseReference ?? null,
        model: response.provider?.model ?? null,
        usage: response.usage
          ? Object.freeze({
              inputTokens: response.usage.promptTokens,
              outputTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
              estimatedCostUsd: null,
            })
          : null,
        executionStatus: 'PROCESSING' as const,
      }),
    });
  }

  private parseOutput(
    payload: SanitizedConversationPayload,
    value: unknown,
  ): {
    readonly units: readonly ConversationLanguageUnit[];
    readonly omittedUnits: readonly OmittedConversationLanguageUnit[];
  } | null {
    if (
      !this.isRecord(value) ||
      !Array.isArray(value.units) ||
      !Array.isArray(value.omittedUnits)
    )
      return null;
    const blocks = new Map(
      payload.structure.blocks.map((block) => [block.key, block]),
    );
    const units = value.units.map((item) => this.parseUnit(blocks, item));
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

  private parseUnit(
    blocks: ReadonlyMap<
      string,
      SanitizedConversationPayload['structure']['blocks'][number]
    >,
    value: unknown,
  ): ConversationLanguageUnit | null {
    if (
      !this.isRecord(value) ||
      typeof value.blockKey !== 'string' ||
      'unitType' in value ||
      typeof value.text !== 'string' ||
      !value.text.trim()
    )
      return null;
    const block = blocks.get(value.blockKey);
    if (!block) return null;
    const decisionCodes = this.stringArray(value.decisionCodes);
    const factKeys = this.stringArray(value.factKeys);
    const claims = this.parseClaims(value.claims);
    if (!decisionCodes || !factKeys || !claims) return null;
    return Object.freeze({
      blockKey: value.blockKey,
      unitType: this.unitRolePolicy.role(block.type),
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
  ): UnitRoleViolation | null {
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
    const questionOmissionCount = omissions.filter((unit) =>
      unit.decisionCodes.includes('ASK_QUESTION'),
    ).length;
    const closingOmissionCount = omissions.filter((unit) =>
      unit.decisionCodes.includes('CLOSE_WITHOUT_QUESTION'),
    ).length;

    if (questionUnits.length + questionOmissionCount > 1) {
      return 'QUESTION_CARDINALITY';
    }
    if (
      questionAuthorized !==
      (questionUnits.length + questionOmissionCount === 1)
    ) {
      return 'QUESTION_AUTHORIZATION';
    }
    if (closingUnits.length + closingOmissionCount > 1) {
      return 'CLOSING_CARDINALITY';
    }
    if (
      closingAuthorized !==
      (closingUnits.length + closingOmissionCount === 1)
    ) {
      return 'CLOSING_AUTHORIZATION';
    }
    if (!disclaimerRequired) return null;
    if (disclaimerUnits.length === 0) return 'DISCLAIMER_MISSING';
    if (disclaimerUnits.length > 1) return 'DISCLAIMER_CARDINALITY';
    if (
      payload.facts.disclaimerRequired.some(
        (fact) => !disclaimerUnits[0].factKeys.includes(fact),
      )
    ) {
      return 'DISCLAIMER_FACT_COVERAGE';
    }
    return null;
  }

  private validateTextClaims(units: readonly ConversationLanguageUnit[]): {
    readonly valid: boolean;
    readonly violationDetails: readonly ConversationLanguageUnitViolationDetail[];
  } {
    const violationDetails: ConversationLanguageUnitViolationDetail[] = [];

    for (const unit of units) {
      const textNumbers = this.textNumbers(unit.text);
      const declaredNumbers = unit.claims.numbers;

      for (const number of textNumbers) {
        if (declaredNumbers.includes(number)) continue;
        violationDetails.push({
          code: 'TEXT_NUMBER_NOT_DECLARED',
          blockKey: unit.blockKey,
          claimReference: this.claimReference('TEXT_NUMBER', number),
        });
      }

      for (const number of declaredNumbers) {
        if (textNumbers.includes(number)) continue;
        violationDetails.push({
          code: 'DECLARED_NUMBER_NOT_REALIZED',
          blockKey: unit.blockKey,
          claimReference: this.claimReference('DECLARED_NUMBER', number),
        });
      }

      for (const food of unit.claims.foods) {
        if (this.normalize(unit.text).includes(this.normalize(food))) continue;
        violationDetails.push({
          code: 'DECLARED_FOOD_NOT_REALIZED',
          blockKey: unit.blockKey,
          claimReference: this.claimReference(
            'DECLARED_FOOD',
            this.normalize(food),
          ),
        });
      }
    }

    const boundedViolationDetails = Object.freeze(
      violationDetails.slice(0, 20).map((detail) => Object.freeze(detail)),
    );

    return Object.freeze({
      valid: boundedViolationDetails.length === 0,
      violationDetails: boundedViolationDetails,
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

  private validateRecognition(
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    const genericPraise =
      /^(?:parab[eé]ns|excelente|muito bem|continue assim)[!.\s]*$/iu;
    return units.every((unit) => {
      const recognition = unit.decisionCodes.some((decision) =>
        RECOGNITION_DECISIONS.has(decision),
      );
      return (
        !recognition ||
        (unit.factKeys.some((fact) => fact.startsWith('recognition.')) &&
          !genericPraise.test(unit.text.trim()))
      );
    });
  }

  private validateEmotionalIntelligence(
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    return units.every((unit) => {
      if (
        UNSAFE_EMOTIONAL_LANGUAGE.some((pattern) => pattern.test(unit.text))
      ) {
        return false;
      }
      const adaptsEmotionally = unit.decisionCodes.some((decision) =>
        EMOTIONAL_DECISIONS.has(decision),
      );
      return (
        !adaptsEmotionally ||
        unit.factKeys.some((fact) => fact.startsWith('emotional.'))
      );
    });
  }

  private validateDialogueProfile(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    const decisions = new Set(units.flatMap((unit) => unit.decisionCodes));
    const facts = new Set(units.flatMap((unit) => unit.factKeys));
    const actionCount = units.filter(
      (unit) => unit.claims.usesRecommendation,
    ).length;
    const hasTechnicalHeading = units.some((unit) =>
      /^(?:resumo nutricional|motivação|seu ritmo|evolução longitudinal|evidência nutricional|acompanhamento comportamental)\s*:/imu.test(
        unit.text,
      ),
    );

    if (
      payload.structure.blocks.length > payload.limits.maximumBlocks ||
      payload.structure.paragraphCount > payload.limits.maximumParagraphs ||
      facts.size > payload.limits.maximumFacts ||
      actionCount > payload.limits.maximumActions
    ) {
      return false;
    }
    if (
      payload.policies.closingRequirement === 'REQUIRED' &&
      !decisions.has('CLOSE_WITHOUT_QUESTION')
    ) {
      return false;
    }
    if (
      payload.policies.closingRequirement === 'PROHIBITED' &&
      decisions.has('CLOSE_WITHOUT_QUESTION')
    ) {
      return false;
    }
    if (
      payload.structure.dialogueProfile !== 'DETAILED_ANALYSIS' &&
      (hasTechnicalHeading || decisions.has('DETAIL_ANALYSIS'))
    ) {
      return false;
    }
    if (
      payload.structure.dialogueProfile === 'CELEBRATE' &&
      (decisions.has('PROVIDE_RECOMMENDATION') ||
        decisions.has('CORRECT_LIMITING_FACTOR') ||
        payload.structure.paragraphCount > 2)
    ) {
      return false;
    }
    if (
      payload.structure.dialogueProfile === 'RECOVERY' &&
      (decisions.has('DETAIL_ANALYSIS') || payload.structure.paragraphCount > 3)
    ) {
      return false;
    }
    if (
      payload.structure.dialogueProfile === 'CLARIFY_BEFORE_ANALYSIS' &&
      ([
        'SHOW_CALORIES',
        'SHOW_PROTEIN',
        'SHOW_CARBOHYDRATES',
        'SHOW_FAT',
        'SHOW_QUALITY',
        'PROVIDE_RECOMMENDATION',
      ].some((decision) =>
        decisions.has(decision as SanitizedConversationDecision),
      ) ||
        !decisions.has('ASK_QUESTION'))
    ) {
      return false;
    }
    if (
      !decisions.has('PROVIDE_RECOMMENDATION') &&
      units.some((unit) => unit.claims.usesRecommendation)
    ) {
      return false;
    }
    return true;
  }

  private validateEpisodicMemory(
    units: readonly ConversationLanguageUnit[],
  ): boolean {
    return units.every((unit) => {
      const episodicDecision = unit.decisionCodes.some((decision) =>
        EPISODIC_MEMORY_DECISIONS.has(decision),
      );
      if (!episodicDecision) return true;
      const episodicFact = unit.factKeys.some((fact) =>
        fact.startsWith('episodicMemory.'),
      );
      const createsDate =
        /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/iu.test(
          unit.text,
        );
      return episodicFact && unit.claims.usesMemory && !createsDate;
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

  private validateNaturalLanguage(text: string): boolean {
    const roboticPatterns = [
      /(?:^|[.!?]\s+)com base (?:nos?|nas?)\b/iu,
      /(?:^|[.!?]\s+)recomenda-se\b/iu,
      /(?:^|[.!?]\s+)o ideal [ée]\b/iu,
      /(?:^|[.!?]\s+)segue(?:m)? (?:abaixo|a seguir)\b/iu,
      /(?:^|[.!?]\s+)(?:an[aá]lise|resumo|relat[oó]rio)\s*:/iu,
    ] as const;
    return roboticPatterns.every((pattern) => !pattern.test(text));
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

  private invalid(
    reference: string,
    code: string,
    violationDetails?: LanguageRealizationResult['violationDetails'],
  ): LanguageRealizationResult {
    return this.failure(
      reference,
      'INVALID_STRUCTURE',
      code,
      'INVALID_STRUCTURE',
      violationDetails,
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
    violationDetails?: LanguageRealizationResult['violationDetails'],
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
      ...(violationDetails ? { violationDetails } : {}),
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

  private claimReference(
    kind: 'TEXT_NUMBER' | 'DECLARED_NUMBER' | 'DECLARED_FOOD',
    value: string | number,
  ): string {
    return createHash('sha256')
      .update(`${kind}:${String(value)}`)
      .digest('hex')
      .slice(0, 16);
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
