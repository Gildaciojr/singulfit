import { createHash } from 'node:crypto';
import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type { NutritionRecognitionSignal } from './nutrition-conversation-recognition.contract';
import type {
  NutritionConversationEpisodeCaptureCommand,
  NutritionConversationEpisodeCaptureInput,
  NutritionConversationPersistedEpisodeReference,
} from './nutrition-conversation-episodic-memory-capture.contract';
import type {
  NutritionConversationEpisode,
  NutritionConversationEpisodeCategory,
  NutritionConversationEpisodeEvidence,
  NutritionConversationEpisodeImportance,
  NutritionConversationEpisodeSource,
} from './nutrition-conversation-episodic-memory.contract';

interface EvidenceDefinition {
  readonly evidence: NutritionConversationEpisodeEvidence;
  readonly purpose: string;
}

const TERMINAL_STATUSES = new Set<NutritionConversationEpisode['status']>([
  'SUPERSEDED',
  'EXPIRED',
  'INVALIDATED',
]);

export class NutritionConversationEpisodicMemoryCaptureEngine {
  plan(
    input: NutritionConversationEpisodeCaptureInput,
  ): readonly NutritionConversationEpisodeCaptureCommand[] {
    this.validateInput(input);
    const definitions = this.definitions(input);
    const commands = definitions.map((definition) =>
      this.command(input, definition),
    );
    const desiredContinuityKeys = new Set(
      definitions.map((definition) => definition.evidence.continuityKey),
    );

    for (const reference of input.existing) {
      if (
        ['ALLERGY', 'RESTRICTION', 'ROUTINE'].includes(
          reference.episode.category,
        ) &&
        !TERMINAL_STATUSES.has(reference.episode.status) &&
        !desiredContinuityKeys.has(reference.episode.continuityKey)
      ) {
        commands.push(
          this.freezeCommand({
            operation: 'INVALIDATE',
            sourceKey: reference.sourceKey,
            continuityKey: reference.episode.continuityKey,
            lifecycleAction: 'INVALIDATE',
            reason: 'EXPLICIT_STRUCTURED_SOURCE_REMOVED',
          }),
        );
      }
    }

    return Object.freeze(
      commands.sort(
        (left, right) =>
          left.sourceKey.localeCompare(right.sourceKey, 'en') ||
          left.operation.localeCompare(right.operation, 'en'),
      ),
    );
  }

  sourceKey(
    userId: string,
    category: NutritionConversationEpisodeCategory,
    nature: NutritionConversationEpisode['nature'],
    continuityKey: string,
    purpose: string,
  ): string {
    const digest = createHash('sha256')
      .update(
        [userId, category, nature, continuityKey, purpose].join('|'),
        'utf8',
      )
      .digest('hex');
    return `episodic:v1:${digest}`;
  }

  private definitions(
    input: NutritionConversationEpisodeCaptureInput,
  ): EvidenceDefinition[] {
    const definitions: EvidenceDefinition[] = [];
    const goal = input.context.userContext.goal;

    if (goal) {
      definitions.push({
        purpose: 'PROFILE_GOAL',
        evidence: this.evidence(input, {
          category: 'GOAL',
          nature: 'FACT',
          confidence: 'HIGH',
          importance: 'HIGH',
          source: 'USER_CONTEXT',
          recallReason: 'CURRENT_GOAL',
          continuityKey: 'profile:goal',
          originCode: `PROFILE_GOAL:${goal}`,
          fact: { goal },
          relationToContext: 'objetivo atual salvo no perfil',
          goalRelation: goal,
        }),
      });
    }

    for (const constraint of input.context.userContext.relevantRestrictions) {
      definitions.push(
        this.constraintDefinition(input, 'RESTRICTION', constraint),
      );
    }
    for (const constraint of input.context.userContext.relevantAllergies) {
      definitions.push(this.constraintDefinition(input, 'ALLERGY', constraint));
    }

    const mealTimes = this.mealTimes(input.preferredMealTimes);
    if (mealTimes.length > 0) {
      definitions.push({
        purpose: 'PROFILE_ROUTINE',
        evidence: this.evidence(input, {
          category: 'ROUTINE',
          nature: 'FACT',
          confidence: 'HIGH',
          importance: 'MEDIUM',
          source: 'USER_CONTEXT',
          recallReason: 'USER_PREFERENCE',
          continuityKey: 'profile:routine:meal-times',
          originCode: `PROFILE_MEAL_TIMES:${this.digest(mealTimes.join('|'))}`,
          fact: { mealTimes },
          relationToContext: 'horários de refeição salvos no perfil',
        }),
      });
    }

    for (const signal of input.context.recognition?.signals ?? []) {
      const definition = this.recognitionDefinition(input, signal);
      if (definition) definitions.push(definition);
    }

    if (input.longitudinal?.relapse) {
      const relapse = input.longitudinal.relapse;
      definitions.push({
        purpose: 'LONGITUDINAL_RELAPSE',
        evidence: this.evidence(input, {
          category: 'SETBACK',
          nature: 'OBSERVATION',
          confidence: 'HIGH',
          importance: relapse.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
          source: 'LONGITUDINAL',
          recallReason: 'PROGRESS_CONTINUITY',
          continuityKey: 'longitudinal:relapse',
          originCode: `LONGITUDINAL_RELAPSE:${input.sourceEvidenceKey}:${relapse.severity}:${this.digest(relapse.reasons.join('|'))}`,
          fact: {
            severity: relapse.severity,
            reasons: Object.freeze([...relapse.reasons]),
          },
          relationToContext:
            'recaída confirmada pelo acompanhamento longitudinal',
          goalRelation: goal ?? undefined,
          expiresAtLogical: input.logicalNow + 90 * 86_400_000,
        }),
      });
    }

    const progression = input.longitudinal?.goalProgression;
    if (progression && progression.state !== 'STABLE') {
      const improving = progression.state === 'IMPROVING';
      definitions.push({
        purpose: 'GOAL_PROGRESSION',
        evidence: this.evidence(input, {
          category: improving ? 'MILESTONE' : 'DIFFICULTY',
          nature: 'OBSERVATION',
          confidence: progression.score >= 70 ? 'HIGH' : 'MEDIUM',
          importance: improving ? 'HIGH' : 'MEDIUM',
          source: 'LONGITUDINAL',
          recallReason: 'PROGRESS_CONTINUITY',
          continuityKey: 'longitudinal:goal-progression',
          originCode: `GOAL_PROGRESSION:${input.sourceEvidenceKey}:${progression.goal}:${progression.state}:${progression.score}`,
          fact: {
            goal: progression.goal,
            state: progression.state,
            score: progression.score,
          },
          relationToContext: 'progressão estruturada do objetivo',
          goalRelation: goal ?? undefined,
          expiresAtLogical: input.logicalNow + 120 * 86_400_000,
        }),
      });
    }

    for (const preference of input.longitudinal?.preferences ?? []) {
      if (preference.kind !== 'FREQUENT') continue;
      const normalized = this.normalize(preference.foodName);
      if (!normalized) continue;
      definitions.push({
        purpose: 'LONGITUDINAL_HABIT',
        evidence: this.evidence(input, {
          category: 'HABIT',
          nature: 'OBSERVATION',
          confidence: preference.confidence >= 0.8 ? 'HIGH' : 'MEDIUM',
          importance: 'MEDIUM',
          source: 'LONGITUDINAL',
          recallReason: 'STRATEGY_CONTINUITY',
          continuityKey: `longitudinal:habit:${this.digest(normalized)}`,
          originCode: `LONGITUDINAL_HABIT:${this.digest(`${normalized}:${preference.kind}:${preference.confidence.toFixed(4)}`)}`,
          fact: {
            pattern: 'FREQUENT_FOOD',
            food: preference.foodName.trim().slice(0, 120),
          },
          relationToContext: 'padrão alimentar recorrente confirmado',
          goalRelation: goal ?? undefined,
          expiresAtLogical: input.logicalNow + 120 * 86_400_000,
        }),
      });
    }

    if (input.coachReengagement && input.coachReengagement.confidence >= 0.7) {
      definitions.push({
        purpose: 'COACH_REENGAGEMENT_FOLLOW_UP',
        evidence: this.evidence(input, {
          category: 'FOLLOW_UP',
          nature: 'OBSERVATION',
          confidence: 'HIGH',
          importance: 'MEDIUM',
          source: 'COACH',
          recallReason: 'FOLLOW_UP_DUE',
          continuityKey: 'coach:reengagement:follow-up',
          originCode: `COACH_REENGAGEMENT:${input.sourceEvidenceKey}:${input.coachReengagement.reason}`,
          fact: { reason: input.coachReengagement.reason },
          relationToContext: 'retomada estruturada que requer acompanhamento',
          goalRelation: goal ?? undefined,
          expiresAtLogical: input.logicalNow + 7 * 86_400_000,
        }),
      });
    }

    return definitions;
  }

  private recognitionDefinition(
    input: NutritionConversationEpisodeCaptureInput,
    signal: NutritionRecognitionSignal,
  ): EvidenceDefinition | undefined {
    const mapping: Partial<
      Record<
        NutritionRecognitionSignal['kind'],
        {
          readonly category: NutritionConversationEpisodeCategory;
          readonly importance: NutritionConversationEpisodeImportance;
          readonly purpose: string;
          readonly expiresInDays: number;
        }
      >
    > = {
      SMALL_WIN: {
        category: 'SUCCESS',
        importance: 'MEDIUM',
        purpose: 'RECOGNITION_SUCCESS',
        expiresInDays: 90,
      },
      IMPROVEMENT: {
        category: 'SUCCESS',
        importance: 'HIGH',
        purpose: 'RECOGNITION_SUCCESS',
        expiresInDays: 120,
      },
      RECOVERY: {
        category: 'SUCCESS',
        importance: 'HIGH',
        purpose: 'RECOGNITION_RECOVERY',
        expiresInDays: 120,
      },
      BIG_WIN: {
        category: 'MILESTONE',
        importance: 'HIGH',
        purpose: 'RECOGNITION_MILESTONE',
        expiresInDays: 180,
      },
      CONSISTENCY: {
        category: 'HABIT',
        importance: 'HIGH',
        purpose: 'RECOGNITION_HABIT',
        expiresInDays: 120,
      },
      DISCIPLINE: {
        category: 'HABIT',
        importance: 'HIGH',
        purpose: 'RECOGNITION_HABIT',
        expiresInDays: 120,
      },
      ADHERENCE: {
        category: 'HABIT',
        importance: 'MEDIUM',
        purpose: 'RECOGNITION_HABIT',
        expiresInDays: 90,
      },
      MOMENTUM: {
        category: 'HABIT',
        importance: 'MEDIUM',
        purpose: 'RECOGNITION_HABIT',
        expiresInDays: 90,
      },
      GOOD_STRATEGY: {
        category: 'PLAN',
        importance: 'HIGH',
        purpose: 'RECOGNITION_STRATEGY',
        expiresInDays: 90,
      },
      BAD_STRATEGY: {
        category: 'DIFFICULTY',
        importance: 'HIGH',
        purpose: 'RECOGNITION_DIFFICULTY',
        expiresInDays: 60,
      },
      PLATEAU: {
        category: 'DIFFICULTY',
        importance: 'MEDIUM',
        purpose: 'RECOGNITION_DIFFICULTY',
        expiresInDays: 60,
      },
      SETBACK: {
        category: 'SETBACK',
        importance: 'MEDIUM',
        purpose: 'RECOGNITION_SETBACK',
        expiresInDays: 90,
      },
      RECURRENCE: {
        category: 'SETBACK',
        importance: 'HIGH',
        purpose: 'RECOGNITION_SETBACK',
        expiresInDays: 90,
      },
    };
    const definition = mapping[signal.kind];
    if (!definition) return undefined;
    const continuityKey = `recognition:${definition.category.toLowerCase()}:${signal.kind.toLowerCase()}`;

    return {
      purpose: definition.purpose,
      evidence: this.evidence(input, {
        category: definition.category,
        nature: 'OBSERVATION',
        confidence: signal.confidence,
        importance: definition.importance,
        source: this.recognitionSource(signal.origin),
        recallReason:
          definition.category === 'PLAN'
            ? 'STRATEGY_CONTINUITY'
            : 'PROGRESS_CONTINUITY',
        continuityKey,
        originCode: `ANALYSIS:${input.sourceEvidenceKey}:RECOGNITION:${signal.kind}:${signal.origin}`,
        fact: {
          kind: signal.kind,
          ...(signal.goalRelation ? { goalRelation: signal.goalRelation } : {}),
        },
        relationToContext: 'resultado estruturado do acompanhamento atual',
        goalRelation: signal.goalRelation,
        expiresAtLogical:
          input.logicalNow + definition.expiresInDays * 86_400_000,
      }),
    };
  }

  private constraintDefinition(
    input: NutritionConversationEpisodeCaptureInput,
    category: 'ALLERGY' | 'RESTRICTION',
    constraint: { readonly type?: string; readonly description: string },
  ): EvidenceDefinition {
    const normalized = this.normalize(
      `${constraint.type ?? ''}:${constraint.description}`,
    );
    const continuityKey = `profile:${category.toLowerCase()}:${this.digest(normalized)}`;
    return {
      purpose: `PROFILE_${category}`,
      evidence: this.evidence(input, {
        category,
        nature: 'FACT',
        confidence: 'HIGH',
        importance: 'CRITICAL',
        source: 'USER_CONTEXT',
        recallReason: 'SAFETY_RELEVANCE',
        continuityKey,
        originCode: `PROFILE_${category}:${this.digest(normalized)}`,
        fact: {
          ...(constraint.type
            ? { type: constraint.type.trim().slice(0, 80) }
            : {}),
          description: constraint.description.trim().slice(0, 200),
        },
        relationToContext: `${category === 'ALLERGY' ? 'alergia' : 'restrição'} explicitamente salva no perfil`,
        sensitivity: 'SENSITIVE',
        eligibleForConversation: false,
      }),
    };
  }

  private command(
    input: NutritionConversationEpisodeCaptureInput,
    definition: EvidenceDefinition,
  ): NutritionConversationEpisodeCaptureCommand {
    const evidence = definition.evidence;
    const sourceKey = this.sourceKey(
      input.userId,
      evidence.category,
      evidence.nature,
      evidence.continuityKey,
      definition.purpose,
    );
    const existing = this.current(input.existing, evidence.continuityKey);
    const sameOrigin = existing?.episode.originEvidence.some(
      (item) => item.code === evidence.originEvidence[0]?.code,
    );
    const sameFact =
      existing !== undefined &&
      this.canonical(existing.episode.fact) === this.canonical(evidence.fact);
    const operation = !existing
      ? 'CREATE'
      : sameOrigin && sameFact
        ? 'NO_OP'
        : sameFact
          ? 'UPDATE'
          : 'SUPERSEDE';

    return this.freezeCommand({
      operation,
      sourceKey,
      continuityKey: evidence.continuityKey,
      evidence,
      reason:
        operation === 'NO_OP'
          ? 'STRUCTURED_EVIDENCE_ALREADY_CAPTURED'
          : operation === 'SUPERSEDE'
            ? 'STRUCTURED_FACT_CHANGED'
            : operation === 'UPDATE'
              ? 'STRUCTURED_EVIDENCE_RECURRED'
              : 'NEW_STRUCTURED_EVIDENCE',
    });
  }

  private evidence(
    input: NutritionConversationEpisodeCaptureInput,
    definition: {
      readonly category: NutritionConversationEpisodeCategory;
      readonly nature: NutritionConversationEpisode['nature'];
      readonly confidence: NutritionConversationEpisode['confidence'];
      readonly importance: NutritionConversationEpisodeImportance;
      readonly source: NutritionConversationEpisodeSource;
      readonly recallReason: NutritionConversationEpisode['recallReason'];
      readonly continuityKey: string;
      readonly originCode: string;
      readonly fact: AuthorizedFactValue;
      readonly relationToContext: string;
      readonly goalRelation?: string;
      readonly expiresAtLogical?: number;
      readonly sensitivity?: NutritionConversationEpisode['sensitivity'];
      readonly eligibleForConversation?: boolean;
    },
  ): NutritionConversationEpisodeEvidence {
    const natureRequiresConfirmation = definition.nature !== 'FACT';
    return Object.freeze({
      category: definition.category,
      nature: definition.nature,
      confidence: definition.confidence,
      createdAtLogical: input.logicalNow,
      ...(definition.expiresAtLogical !== undefined
        ? { expiresAtLogical: definition.expiresAtLogical }
        : {}),
      importance: definition.importance,
      source: definition.source,
      eligibleForConversation: definition.eligibleForConversation ?? true,
      resumePolicy:
        definition.eligibleForConversation === false
          ? 'NEVER'
          : 'WHEN_RELEVANT',
      recallPolicy: natureRequiresConfirmation
        ? 'REQUIRES_CONFIRMATION'
        : 'FREE',
      recallReason: definition.recallReason,
      continuityKey: definition.continuityKey,
      originEvidence: Object.freeze([
        Object.freeze({
          code: definition.originCode,
          source: definition.source,
          value: true,
        }),
      ]),
      sensitivity: definition.sensitivity ?? 'STANDARD',
      confirmation: natureRequiresConfirmation ? 'CONFIRMED' : 'NOT_REQUIRED',
      fact: this.freezeValue(definition.fact),
      relationToContext: definition.relationToContext,
      ...(definition.goalRelation
        ? { goalRelation: definition.goalRelation }
        : {}),
    });
  }

  private current(
    existing: readonly NutritionConversationPersistedEpisodeReference[],
    continuityKey: string,
  ): NutritionConversationPersistedEpisodeReference | undefined {
    return existing
      .filter(
        (reference) =>
          reference.episode.continuityKey === continuityKey &&
          !TERMINAL_STATUSES.has(reference.episode.status),
      )
      .sort(
        (left, right) =>
          right.episode.lifecycle.version - left.episode.lifecycle.version ||
          right.episode.createdAtLogical - left.episode.createdAtLogical,
      )[0];
  }

  private recognitionSource(
    origin: NutritionRecognitionSignal['origin'],
  ): NutritionConversationEpisodeSource {
    return origin;
  }

  private mealTimes(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(
      [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item)),
        ),
      ]
        .sort((left, right) => left.localeCompare(right, 'en'))
        .slice(0, 8),
    );
  }

  private freezeCommand(
    command: NutritionConversationEpisodeCaptureCommand,
  ): NutritionConversationEpisodeCaptureCommand {
    return Object.freeze(command);
  }

  private freezeValue(value: AuthorizedFactValue): AuthorizedFactValue {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => this.freezeValue(item)));
    if (typeof value === 'object' && value !== null)
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.freezeValue(item),
          ]),
        ),
      );
    return value;
  }

  private canonical(value: AuthorizedFactValue): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    if (typeof value === 'object' && value !== null)
      return `{${Object.keys(value)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((key) => `${key}:${this.canonical(value[key])}`)
        .join(',')}}`;
    return JSON.stringify(value);
  }

  private digest(value: string): string {
    return createHash('sha256')
      .update(value, 'utf8')
      .digest('hex')
      .slice(0, 24);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9: ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateInput(input: NutritionConversationEpisodeCaptureInput): void {
    if (!input.userId.trim() || !input.sourceEvidenceKey.trim())
      throw new Error('Captura episódica sem proveniência estruturada');
    if (!Number.isSafeInteger(input.logicalNow) || input.logicalNow < 0)
      throw new Error('Tempo lógico de captura inválido');
  }
}
