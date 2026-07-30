import { Injectable } from '@nestjs/common';
import type {
  CoachProfileConstraint,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import { WORKOUT_KNOWLEDGE_PACKAGES } from './workout-knowledge.catalog';
import {
  WORKOUT_KNOWLEDGE_CATALOG_VERSION,
  WORKOUT_KNOWLEDGE_PACKAGE_ID,
  WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
  type WorkoutKnowledgeApplicability,
  type WorkoutKnowledgeBooleanFact,
  type WorkoutKnowledgeCondition,
  type WorkoutKnowledgeMatchedFact,
  type WorkoutKnowledgePackage,
  type WorkoutKnowledgePackageId,
  type WorkoutKnowledgePriority,
  type WorkoutKnowledgeResolution,
  type WorkoutKnowledgeStringFact,
} from './workout-knowledge.contract';

interface WorkoutKnowledgeSignals {
  readonly primaryGoal: CoachProfileSnapshot['training']['primaryGoal'];
  readonly strings: Readonly<
    Record<WorkoutKnowledgeStringFact, readonly string[]>
  >;
  readonly booleans: Readonly<Record<WorkoutKnowledgeBooleanFact, boolean>>;
}

const PRIORITY_ORDER: Readonly<Record<WorkoutKnowledgePriority, number>> =
  Object.freeze({
    CRITICAL: 4,
    HIGH: 3,
    STANDARD: 2,
    SUPPORTING: 1,
  });

@Injectable()
export class WorkoutKnowledgeResolverService {
  private readonly packageById = new Map<
    WorkoutKnowledgePackageId,
    WorkoutKnowledgePackage
  >(WORKOUT_KNOWLEDGE_PACKAGES.map((item) => [item.id, item]));

  constructor() {
    this.assertCatalogIntegrity();
  }

  resolve(snapshot: CoachProfileSnapshot): WorkoutKnowledgeResolution {
    const signals = this.signals(snapshot);
    const directlyApplicable = WORKOUT_KNOWLEDGE_PACKAGES.filter(
      (knowledgePackage) => this.applies(knowledgePackage, signals),
    ).sort((left, right) => this.comparePackages(left, right));

    const selected: WorkoutKnowledgePackage[] = [];
    const selectedIds = new Set<WorkoutKnowledgePackageId>();
    const matchedFacts = new Map<
      WorkoutKnowledgePackageId,
      readonly WorkoutKnowledgeMatchedFact['facts'][number][]
    >();

    for (const knowledgePackage of directlyApplicable) {
      if (this.conflictsWithSelected(knowledgePackage, selectedIds)) continue;
      selected.push(knowledgePackage);
      selectedIds.add(knowledgePackage.id);
      matchedFacts.set(
        knowledgePackage.id,
        this.matchedFactNames(knowledgePackage.whenToApply, signals),
      );
    }

    for (let index = 0; index < selected.length; index += 1) {
      const knowledgePackage = selected[index];
      for (const dependencyId of knowledgePackage.dependencyPackageIds) {
        if (selectedIds.has(dependencyId)) continue;
        const dependency = this.packageById.get(dependencyId);
        if (!dependency) {
          throw new Error(
            `Pacote de conhecimento de treino não encontrado: ${dependencyId}`,
          );
        }
        selected.push(dependency);
        selectedIds.add(dependency.id);
        matchedFacts.set(dependency.id, Object.freeze([]));
      }
    }

    selected.sort((left, right) => this.comparePackages(left, right));
    const frozenPackages = Object.freeze([...selected]);
    const frozenMatchedFacts = Object.freeze(
      selected.map((knowledgePackage) =>
        Object.freeze({
          packageId: knowledgePackage.id,
          facts: Object.freeze(
            [...(matchedFacts.get(knowledgePackage.id) ?? [])].sort(),
          ),
        }),
      ),
    );

    return Object.freeze({
      schemaVersion: WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
      catalogVersion: WORKOUT_KNOWLEDGE_CATALOG_VERSION,
      packages: frozenPackages,
      packageIds: Object.freeze(
        frozenPackages.map((knowledgePackage) => knowledgePackage.id),
      ),
      matchedFacts: frozenMatchedFacts,
      safetyRestricted: this.isSafetyRestricted(selectedIds),
    });
  }

  private applies(
    knowledgePackage: WorkoutKnowledgePackage,
    signals: WorkoutKnowledgeSignals,
  ): boolean {
    return (
      this.matches(knowledgePackage.whenToApply, signals) &&
      !this.matches(knowledgePackage.whenNotToApply, signals)
    );
  }

  private matches(
    applicability: WorkoutKnowledgeApplicability,
    signals: WorkoutKnowledgeSignals,
  ): boolean {
    const results = applicability.conditions.map((condition) =>
      this.matchesCondition(condition, signals),
    );
    return applicability.match === 'ALL'
      ? results.every(Boolean)
      : results.some(Boolean);
  }

  private matchesCondition(
    condition: WorkoutKnowledgeCondition,
    signals: WorkoutKnowledgeSignals,
  ): boolean {
    if (condition.fact === 'ALWAYS') return true;
    if (condition.fact === 'PRIMARY_GOAL') {
      return (
        'value' in signals.primaryGoal &&
        signals.primaryGoal.value === condition.value
      );
    }
    if (condition.operator === 'IS') {
      return signals.booleans[condition.fact] === condition.value;
    }
    return signals.strings[condition.fact].some((actual) =>
      condition.values.some((expected) =>
        actual.includes(this.normalize(expected)),
      ),
    );
  }

  private matchedFactNames(
    applicability: WorkoutKnowledgeApplicability,
    signals: WorkoutKnowledgeSignals,
  ): readonly WorkoutKnowledgeMatchedFact['facts'][number][] {
    return Object.freeze(
      [
        ...new Set(
          applicability.conditions
            .filter((condition) => this.matchesCondition(condition, signals))
            .map((condition) => condition.fact),
        ),
      ].sort(),
    );
  }

  private signals(snapshot: CoachProfileSnapshot): WorkoutKnowledgeSignals {
    const limitations = this.datumValues(
      snapshot.restrictions.physicalLimitations,
    );
    const medicalConditions = this.datumValues(
      snapshot.restrictions.medicalConditions,
    );
    const perceivedConditioning = this.normalizedDatum(
      snapshot.training.perceivedConditioning,
    );
    const safetySignal = [...limitations, ...medicalConditions]
      .flatMap((constraint) => [constraint.type ?? '', constraint.description])
      .map((value) => this.normalize(value))
      .filter(Boolean)
      .concat(perceivedConditioning);
    const equipmentDatum = snapshot.training.availableEquipment;
    const equipment = this.datumValues(equipmentDatum);
    const equipmentIsKnown = 'value' in equipmentDatum;
    const experience = this.normalizedDatum(snapshot.training.experienceLevel);
    const intensity = this.normalizedDatum(
      snapshot.training.intensityPreference,
    );
    const weeklyFrequency = this.datumValue(snapshot.training.weeklyFrequency);
    const sessionDuration = this.datumValue(
      snapshot.training.sessionDurationMinutes,
    );
    const returningAfterBreak = this.optionalDatumValue(
      snapshot.training.returningAfterBreak,
    );

    return Object.freeze({
      primaryGoal: snapshot.training.primaryGoal,
      strings: Object.freeze({
        MODALITY: this.normalizedDatum(snapshot.training.preferredModality),
        EXPERIENCE: experience,
        ENVIRONMENT: this.normalizedDatum(snapshot.training.environment),
        DESIRED_OUTCOME: this.normalizedDatum(
          snapshot.nutrition.desiredOutcome,
        ),
        SAFETY_SIGNAL: Object.freeze(safetySignal),
        PERCEIVED_CONDITIONING: perceivedConditioning,
        INTENSITY_PREFERENCE: intensity,
      }),
      booleans: Object.freeze({
        RETURNING_AFTER_BREAK: returningAfterBreak === true,
        HAS_LIMITATIONS: limitations.length > 0,
        HAS_EQUIPMENT: equipment.length > 0,
        NO_EQUIPMENT: equipmentIsKnown && equipment.length === 0,
        HAS_ENVIRONMENT:
          this.datumValue(snapshot.training.environment) !== undefined,
        HAS_WEEKLY_FREQUENCY: typeof weeklyFrequency === 'number',
        HIGH_WEEKLY_FREQUENCY:
          typeof weeklyFrequency === 'number' && weeklyFrequency >= 6,
        LIMITED_TIME:
          typeof sessionDuration === 'number' && sessionDuration <= 30,
        HAS_ADHERENCE_CONTEXT:
          this.datumValue(snapshot.longitudinal.adherenceScore) !== undefined,
        HAS_MOTIVATION_CONTEXT:
          this.datumValue(snapshot.conversation.coachStyle) !== undefined ||
          this.datumValue(snapshot.conversation.behavioralStage) !== undefined,
        HAS_CLINICAL_CONTEXT: medicalConditions.length > 0,
        BEGINNER_HIGH_INTENSITY:
          experience.some((value) =>
            ['INICIANTE', 'BEGINNER', 'NOVATO'].some((token) =>
              value.includes(token),
            ),
          ) &&
          intensity.some((value) =>
            ['ALTA', 'HIGH', 'INTENSA', 'INTENSE'].some((token) =>
              value.includes(token),
            ),
          ),
      }),
    });
  }

  private normalizedDatum(datum: CoachProfileDatum<string>): readonly string[] {
    const value = this.datumValue(datum);
    return typeof value === 'string' && value.trim()
      ? Object.freeze([this.normalize(value)])
      : Object.freeze([]);
  }

  private datumValue<T>(datum: CoachProfileDatum<T>): T | undefined {
    return 'value' in datum ? datum.value : undefined;
  }

  private optionalDatumValue<T>(
    datum: CoachProfileDatum<T> | undefined,
  ): T | undefined {
    return datum ? this.datumValue(datum) : undefined;
  }

  private datumValues<T>(
    datum: CoachProfileDatum<readonly T[]> | undefined,
  ): readonly T[] {
    return datum && 'value' in datum ? datum.value : Object.freeze([]);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private conflictsWithSelected(
    knowledgePackage: WorkoutKnowledgePackage,
    selectedIds: ReadonlySet<WorkoutKnowledgePackageId>,
  ): boolean {
    return knowledgePackage.conflictingPackageIds.some((id) =>
      selectedIds.has(id),
    );
  }

  private comparePackages(
    left: WorkoutKnowledgePackage,
    right: WorkoutKnowledgePackage,
  ): number {
    return (
      PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority] ||
      left.id.localeCompare(right.id)
    );
  }

  private isSafetyRestricted(
    selectedIds: ReadonlySet<WorkoutKnowledgePackageId>,
  ): boolean {
    return [
      WORKOUT_KNOWLEDGE_PACKAGE_ID.FEVER_SAFETY,
      WORKOUT_KNOWLEDGE_PACKAGE_ID.ACUTE_PAIN_SAFETY,
      WORKOUT_KNOWLEDGE_PACKAGE_ID.SIGNIFICANT_FATIGUE_SAFETY,
      WORKOUT_KNOWLEDGE_PACKAGE_ID.CLINICAL_SAFETY_BOUNDARY,
      WORKOUT_KNOWLEDGE_PACKAGE_ID.PHYSICAL_LIMITATIONS,
    ].some((id) => selectedIds.has(id));
  }

  private assertCatalogIntegrity(): void {
    if (this.packageById.size !== WORKOUT_KNOWLEDGE_PACKAGES.length) {
      throw new Error('Catálogo de treino possui IDs duplicados');
    }
    for (const knowledgePackage of WORKOUT_KNOWLEDGE_PACKAGES) {
      for (const referenceId of [
        ...knowledgePackage.dependencyPackageIds,
        ...knowledgePackage.conflictingPackageIds,
      ]) {
        if (!this.packageById.has(referenceId)) {
          throw new Error(
            `Referência inválida no pacote ${knowledgePackage.id}: ${referenceId}`,
          );
        }
      }
      if (knowledgePackage.dependencyPackageIds.includes(knowledgePackage.id)) {
        throw new Error(
          `Pacote de treino depende de si mesmo: ${knowledgePackage.id}`,
        );
      }
    }
  }
}
