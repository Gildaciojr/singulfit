import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningRestrictionEvidence,
  ConversationReasoningSafetyEvidence,
} from './conversation-reasoning-bridge.contract';

export interface ConversationReasoningSafetyBuildResult {
  readonly restrictions: readonly ConversationReasoningRestrictionEvidence[];
  readonly safety: ConversationReasoningSafetyEvidence;
}

export class ConversationReasoningSafetyBuilder {
  build(
    input: ConversationReasoningBridgeInput,
  ): ConversationReasoningSafetyBuildResult {
    const nutritionRestrictions = input.nutrition?.appliedRestrictions ?? [];
    const workoutConstraints = input.workout?.appliedConstraints ?? [];
    const safetyRisks =
      input.longitudinal?.risks.filter((risk) => risk.domain === 'SAFETY') ??
      [];
    const requiresCaution = Boolean(
      input.nutrition?.metadata.safetyRestricted ||
      input.workout?.metadata.safetyRestricted ||
      nutritionRestrictions.length > 0 ||
      workoutConstraints.length > 0 ||
      safetyRisks.length > 0,
    );
    const restrictions = [
      ...nutritionRestrictions.map((item) =>
        this.restriction(item.enforcement, 'alimentar'),
      ),
      ...workoutConstraints.map((item) =>
        this.restriction(item.enforcement, 'do treino'),
      ),
    ];
    const uniqueRestrictions = new Map(
      restrictions.map((item) => [item.guidance, Object.freeze(item)]),
    );
    const guidance = new Set<string>();
    if (input.nutrition?.metadata.safetyRestricted) {
      guidance.add(
        'Mantenha a orientação conservadora e respeite todas as restrições informadas.',
      );
    }
    if (input.workout?.metadata.safetyRestricted) {
      guidance.add(
        'Não aumente a exigência do treino enquanto os sinais de cautela permanecerem.',
      );
    }
    if (safetyRisks.length > 0) {
      guidance.add(
        'Use apenas orientação geral e recomende acompanhamento profissional quando necessário.',
      );
    }

    return Object.freeze({
      restrictions: Object.freeze([...uniqueRestrictions.values()].slice(0, 6)),
      safety: Object.freeze({
        requiresCaution,
        professionalGuidanceRecommended: safetyRisks.length > 0,
        guidance: Object.freeze([...guidance]),
      }),
    });
  }

  private restriction(
    enforcement: 'PROHIBIT' | 'REQUIRE' | 'CAUTION',
    domain: 'alimentar' | 'do treino',
  ): ConversationReasoningRestrictionEvidence {
    if (enforcement === 'PROHIBIT') {
      return {
        guidance: `Evite escolhas incompatíveis com o limite ${domain} já informado.`,
        importance: 'essencial',
      };
    }
    if (enforcement === 'REQUIRE') {
      return {
        guidance: `Preserve obrigatoriamente a condição ${domain} considerada na decisão.`,
        importance: 'essencial',
      };
    }
    return {
      guidance: `Trate o contexto ${domain} com cautela e sem recomendações agressivas.`,
      importance: 'alta',
    };
  }
}
