import {
  WORKOUT_KNOWLEDGE_CATALOG_VERSION,
  WORKOUT_KNOWLEDGE_DOMAIN,
  WORKOUT_KNOWLEDGE_PACKAGE_ID,
  WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
  type WorkoutEducationalMessage,
  type WorkoutKnowledgeApplicability,
  type WorkoutKnowledgeEvidenceReference,
  type WorkoutKnowledgeFactor,
  type WorkoutKnowledgeFitnessGoal,
  type WorkoutKnowledgeLimit,
  type WorkoutKnowledgePackage,
  type WorkoutKnowledgeStringFact,
} from './workout-knowledge.contract';

type PackageSeed = Omit<
  WorkoutKnowledgePackage,
  | 'schemaVersion'
  | 'catalogVersion'
  | 'packageVersion'
  | 'whenNotToApply'
  | 'conflictingPackageIds'
  | 'dependencyPackageIds'
  | 'positiveFactors'
  | 'negativeFactors'
  | 'educationalMessages'
  | 'limits'
  | 'evidenceReferences'
> &
  Partial<
    Pick<
      WorkoutKnowledgePackage,
      | 'whenNotToApply'
      | 'conflictingPackageIds'
      | 'dependencyPackageIds'
      | 'positiveFactors'
      | 'negativeFactors'
      | 'educationalMessages'
      | 'limits'
      | 'evidenceReferences'
    >
  >;

const NEVER: WorkoutKnowledgeApplicability = Object.freeze({
  match: 'ANY',
  conditions: Object.freeze([]),
});

const ALWAYS: WorkoutKnowledgeApplicability = Object.freeze({
  match: 'ALL',
  conditions: Object.freeze([
    Object.freeze({ fact: 'ALWAYS', operator: 'ALWAYS' }),
  ]),
});

const GENERAL_LIMITS: readonly WorkoutKnowledgeLimit[] = Object.freeze([
  Object.freeze({
    code: 'NO_MEDICAL_DIAGNOSIS',
    enforcement: 'PROHIBIT',
    description: 'Não diagnosticar condições clínicas.',
  }),
  Object.freeze({
    code: 'NO_REHABILITATION_OR_PHYSIOTHERAPY',
    enforcement: 'PROHIBIT',
    description:
      'Não criar reabilitação, fisioterapia ou protocolo clínico de exercício.',
  }),
  Object.freeze({
    code: 'PRESERVE_CONFIRMED_LIMITATIONS',
    enforcement: 'REQUIRE',
    description: 'Respeitar limitações físicas confirmadas no perfil.',
  }),
]);

const EVIDENCE = {
  WHO_ACTIVITY: Object.freeze({
    code: 'WHO_PHYSICAL_ACTIVITY_GUIDELINES',
    authority: 'World Health Organization',
    scope: 'Atividade física, comportamento sedentário e saúde geral.',
  }),
  ACSM_EXERCISE: Object.freeze({
    code: 'ACSM_EXERCISE_GUIDELINES',
    authority: 'American College of Sports Medicine',
    scope:
      'Treinamento cardiorrespiratório, resistido, flexibilidade e segurança.',
  }),
  NSCA_RESISTANCE: Object.freeze({
    code: 'NSCA_RESISTANCE_TRAINING',
    authority: 'National Strength and Conditioning Association',
    scope: 'Treinamento resistido, progressão, técnica e recuperação.',
  }),
  CDC_SAFETY: Object.freeze({
    code: 'CDC_PHYSICAL_ACTIVITY_SAFETY',
    authority: 'Centers for Disease Control and Prevention',
    scope:
      'Início seguro, progressão gradual e sinais para interromper exercício.',
  }),
} satisfies Readonly<Record<string, WorkoutKnowledgeEvidenceReference>>;

function factor(code: string, principle: string): WorkoutKnowledgeFactor {
  return Object.freeze({ code, principle });
}

function education(
  code: string,
  learningObjective: string,
  keyPoints: readonly string[],
): WorkoutEducationalMessage {
  return Object.freeze({
    code,
    learningObjective,
    keyPoints: Object.freeze([...keyPoints]),
  });
}

function strings(
  fact: WorkoutKnowledgeStringFact,
  values: readonly string[],
): WorkoutKnowledgeApplicability {
  return Object.freeze({
    match: 'ANY',
    conditions: Object.freeze([
      Object.freeze({ fact, operator: 'CONTAINS_ANY', values }),
    ]),
  });
}

function boolean(
  fact:
    | 'RETURNING_AFTER_BREAK'
    | 'HAS_LIMITATIONS'
    | 'HAS_EQUIPMENT'
    | 'NO_EQUIPMENT'
    | 'HAS_ENVIRONMENT'
    | 'HAS_WEEKLY_FREQUENCY'
    | 'HIGH_WEEKLY_FREQUENCY'
    | 'LIMITED_TIME'
    | 'HAS_ADHERENCE_CONTEXT'
    | 'HAS_MOTIVATION_CONTEXT'
    | 'HAS_CLINICAL_CONTEXT'
    | 'BEGINNER_HIGH_INTENSITY',
  value = true,
): WorkoutKnowledgeApplicability {
  return Object.freeze({
    match: 'ALL',
    conditions: Object.freeze([Object.freeze({ fact, operator: 'IS', value })]),
  });
}

function goal(
  value: WorkoutKnowledgeFitnessGoal,
): WorkoutKnowledgeApplicability {
  return Object.freeze({
    match: 'ALL',
    conditions: Object.freeze([
      Object.freeze({ fact: 'PRIMARY_GOAL', operator: 'EQUALS', value }),
    ]),
  });
}

function definePackage(seed: PackageSeed): WorkoutKnowledgePackage {
  return deepFreeze({
    schemaVersion: WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
    catalogVersion: WORKOUT_KNOWLEDGE_CATALOG_VERSION,
    packageVersion: 1,
    ...seed,
    whenNotToApply: seed.whenNotToApply ?? NEVER,
    dependencyPackageIds: [...(seed.dependencyPackageIds ?? [])],
    conflictingPackageIds: [...(seed.conflictingPackageIds ?? [])],
    positiveFactors: [...(seed.positiveFactors ?? [])],
    negativeFactors: [...(seed.negativeFactors ?? [])],
    educationalMessages: [...(seed.educationalMessages ?? [])],
    limits: [...GENERAL_LIMITS, ...(seed.limits ?? [])],
    evidenceReferences: [...(seed.evidenceReferences ?? [])],
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const P = WORKOUT_KNOWLEDGE_PACKAGE_ID;
const D = WORKOUT_KNOWLEDGE_DOMAIN;

export const WORKOUT_KNOWLEDGE_PACKAGES: readonly WorkoutKnowledgePackage[] =
  deepFreeze([
    definePackage({
      id: P.TRAINING_FOUNDATION,
      domain: D.EDUCATION,
      objective:
        'Estabelecer prática progressiva, individualizada e sustentável.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor('CONSISTENCY', 'Consistência sustentável precede complexidade.'),
      ],
      negativeFactors: [
        factor('ALL_OR_NOTHING', 'Pensamento tudo-ou-nada reduz aderência.'),
      ],
      educationalMessages: [
        education('TRAINING_FOUNDATIONS', 'Explicar princípios básicos.', [
          'CONSISTENCY',
          'PROGRESSION',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY, EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.SAFETY_FOUNDATION,
      domain: D.SAFETY,
      objective: 'Estabelecer limites gerais de prática segura.',
      priority: 'CRITICAL',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'SYMPTOM_AWARENESS',
          'Sinais agudos devem orientar pausa e avaliação.',
        ),
      ],
      negativeFactors: [
        factor(
          'IGNORE_WARNING_SIGNS',
          'Ignorar sinais de alerta eleva o risco.',
        ),
      ],
      educationalMessages: [
        education('SAFETY_AWARENESS', 'Reconhecer limites de segurança.', [
          'STOP_SIGNALS',
          'RECOVERY',
          'PROFESSIONAL_EVALUATION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE, EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.TRAINING_EDUCATION,
      domain: D.EDUCATION,
      objective: 'Transformar orientação de treino em compreensão aplicável.',
      priority: 'SUPPORTING',
      whenToApply: ALWAYS,
      dependencyPackageIds: [P.TRAINING_FOUNDATION],
      positiveFactors: [
        factor('EXPLAIN_WHY', 'Compreender o propósito aumenta autonomia.'),
      ],
      negativeFactors: [
        factor(
          'INFORMATION_OVERLOAD',
          'Excesso de conceitos reduz compreensão.',
        ),
      ],
      educationalMessages: [
        education('ONE_TRAINING_CONCEPT', 'Ensinar um conceito por vez.', [
          'CONCEPT',
          'PURPOSE',
          'APPLICATION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.RESISTANCE_TRAINING,
      domain: D.RESISTANCE_TRAINING,
      objective: 'Estruturar princípios de treinamento resistido.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', [
        'MUSCULACAO',
        'RESISTANCE TRAINING',
        'WEIGHT TRAINING',
        'ACADEMIA',
      ]),
      dependencyPackageIds: [P.TECHNIQUE, P.PROGRESSION, P.RECOVERY],
      positiveFactors: [
        factor('LOAD_CONTROL', 'Carga deve preservar técnica e controle.'),
      ],
      negativeFactors: [
        factor('LOAD_EGO', 'Carga sem domínio técnico aumenta risco.'),
      ],
      educationalMessages: [
        education('RESISTANCE_PRINCIPLES', 'Explicar treino resistido.', [
          'TECHNIQUE',
          'LOAD',
          'VOLUME',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.HYPERTROPHY,
      domain: D.RESISTANCE_TRAINING,
      objective: 'Apoiar hipertrofia com estímulo, progressão e recuperação.',
      priority: 'HIGH',
      whenToApply: goal('MUSCLE_GAIN'),
      dependencyPackageIds: [P.RESISTANCE_TRAINING],
      conflictingPackageIds: [P.MAINTENANCE],
      positiveFactors: [
        factor('ADEQUATE_STIMULUS', 'Estímulo repetível sustenta adaptação.'),
      ],
      negativeFactors: [
        factor(
          'VOLUME_WITHOUT_RECOVERY',
          'Volume sem recuperação limita adaptação.',
        ),
      ],
      educationalMessages: [
        education(
          'HYPERTROPHY_FOUNDATIONS',
          'Relacionar estímulo e recuperação.',
          ['EFFORT', 'VOLUME', 'PROGRESSION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.STRENGTH,
      domain: D.RESISTANCE_TRAINING,
      objective: 'Apoiar desenvolvimento de força com técnica e progressão.',
      priority: 'HIGH',
      whenToApply: strings('DESIRED_OUTCOME', ['FORCA', 'STRENGTH']),
      dependencyPackageIds: [P.RESISTANCE_TRAINING],
      positiveFactors: [
        factor(
          'QUALITY_REPETITIONS',
          'Repetições de qualidade precedem carga.',
        ),
      ],
      negativeFactors: [
        factor(
          'PREMATURE_INTENSITY',
          'Intensidade precoce compromete técnica.',
        ),
      ],
      educationalMessages: [
        education('STRENGTH_FOUNDATIONS', 'Explicar força com segurança.', [
          'TECHNIQUE',
          'INTENSITY',
          'REST',
          'PROGRESSION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.MUSCULAR_ENDURANCE,
      domain: D.RESISTANCE_TRAINING,
      objective: 'Apoiar resistência muscular com volume tolerável.',
      priority: 'HIGH',
      whenToApply: strings('DESIRED_OUTCOME', [
        'RESISTENCIA MUSCULAR',
        'MUSCULAR ENDURANCE',
      ]),
      dependencyPackageIds: [P.RESISTANCE_TRAINING],
      positiveFactors: [
        factor(
          'SUSTAINABLE_VOLUME',
          'Volume deve ser progressivo e tolerável.',
        ),
      ],
      negativeFactors: [
        factor('TECHNIQUE_DECAY', 'Fadiga não deve degradar o movimento.'),
      ],
      educationalMessages: [
        education('ENDURANCE_FOUNDATIONS', 'Explicar resistência muscular.', [
          'REPETITIONS',
          'CONTROL',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.MAINTENANCE,
      domain: D.RESISTANCE_TRAINING,
      objective: 'Preservar capacidade física com rotina sustentável.',
      priority: 'HIGH',
      whenToApply: goal('MAINTENANCE'),
      conflictingPackageIds: [P.HYPERTROPHY],
      dependencyPackageIds: [P.TRAINING_FOUNDATION],
      positiveFactors: [
        factor(
          'MINIMUM_EFFECTIVE_ROUTINE',
          'Rotina viável sustenta capacidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNNECESSARY_COMPLEXITY',
          'Complexidade desnecessária reduz aderência.',
        ),
      ],
      educationalMessages: [
        education('MAINTENANCE_FOUNDATIONS', 'Explicar manutenção ativa.', [
          'CONSISTENCY',
          'VARIETY',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.RUNNING_ADAPTATION,
      domain: D.RUNNING,
      objective: 'Apoiar adaptação gradual à corrida.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', ['CORRIDA', 'RUNNING', 'RUN']),
      dependencyPackageIds: [P.PROGRESSION, P.RECOVERY],
      positiveFactors: [
        factor(
          'WALK_RUN_ADAPTATION',
          'Alternância pode apoiar adaptação inicial.',
        ),
      ],
      negativeFactors: [
        factor(
          'PACE_PRESSURE',
          'Pressão precoce por ritmo aumenta carga indevida.',
        ),
      ],
      educationalMessages: [
        education('RUNNING_ADAPTATION', 'Explicar adaptação à corrida.', [
          'EASY_EFFORT',
          'GRADUAL_EXPOSURE',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.RUNNING_ENDURANCE,
      domain: D.RUNNING,
      objective: 'Desenvolver endurance de corrida com progressão segura.',
      priority: 'STANDARD',
      whenToApply: strings('MODALITY', ['CORRIDA', 'RUNNING', 'RUN']),
      dependencyPackageIds: [P.RUNNING_ADAPTATION],
      positiveFactors: [
        factor(
          'AEROBIC_CONTINUITY',
          'Exposição aeróbica consistente apoia endurance.',
        ),
      ],
      negativeFactors: [
        factor(
          'ABRUPT_DISTANCE',
          'Saltos abruptos de distância elevam sobrecarga.',
        ),
      ],
      educationalMessages: [
        education('RUNNING_ENDURANCE', 'Explicar construção de endurance.', [
          'EASY_VOLUME',
          'PROGRESSION',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.WALKING,
      domain: D.WALKING,
      objective: 'Usar caminhada como atividade acessível e progressiva.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', ['CAMINHADA', 'WALKING']),
      dependencyPackageIds: [P.PROGRESSION],
      positiveFactors: [
        factor('ACCESSIBLE_ACTIVITY', 'Caminhada facilita regularidade.'),
      ],
      negativeFactors: [
        factor(
          'ABRUPT_DURATION',
          'Aumentos abruptos podem reduzir tolerância.',
        ),
      ],
      educationalMessages: [
        education('WALKING_EDUCATION', 'Explicar caminhada progressiva.', [
          'PACE',
          'DURATION',
          'CONSISTENCY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.CYCLING,
      domain: D.CYCLING,
      objective:
        'Apoiar ciclismo com esforço, equipamento e ambiente coerentes.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', [
        'CICLISMO',
        'CYCLING',
        'BIKE',
        'BICICLETA',
      ]),
      dependencyPackageIds: [P.PROGRESSION, P.EQUIPMENT_COMPATIBILITY],
      positiveFactors: [
        factor('EFFORT_CONTROL', 'Percepção de esforço orienta a sessão.'),
      ],
      negativeFactors: [
        factor('UNSAFE_ROUTE', 'Percurso incompatível aumenta risco.'),
      ],
      educationalMessages: [
        education('CYCLING_EDUCATION', 'Explicar ciclismo contextual.', [
          'EFFORT',
          'BIKE_FIT',
          'ROUTE',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.CROSSFIT,
      domain: D.CROSSFIT,
      objective: 'Contextualizar CrossFit com escala, técnica e recuperação.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', [
        'CROSSFIT',
        'CROSS FIT',
        'CROSS TRAINING',
      ]),
      dependencyPackageIds: [P.TECHNIQUE, P.PROGRESSION],
      positiveFactors: [
        factor('MOVEMENT_SCALING', 'Escalas adequam estímulo e habilidade.'),
      ],
      negativeFactors: [
        factor('TECHNICAL_FATIGUE', 'Fadiga não deve comprometer técnica.'),
      ],
      educationalMessages: [
        education('CROSSFIT_EDUCATION', 'Explicar escala e intensidade.', [
          'SCALING',
          'TECHNIQUE',
          'INTENSITY',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.CALISTHENICS,
      domain: D.CALISTHENICS,
      objective: 'Apoiar calistenia por domínio corporal e regressões.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', [
        'CALISTENIA',
        'CALISTHENICS',
        'PESO CORPORAL',
      ]),
      dependencyPackageIds: [P.TECHNIQUE, P.PROGRESSION],
      positiveFactors: [
        factor(
          'MOVEMENT_REGRESSION',
          'Regressões preservam padrão e controle.',
        ),
      ],
      negativeFactors: [
        factor('SKILL_JUMP', 'Saltar etapas compromete domínio corporal.'),
      ],
      educationalMessages: [
        education('CALISTHENICS_EDUCATION', 'Explicar progressões corporais.', [
          'REGRESSION',
          'CONTROL',
          'RANGE',
          'PROGRESSION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.FUNCTIONAL,
      domain: D.FUNCTIONAL,
      objective: 'Apoiar treino funcional orientado a capacidades e qualidade.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', ['FUNCIONAL', 'FUNCTIONAL']),
      dependencyPackageIds: [P.TECHNIQUE, P.PROGRESSION],
      positiveFactors: [
        factor('MOVEMENT_PURPOSE', 'Cada movimento deve ter propósito claro.'),
      ],
      negativeFactors: [
        factor(
          'RANDOM_COMPLEXITY',
          'Complexidade aleatória não garante função.',
        ),
      ],
      educationalMessages: [
        education('FUNCTIONAL_EDUCATION', 'Explicar capacidade funcional.', [
          'PURPOSE',
          'QUALITY',
          'TRANSFER',
          'PROGRESSION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.HOME_TRAINING,
      domain: D.HOME_TRAINING,
      objective: 'Adaptar treino ao espaço e aos recursos domésticos.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'ENVIRONMENT',
            operator: 'CONTAINS_ANY',
            values: ['CASA', 'HOME', 'DOMICILIO'],
          }),
          Object.freeze({
            fact: 'MODALITY',
            operator: 'CONTAINS_ANY',
            values: ['TREINO EM CASA', 'HOME TRAINING', 'HOME WORKOUT'],
          }),
        ]),
      }),
      dependencyPackageIds: [P.ENVIRONMENT_COMPATIBILITY],
      positiveFactors: [
        factor(
          'LOW_FRICTION',
          'Baixa barreira de acesso favorece consistência.',
        ),
      ],
      negativeFactors: [
        factor('SPACE_MISMATCH', 'Movimentos devem respeitar espaço e piso.'),
      ],
      educationalMessages: [
        education('HOME_TRAINING_EDUCATION', 'Explicar adaptação doméstica.', [
          'SPACE',
          'EQUIPMENT',
          'NOISE',
          'SAFETY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.MOBILITY,
      domain: D.MOBILITY,
      objective: 'Desenvolver mobilidade funcional sem promessas terapêuticas.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', ['MOBILIDADE', 'MOBILITY']),
      dependencyPackageIds: [P.TECHNIQUE],
      positiveFactors: [
        factor(
          'CONTROLLED_RANGE',
          'Amplitude deve ser controlada e tolerável.',
        ),
      ],
      negativeFactors: [
        factor('FORCED_RANGE', 'Forçar amplitude com dor é inadequado.'),
      ],
      educationalMessages: [
        education('MOBILITY_EDUCATION', 'Explicar mobilidade ativa.', [
          'CONTROL',
          'RANGE',
          'BREATHING',
          'NO_PAIN',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.ACTIVE_RECOVERY,
      domain: D.RECOVERY,
      objective: 'Orientar recuperação ativa leve e não terapêutica.',
      priority: 'HIGH',
      whenToApply: strings('MODALITY', [
        'RECUPERACAO ATIVA',
        'ACTIVE RECOVERY',
      ]),
      dependencyPackageIds: [P.RECOVERY],
      positiveFactors: [
        factor(
          'LOW_INTENSITY_MOVEMENT',
          'Movimento leve pode apoiar rotina de recuperação.',
        ),
      ],
      negativeFactors: [
        factor(
          'HIDDEN_HARD_SESSION',
          'Recuperação ativa não deve virar sessão intensa.',
        ),
      ],
      educationalMessages: [
        education(
          'ACTIVE_RECOVERY_EDUCATION',
          'Diferenciar recuperação e treino.',
          ['LOW_INTENSITY', 'COMFORT', 'SHORT_DURATION'],
        ),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.CARDIO_CONDITIONING,
      domain: D.CARDIO_CONDITIONING,
      objective: 'Apoiar condicionamento cardiovascular progressivo.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'DESIRED_OUTCOME',
            operator: 'CONTAINS_ANY',
            values: [
              'CONDICIONAMENTO',
              'CARDIO',
              'ENDURANCE',
              'FÔLEGO',
              'FOLEGO',
            ],
          }),
          Object.freeze({
            fact: 'MODALITY',
            operator: 'CONTAINS_ANY',
            values: ['CARDIO', 'CONDICIONAMENTO CARDIOVASCULAR'],
          }),
        ]),
      }),
      dependencyPackageIds: [P.PROGRESSION, P.RECOVERY],
      positiveFactors: [
        factor('TALK_TEST', 'Esforço percebido ajuda a calibrar intensidade.'),
      ],
      negativeFactors: [
        factor(
          'ALL_HIGH_INTENSITY',
          'Alta intensidade contínua reduz sustentabilidade.',
        ),
      ],
      educationalMessages: [
        education('CARDIO_EDUCATION', 'Explicar condicionamento progressivo.', [
          'FREQUENCY',
          'DURATION',
          'INTENSITY',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.BEGINNER,
      domain: D.EXPERIENCE,
      objective: 'Adaptar complexidade e carga ao início da prática.',
      priority: 'HIGH',
      whenToApply: strings('EXPERIENCE', ['INICIANTE', 'BEGINNER', 'NOVATO']),
      conflictingPackageIds: [P.INTERMEDIATE, P.ADVANCED],
      dependencyPackageIds: [P.TECHNIQUE, P.PROGRESSION],
      positiveFactors: [
        factor(
          'SIMPLE_START',
          'Poucos padrões bem executados favorecem aprendizagem.',
        ),
      ],
      negativeFactors: [
        factor(
          'ADVANCED_COMPLEXITY',
          'Complexidade avançada é inadequada no início.',
        ),
      ],
      educationalMessages: [
        education('BEGINNER_EDUCATION', 'Explicar início gradual.', [
          'SIMPLE_MOVEMENTS',
          'MODERATE_EFFORT',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.INTERMEDIATE,
      domain: D.EXPERIENCE,
      objective: 'Estruturar evolução de praticantes intermediários.',
      priority: 'HIGH',
      whenToApply: strings('EXPERIENCE', ['INTERMEDIARIO', 'INTERMEDIATE']),
      conflictingPackageIds: [P.BEGINNER, P.ADVANCED],
      dependencyPackageIds: [P.PROGRESSION],
      positiveFactors: [
        factor(
          'PLANNED_VARIATION',
          'Variação planejada pode sustentar adaptação.',
        ),
      ],
      negativeFactors: [
        factor(
          'NOVELTY_ONLY',
          'Novidade sem propósito prejudica continuidade.',
        ),
      ],
      educationalMessages: [
        education('INTERMEDIATE_EDUCATION', 'Explicar progressão planejada.', [
          'SPECIFICITY',
          'PROGRESSION',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.ADVANCED,
      domain: D.EXPERIENCE,
      objective:
        'Contextualizar treino avançado sem presumir tolerância ilimitada.',
      priority: 'HIGH',
      whenToApply: strings('EXPERIENCE', ['AVANCADO', 'ADVANCED']),
      conflictingPackageIds: [P.BEGINNER, P.INTERMEDIATE],
      dependencyPackageIds: [P.PROGRESSION, P.RECOVERY],
      positiveFactors: [
        factor(
          'SPECIFICITY',
          'Maior experiência permite maior especificidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'RECOVERY_NEGLECT',
          'Experiência não elimina necessidade de recuperação.',
        ),
      ],
      educationalMessages: [
        education('ADVANCED_EDUCATION', 'Explicar especificidade avançada.', [
          'SPECIFICITY',
          'LOAD_MANAGEMENT',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.PROGRESSION,
      domain: D.PROGRESSION,
      objective: 'Estabelecer progressão gradual baseada em tolerância.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'ONE_VARIABLE_AT_A_TIME',
          'Alterar poucas variáveis facilita controle.',
        ),
      ],
      negativeFactors: [
        factor(
          'ABRUPT_OVERLOAD',
          'Sobrecarga abrupta eleva risco e reduz aderência.',
        ),
      ],
      educationalMessages: [
        education('PROGRESSION_EDUCATION', 'Explicar progressão segura.', [
          'TOLERANCE',
          'LOAD',
          'VOLUME',
          'FREQUENCY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE, EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.DELOAD,
      domain: D.PROGRESSION,
      objective:
        'Representar redução planejada de demanda quando contextualizada.',
      priority: 'HIGH',
      whenToApply: strings('SAFETY_SIGNAL', [
        'FADIGA IMPORTANTE',
        'SIGNIFICANT FATIGUE',
        'EXAUSTAO',
      ]),
      dependencyPackageIds: [P.RECOVERY],
      positiveFactors: [
        factor(
          'PLANNED_REDUCTION',
          'Redução temporária pode preservar continuidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'PUSH_THROUGH_FATIGUE',
          'Ignorar fadiga importante aumenta risco.',
        ),
      ],
      educationalMessages: [
        education('DELOAD_EDUCATION', 'Explicar redução planejada.', [
          'REDUCE_DEMAND',
          'MONITOR',
          'RECOVER',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.RECOVERY,
      domain: D.RECOVERY,
      objective: 'Integrar recuperação à adaptação ao treino.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'RECOVERY_CAPACITY',
          'Adaptação depende de recuperação suficiente.',
        ),
      ],
      negativeFactors: [
        factor(
          'ACCUMULATED_FATIGUE',
          'Fadiga acumulada reduz qualidade e tolerância.',
        ),
      ],
      educationalMessages: [
        education(
          'RECOVERY_EDUCATION',
          'Explicar recuperação como parte do treino.',
          ['SLEEP', 'REST', 'FATIGUE', 'ADAPTATION'],
        ),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.WARM_UP,
      domain: D.PREPARATION,
      objective: 'Preparar gradualmente para as demandas da sessão.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'SPECIFIC_PREPARATION',
          'Aquecimento deve preparar padrões da sessão.',
        ),
      ],
      negativeFactors: [
        factor('FATIGUING_WARMUP', 'Aquecimento não deve consumir a sessão.'),
      ],
      educationalMessages: [
        education('WARM_UP_EDUCATION', 'Explicar aquecimento específico.', [
          'GENERAL_PREPARATION',
          'SPECIFIC_MOVEMENT',
          'GRADUAL_INTENSITY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.STRETCHING,
      domain: D.PREPARATION,
      objective: 'Contextualizar alongamento sem promessa terapêutica.',
      priority: 'SUPPORTING',
      whenToApply: strings('MODALITY', [
        'ALONGAMENTO',
        'STRETCHING',
        'FLEXIBILIDADE',
      ]),
      dependencyPackageIds: [P.MOBILITY],
      positiveFactors: [
        factor('COMFORTABLE_RANGE', 'Alongamento deve permanecer tolerável.'),
      ],
      negativeFactors: [
        factor('PAINFUL_STRETCH', 'Dor não é meta de alongamento.'),
      ],
      educationalMessages: [
        education('STRETCHING_EDUCATION', 'Explicar uso contextual.', [
          'COMFORT',
          'BREATHING',
          'PURPOSE',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.TECHNIQUE,
      domain: D.TECHNIQUE,
      objective: 'Priorizar qualidade e controle dos movimentos.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'MOVEMENT_CONTROL',
          'Controle precede intensidade e velocidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'TECHNIQUE_BREAKDOWN',
          'Perda técnica sinaliza ajuste da demanda.',
        ),
      ],
      educationalMessages: [
        education(
          'TECHNIQUE_EDUCATION',
          'Explicar técnica como gestão de carga.',
          ['CONTROL', 'RANGE', 'BREATHING', 'FEEDBACK'],
        ),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.PHYSICAL_LIMITATIONS,
      domain: D.SAFETY,
      objective: 'Restringir escolhas às limitações físicas confirmadas.',
      priority: 'CRITICAL',
      whenToApply: boolean('HAS_LIMITATIONS'),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'LIMITATION_AWARENESS',
          'Limitações devem ser preservadas explicitamente.',
        ),
      ],
      negativeFactors: [
        factor(
          'THERAPEUTIC_INFERENCE',
          'Não inferir diagnóstico ou reabilitação.',
        ),
      ],
      educationalMessages: [
        education('LIMITATION_BOUNDARY', 'Explicar o limite de segurança.', [
          'KNOWN_LIMITATION',
          'AVOID_AGGRAVATION',
          'PROFESSIONAL_REVIEW',
        ]),
      ],
      limits: [
        Object.freeze({
          code: 'NO_REHAB_PROTOCOL',
          enforcement: 'PROHIBIT',
          description: 'Não prescrever protocolo de reabilitação.',
        }),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.EQUIPMENT_AVAILABLE,
      domain: D.EQUIPMENT,
      objective: 'Usar somente equipamentos confirmados e compatíveis.',
      priority: 'STANDARD',
      whenToApply: boolean('HAS_EQUIPMENT'),
      conflictingPackageIds: [P.NO_EQUIPMENT],
      positiveFactors: [
        factor(
          'CONFIRMED_RESOURCES',
          'Recursos confirmados ampliam opções viáveis.',
        ),
      ],
      negativeFactors: [
        factor(
          'ASSUMED_EQUIPMENT',
          'Não presumir equipamento ausente do perfil.',
        ),
      ],
      educationalMessages: [
        education('EQUIPMENT_EDUCATION', 'Explicar função do equipamento.', [
          'AVAILABILITY',
          'COMPATIBILITY',
          'SAFE_USE',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.NO_EQUIPMENT,
      domain: D.EQUIPMENT,
      objective: 'Estruturar princípios de treino sem equipamento.',
      priority: 'STANDARD',
      whenToApply: boolean('NO_EQUIPMENT'),
      conflictingPackageIds: [P.EQUIPMENT_AVAILABLE],
      positiveFactors: [
        factor(
          'BODYWEIGHT_OPTIONS',
          'Peso corporal reduz dependência de recursos.',
        ),
      ],
      negativeFactors: [
        factor('HIDDEN_REQUIREMENT', 'Não sugerir acessórios não confirmados.'),
      ],
      educationalMessages: [
        education(
          'NO_EQUIPMENT_EDUCATION',
          'Explicar progressões sem equipamento.',
          ['BODYWEIGHT', 'LEVERAGE', 'TEMPO', 'RANGE'],
        ),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.ENVIRONMENT,
      domain: D.ENVIRONMENT,
      objective: 'Considerar ambiente como restrição real do treino.',
      priority: 'STANDARD',
      whenToApply: boolean('HAS_ENVIRONMENT'),
      dependencyPackageIds: [P.ENVIRONMENT_COMPATIBILITY],
      positiveFactors: [
        factor(
          'ENVIRONMENT_ALIGNMENT',
          'Ambiente compatível reduz atrito e risco.',
        ),
      ],
      negativeFactors: [
        factor(
          'IGNORED_CONTEXT',
          'Ignorar espaço, clima ou piso compromete viabilidade.',
        ),
      ],
      educationalMessages: [
        education('ENVIRONMENT_EDUCATION', 'Explicar adaptação ao ambiente.', [
          'SPACE',
          'SURFACE',
          'CLIMATE',
          'SAFETY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.WEEKLY_FREQUENCY,
      domain: D.ROUTINE,
      objective:
        'Distribuir estímulo e recuperação pela frequência disponível.',
      priority: 'STANDARD',
      whenToApply: boolean('HAS_WEEKLY_FREQUENCY'),
      positiveFactors: [
        factor(
          'REALISTIC_FREQUENCY',
          'Frequência viável favorece continuidade.',
        ),
      ],
      negativeFactors: [
        factor('DENSITY_WITHOUT_RECOVERY', 'Alta densidade reduz recuperação.'),
      ],
      educationalMessages: [
        education('FREQUENCY_EDUCATION', 'Explicar frequência semanal.', [
          'AVAILABILITY',
          'DISTRIBUTION',
          'RECOVERY',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.LIMITED_TIME,
      domain: D.ROUTINE,
      objective: 'Priorizar estímulos essenciais em sessões curtas.',
      priority: 'HIGH',
      whenToApply: boolean('LIMITED_TIME'),
      positiveFactors: [
        factor(
          'ESSENTIAL_BLOCKS',
          'Poucos blocos prioritários aumentam viabilidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'COMPRESSED_OVERLOAD',
          'Comprimir volume excessivo aumenta fadiga.',
        ),
      ],
      educationalMessages: [
        education(
          'LIMITED_TIME_EDUCATION',
          'Explicar priorização em pouco tempo.',
          ['PRIORITY', 'TRANSITIONS', 'CONSISTENCY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.ADHERENCE,
      domain: D.BEHAVIOR,
      objective: 'Adaptar complexidade à aderência observada.',
      priority: 'STANDARD',
      whenToApply: boolean('HAS_ADHERENCE_CONTEXT'),
      positiveFactors: [
        factor('REPEATABLE_ROUTINE', 'Rotina repetível sustenta aderência.'),
      ],
      negativeFactors: [
        factor('MORAL_JUDGMENT', 'Julgamento prejudica continuidade.'),
      ],
      educationalMessages: [
        education(
          'ADHERENCE_EDUCATION',
          'Tratar aderência como ajuste do plano.',
          ['BARRIERS', 'SMALL_STEP', 'FEEDBACK'],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.MOTIVATION,
      domain: D.BEHAVIOR,
      objective: 'Apoiar motivação sem depender de pressão ou culpa.',
      priority: 'SUPPORTING',
      whenToApply: boolean('HAS_MOTIVATION_CONTEXT'),
      positiveFactors: [
        factor('AUTONOMY', 'Autonomia e progresso percebido apoiam motivação.'),
      ],
      negativeFactors: [
        factor('GUILT', 'Culpa e ameaça não sustentam comportamento.'),
      ],
      educationalMessages: [
        education(
          'MOTIVATION_EDUCATION',
          'Explicar motivação como contexto variável.',
          ['AUTONOMY', 'PROGRESS', 'IDENTITY', 'SUPPORT'],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_ACTIVITY],
    }),
    definePackage({
      id: P.FEVER_SAFETY,
      domain: D.SAFETY,
      objective: 'Restringir treino diante de febre.',
      priority: 'CRITICAL',
      whenToApply: strings('SAFETY_SIGNAL', ['FEBRE', 'FEVER']),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor('PAUSE_AND_RECOVER', 'Febre exige interrupção e recuperação.'),
      ],
      negativeFactors: [
        factor(
          'TRAIN_THROUGH_FEVER',
          'Treinar com febre é incompatível com segurança.',
        ),
      ],
      educationalMessages: [
        education('FEVER_BOUNDARY', 'Explicar interrupção por febre.', [
          'NO_TRAINING',
          'RECOVERY',
          'MEDICAL_REVIEW_IF_NEEDED',
        ]),
      ],
      limits: [
        Object.freeze({
          code: 'PROHIBIT_TRAINING_WITH_FEVER',
          enforcement: 'PROHIBIT',
          description: 'Não orientar treino enquanto houver febre.',
        }),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.ACUTE_PAIN_SAFETY,
      domain: D.SAFETY,
      objective: 'Restringir exercício que provoque ou agrave dor aguda.',
      priority: 'CRITICAL',
      whenToApply: strings('SAFETY_SIGNAL', [
        'DOR AGUDA',
        'ACUTE PAIN',
        'DOR',
        'PAIN',
      ]),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'STOP_AGGRAVATING_ACTIVITY',
          'Dor aguda requer interrupção do agravante.',
        ),
      ],
      negativeFactors: [
        factor(
          'PAIN_NORMALIZATION',
          'Não normalizar dor aguda como esforço esperado.',
        ),
      ],
      educationalMessages: [
        education('PAIN_BOUNDARY', 'Explicar limite diante de dor aguda.', [
          'STOP',
          'NO_REHAB',
          'PROFESSIONAL_EVALUATION',
        ]),
      ],
      limits: [
        Object.freeze({
          code: 'NO_EXERCISE_THROUGH_ACUTE_PAIN',
          enforcement: 'PROHIBIT',
          description: 'Não recomendar exercício que provoque dor aguda.',
        }),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.SIGNIFICANT_FATIGUE_SAFETY,
      domain: D.SAFETY,
      objective: 'Reduzir demanda diante de fadiga importante.',
      priority: 'CRITICAL',
      whenToApply: strings('SAFETY_SIGNAL', [
        'FADIGA IMPORTANTE',
        'SIGNIFICANT FATIGUE',
        'EXAUSTAO',
      ]),
      dependencyPackageIds: [P.SAFETY_FOUNDATION, P.RECOVERY],
      positiveFactors: [
        factor(
          'RECOVERY_FIRST',
          'Fadiga importante exige recuperação e reavaliação.',
        ),
      ],
      negativeFactors: [
        factor(
          'FORCED_INTENSITY',
          'Intensidade forçada agrava fadiga acumulada.',
        ),
      ],
      educationalMessages: [
        education('FATIGUE_BOUNDARY', 'Explicar ajuste por fadiga.', [
          'REDUCE_DEMAND',
          'RECOVER',
          'REASSESS',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.RETURN_AFTER_BREAK,
      domain: D.SAFETY,
      objective: 'Orientar retorno gradual após pausa.',
      priority: 'CRITICAL',
      whenToApply: boolean('RETURNING_AFTER_BREAK'),
      dependencyPackageIds: [P.PROGRESSION, P.RECOVERY],
      positiveFactors: [
        factor(
          'REDUCED_INITIAL_DEMAND',
          'Retorno deve começar abaixo da demanda anterior.',
        ),
      ],
      negativeFactors: [
        factor(
          'RESUME_OLD_LOAD',
          'Retomar carga antiga imediatamente é inadequado.',
        ),
      ],
      educationalMessages: [
        education('RETURN_EDUCATION', 'Explicar readaptação.', [
          'REDUCE_LOAD',
          'REDUCE_VOLUME',
          'MONITOR',
          'PROGRESS',
        ]),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.VOLUME_CAUTION,
      domain: D.SAFETY,
      objective:
        'Sinalizar cautela diante de frequência potencialmente excessiva.',
      priority: 'CRITICAL',
      whenToApply: boolean('HIGH_WEEKLY_FREQUENCY'),
      dependencyPackageIds: [P.RECOVERY],
      positiveFactors: [
        factor('LOAD_DISTRIBUTION', 'Distribuição deve preservar recuperação.'),
      ],
      negativeFactors: [
        factor(
          'EXCESSIVE_VOLUME',
          'Volume excessivo aumenta fadiga e reduz qualidade.',
        ),
      ],
      educationalMessages: [
        education('VOLUME_CAUTION', 'Explicar gestão de volume.', [
          'FREQUENCY',
          'VOLUME',
          'RECOVERY',
          'SYMPTOMS',
        ]),
      ],
      evidenceReferences: [EVIDENCE.NSCA_RESISTANCE],
    }),
    definePackage({
      id: P.PROGRESSION_CAUTION,
      domain: D.SAFETY,
      objective: 'Restringir progressão inadequada ao contexto atual.',
      priority: 'CRITICAL',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'RETURNING_AFTER_BREAK',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'BEGINNER_HIGH_INTENSITY',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      dependencyPackageIds: [P.PROGRESSION],
      positiveFactors: [
        factor(
          'CONTEXTUAL_PROGRESSION',
          'Progressão deve refletir tolerância atual.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_PROGRESSION',
          'Progressão agressiva ignora adaptação.',
        ),
      ],
      educationalMessages: [
        education('PROGRESSION_CAUTION', 'Explicar limite de progressão.', [
          'CURRENT_CAPACITY',
          'ONE_CHANGE',
          'MONITOR',
        ]),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.INTENSITY_CAUTION,
      domain: D.SAFETY,
      objective: 'Restringir intensidade excessiva para experiência declarada.',
      priority: 'CRITICAL',
      whenToApply: boolean('BEGINNER_HIGH_INTENSITY'),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'MODERATE_START',
          'Início moderado permite adaptação e aprendizagem.',
        ),
      ],
      negativeFactors: [
        factor(
          'EXCESSIVE_INTENSITY',
          'Intensidade excessiva compromete controle e recuperação.',
        ),
      ],
      educationalMessages: [
        education('INTENSITY_CAUTION', 'Explicar ajuste de intensidade.', [
          'TECHNIQUE',
          'PERCEIVED_EFFORT',
          'PROGRESSION',
        ]),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.EQUIPMENT_COMPATIBILITY,
      domain: D.SAFETY,
      objective:
        'Impedir dependência de equipamento incompatível ou não confirmado.',
      priority: 'CRITICAL',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({ fact: 'HAS_EQUIPMENT', operator: 'IS', value: true }),
          Object.freeze({ fact: 'NO_EQUIPMENT', operator: 'IS', value: true }),
        ]),
      }),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'RESOURCE_MATCH',
          'Movimento deve corresponder ao recurso confirmado.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNAVAILABLE_RESOURCE',
          'Equipamento ausente torna orientação inviável.',
        ),
      ],
      educationalMessages: [
        education(
          'EQUIPMENT_COMPATIBILITY',
          'Explicar compatibilidade de recursos.',
          ['AVAILABLE', 'SAFE_USE', 'ALTERNATIVE'],
        ),
      ],
      evidenceReferences: [EVIDENCE.ACSM_EXERCISE],
    }),
    definePackage({
      id: P.ENVIRONMENT_COMPATIBILITY,
      domain: D.SAFETY,
      objective: 'Impedir prática incompatível com ambiente confirmado.',
      priority: 'CRITICAL',
      whenToApply: boolean('HAS_ENVIRONMENT'),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'SAFE_ENVIRONMENT',
          'Espaço, piso e clima devem ser compatíveis.',
        ),
      ],
      negativeFactors: [
        factor(
          'ENVIRONMENT_MISMATCH',
          'Ambiente inadequado invalida a atividade proposta.',
        ),
      ],
      educationalMessages: [
        education(
          'ENVIRONMENT_COMPATIBILITY',
          'Explicar segurança ambiental.',
          ['SPACE', 'SURFACE', 'WEATHER', 'VISIBILITY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
    definePackage({
      id: P.CLINICAL_SAFETY_BOUNDARY,
      domain: D.SAFETY,
      objective:
        'Limitar orientação a educação geral diante de contexto clínico.',
      priority: 'CRITICAL',
      whenToApply: boolean('HAS_CLINICAL_CONTEXT'),
      dependencyPackageIds: [P.SAFETY_FOUNDATION],
      positiveFactors: [
        factor(
          'PROFESSIONAL_COORDINATION',
          'Prática deve respeitar acompanhamento existente.',
        ),
      ],
      negativeFactors: [
        factor(
          'CLINICAL_PROTOCOL',
          'Não criar prescrição clínica ou terapêutica.',
        ),
      ],
      educationalMessages: [
        education('CLINICAL_BOUNDARY', 'Explicar limite de orientação.', [
          'GENERAL_EDUCATION_ONLY',
          'NO_TREATMENT',
          'PROFESSIONAL_FOLLOW_UP',
        ]),
      ],
      limits: [
        Object.freeze({
          code: 'NO_CLINICAL_EXERCISE_PROTOCOL',
          enforcement: 'PROHIBIT',
          description: 'Não gerar protocolo para condição clínica.',
        }),
        Object.freeze({
          code: 'REQUIRE_PROFESSIONAL_REVIEW',
          enforcement: 'REQUIRE',
          description:
            'Exigir avaliação quando segurança depender da condição clínica.',
        }),
      ],
      evidenceReferences: [EVIDENCE.CDC_SAFETY],
    }),
  ]);
