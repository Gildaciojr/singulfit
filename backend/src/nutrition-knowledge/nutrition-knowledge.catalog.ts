import { FitnessGoal } from '@prisma/client';
import {
  NUTRITION_KNOWLEDGE_CATALOG_VERSION,
  NUTRITION_KNOWLEDGE_DOMAIN,
  NUTRITION_KNOWLEDGE_PACKAGE_ID,
  NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
  type NutritionEducationalMessage,
  type NutritionKnowledgeApplicability,
  type NutritionKnowledgeBooleanFact,
  type NutritionKnowledgeEvidenceReference,
  type NutritionKnowledgeFactor,
  type NutritionKnowledgeLimit,
  type NutritionKnowledgePackage,
  type NutritionKnowledgePackageId,
  type NutritionKnowledgeStringFact,
} from './nutrition-knowledge.contract';

type KnowledgePackageSeed = Omit<
  NutritionKnowledgePackage,
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
      NutritionKnowledgePackage,
      | 'whenNotToApply'
      | 'packageVersion'
      | 'conflictingPackageIds'
      | 'dependencyPackageIds'
      | 'positiveFactors'
      | 'negativeFactors'
      | 'educationalMessages'
      | 'limits'
      | 'evidenceReferences'
    >
  >;

const NEVER: NutritionKnowledgeApplicability = Object.freeze({
  match: 'ANY',
  conditions: Object.freeze([]),
});

const ALWAYS: NutritionKnowledgeApplicability = Object.freeze({
  match: 'ALL',
  conditions: Object.freeze([
    Object.freeze({ fact: 'ALWAYS', operator: 'ALWAYS' }),
  ]),
});

const GENERAL_LIMITS: readonly NutritionKnowledgeLimit[] = Object.freeze([
  Object.freeze({
    code: 'NO_DIAGNOSIS',
    enforcement: 'PROHIBIT',
    description: 'Não diagnosticar condições clínicas.',
  }),
  Object.freeze({
    code: 'NO_MEDICATION_OR_TREATMENT',
    enforcement: 'PROHIBIT',
    description: 'Não prescrever medicamentos nem tratamento clínico.',
  }),
  Object.freeze({
    code: 'PRESERVE_CONFIRMED_RESTRICTIONS',
    enforcement: 'REQUIRE',
    description: 'Respeitar alergias, intolerâncias e restrições confirmadas.',
  }),
]);

const EVIDENCE = {
  WHO_HEALTHY_DIET: Object.freeze({
    code: 'WHO_HEALTHY_DIET',
    authority: 'World Health Organization',
    scope: 'Alimentação saudável, variedade, fibras e densidade nutricional.',
  }),
  SPORTS_NUTRITION: Object.freeze({
    code: 'SPORTS_NUTRITION_POSITION',
    authority: 'ACSM / Academy of Nutrition and Dietetics',
    scope: 'Nutrição, hidratação e recuperação relacionadas ao exercício.',
  }),
  VEGETARIAN_DIETS: Object.freeze({
    code: 'VEGETARIAN_DIETS_POSITION',
    authority: 'Academy of Nutrition and Dietetics',
    scope: 'Planejamento de padrões vegetarianos e veganos.',
  }),
  NIDDK_INTOLERANCES: Object.freeze({
    code: 'NIDDK_DIGESTIVE_RESTRICTIONS',
    authority:
      'National Institute of Diabetes and Digestive and Kidney Diseases',
    scope: 'Limites educativos para lactose, glúten e doença celíaca.',
  }),
} satisfies Readonly<Record<string, NutritionKnowledgeEvidenceReference>>;

function factor(code: string, principle: string): NutritionKnowledgeFactor {
  return Object.freeze({ code, principle });
}

function education(
  code: string,
  learningObjective: string,
  keyPoints: readonly string[],
): NutritionEducationalMessage {
  return Object.freeze({
    code,
    learningObjective,
    keyPoints: Object.freeze([...keyPoints]),
  });
}

function definePackage(seed: KnowledgePackageSeed): NutritionKnowledgePackage {
  return deepFreeze({
    schemaVersion: NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
    catalogVersion: NUTRITION_KNOWLEDGE_CATALOG_VERSION,
    ...seed,
    packageVersion: seed.packageVersion ?? 1,
    whenNotToApply: seed.whenNotToApply ?? NEVER,
    conflictingPackageIds: [...(seed.conflictingPackageIds ?? [])],
    dependencyPackageIds: [...(seed.dependencyPackageIds ?? [])],
    positiveFactors: [...(seed.positiveFactors ?? [])],
    negativeFactors: [...(seed.negativeFactors ?? [])],
    educationalMessages: [...(seed.educationalMessages ?? [])],
    limits: [...GENERAL_LIMITS, ...(seed.limits ?? [])],
    evidenceReferences: [...(seed.evidenceReferences ?? [])],
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const P = NUTRITION_KNOWLEDGE_PACKAGE_ID;
const D = NUTRITION_KNOWLEDGE_DOMAIN;

function booleanApplicability(
  factName: NutritionKnowledgeBooleanFact,
): NutritionKnowledgeApplicability {
  return Object.freeze({
    match: 'ALL',
    conditions: Object.freeze([
      Object.freeze({ fact: factName, operator: 'IS', value: true }),
    ]),
  });
}

function stringApplicability(
  factName: NutritionKnowledgeStringFact,
  values: readonly string[],
): NutritionKnowledgeApplicability {
  return Object.freeze({
    match: 'ALL',
    conditions: Object.freeze([
      Object.freeze({
        fact: factName,
        operator: 'CONTAINS_ANY',
        values: Object.freeze([...values]),
      }),
    ]),
  });
}

function defineClinicalSafetyPackage(input: {
  readonly id: NutritionKnowledgePackageId;
  readonly fact: NutritionKnowledgeBooleanFact;
  readonly objective: string;
  readonly educationCode: string;
  readonly keyPoints: readonly string[];
}): NutritionKnowledgePackage {
  return definePackage({
    id: input.id,
    domain: D.CLINICAL_RESTRICTIONS,
    objective: input.objective,
    priority: 'CRITICAL',
    whenToApply: booleanApplicability(input.fact),
    dependencyPackageIds: [P.CLINICAL_SAFETY_BOUNDARY],
    positiveFactors: [
      factor(
        'CONFIRMED_CONSTRAINTS',
        'Toda orientação deve preservar a condição declarada e o acompanhamento profissional existente.',
      ),
    ],
    negativeFactors: [
      factor(
        'CLINICAL_PROTOCOL',
        'Conhecimento educacional não autoriza diagnóstico, tratamento ou protocolo clínico.',
      ),
      factor(
        'AGGRESSIVE_RESTRICTION',
        'Restrições agressivas não devem ser introduzidas em contexto clínico.',
      ),
    ],
    educationalMessages: [
      education(input.educationCode, input.objective, input.keyPoints),
    ],
    limits: [
      Object.freeze({
        code: `${input.educationCode}_EDUCATIONAL_ONLY`,
        enforcement: 'REQUIRE',
        description:
          'Manter conteúdo educacional, conservador e coordenado com profissional habilitado.',
      }),
    ],
    evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
  });
}

export const NUTRITION_KNOWLEDGE_PACKAGES: readonly NutritionKnowledgePackage[] =
  deepFreeze([
    definePackage({
      id: P.HEALTHY_EATING_FOUNDATION,
      domain: D.HEALTHY_EATING,
      objective:
        'Estabelecer princípios gerais de alimentação variada, adequada e sustentável.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'FOOD_VARIETY',
          'Variar grupos e fontes alimentares favorece adequação nutricional.',
        ),
        factor(
          'FIBER_RICH_FOODS',
          'Alimentos ricos em fibras contribuem para saciedade e saúde digestiva.',
        ),
        factor(
          'MINIMALLY_PROCESSED_BASE',
          'Uma base de alimentos in natura ou minimamente processados favorece densidade nutricional.',
        ),
        factor(
          'HEALTHY_FAT_QUALITY',
          'A qualidade e a variedade das fontes de gordura integram uma alimentação equilibrada.',
        ),
        factor(
          'MICRONUTRIENT_FOOD_VARIETY',
          'Variedade de grupos alimentares apoia oferta de ferro, cálcio, magnésio, zinco, potássio e vitaminas.',
        ),
      ],
      negativeFactors: [
        factor(
          'RIGIDITY',
          'Rigidez excessiva reduz sustentabilidade e aderência.',
        ),
      ],
      educationalMessages: [
        education(
          'BALANCED_PLATE_EDUCATION',
          'Explicar equilíbrio sem moralizar alimentos.',
          [
            'VARIETY',
            'PROPORTIONALITY',
            'CONTEXT',
            'CONSISTENCY_OVER_PERFECTION',
          ],
        ),
        education(
          'FIBER_AND_FAT_EDUCATION',
          'Relacionar fibras, saciedade e qualidade das gorduras sem prescrever quantidades.',
          ['FIBER_SOURCES', 'SATIETY', 'FAT_QUALITY', 'FOOD_CONTEXT'],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
    }),
    definePackage({
      id: P.NUTRITION_EDUCATION_FOUNDATION,
      domain: D.NUTRITION_EDUCATION,
      objective: 'Transformar orientação em compreensão aplicável à rotina.',
      priority: 'SUPPORTING',
      whenToApply: ALWAYS,
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION],
      positiveFactors: [
        factor(
          'EXPLAIN_WHY',
          'Explicar o motivo da orientação aumenta autonomia.',
        ),
        factor(
          'ACTIONABLE_EXAMPLE',
          'Relacionar o conceito a uma escolha concreta facilita aprendizagem.',
        ),
        factor(
          'LABEL_LITERACY',
          'Leitura contextual de rótulos favorece escolhas conscientes sem classificar alimentos isoladamente.',
        ),
        factor(
          'SUSTAINABLE_AUTONOMY',
          'Compreensão e prática gradual favorecem autonomia e hábitos sustentáveis.',
        ),
      ],
      negativeFactors: [
        factor(
          'INFORMATION_OVERLOAD',
          'Excesso de conceitos simultâneos reduz compreensão.',
        ),
      ],
      educationalMessages: [
        education(
          'ONE_CONCEPT_AT_A_TIME',
          'Priorizar um conceito central por interação.',
          ['CONCEPT', 'REASON', 'PRACTICAL_APPLICATION'],
        ),
        education(
          'LABEL_AND_AUTONOMY_EDUCATION',
          'Ensinar leitura de rótulos e tomada de decisão contextual.',
          ['INGREDIENTS', 'SERVING_CONTEXT', 'COMPARISON', 'AUTONOMY'],
        ),
      ],
    }),
    definePackage({
      id: P.WEIGHT_LOSS,
      domain: D.WEIGHT_LOSS,
      objective:
        'Apoiar redução de peso sustentável preservando saciedade e aderência.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'PRIMARY_GOAL',
            operator: 'EQUALS',
            value: FitnessGoal.WEIGHT_LOSS,
          }),
        ]),
      }),
      conflictingPackageIds: [P.HYPERTROPHY, P.MAINTENANCE],
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION, P.BEHAVIOR_ADHERENCE],
      positiveFactors: [
        factor(
          'ENERGY_DEFICIT',
          'O déficit energético deve ser compatível com segurança, rotina e aderência.',
        ),
        factor(
          'SATIETY',
          'Proteína, fibras, volume alimentar e regularidade podem apoiar saciedade.',
        ),
        factor(
          'ENERGY_DENSITY',
          'A densidade energética ajuda a ajustar porções sem depender de proibições.',
        ),
        factor(
          'EATING_OUT_PLANNING',
          'Planejamento flexível sustenta escolhas em refeições fora de casa.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Restrição agressiva aumenta risco de baixa aderência e inadequação.',
        ),
        factor(
          'ALL_OR_NOTHING',
          'Pensamento tudo-ou-nada prejudica consistência.',
        ),
      ],
      educationalMessages: [
        education(
          'WEIGHT_LOSS_FOUNDATIONS',
          'Explicar emagrecimento como processo de consistência.',
          ['ENERGY_BALANCE', 'SATIETY', 'FIBER', 'PROTEIN', 'ADHERENCE'],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
    }),
    definePackage({
      id: P.HYPERTROPHY,
      domain: D.HYPERTROPHY,
      objective:
        'Apoiar ganho de massa muscular com energia, proteína, treino e recuperação coerentes.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'PRIMARY_GOAL',
            operator: 'EQUALS',
            value: FitnessGoal.MUSCLE_GAIN,
          }),
        ]),
      }),
      conflictingPackageIds: [P.WEIGHT_LOSS, P.MAINTENANCE],
      dependencyPackageIds: [
        P.HEALTHY_EATING_FOUNDATION,
        P.SPORTS_NUTRITION_FOUNDATION,
      ],
      positiveFactors: [
        factor(
          'ADEQUATE_ENERGY',
          'Disponibilidade energética adequada apoia treino e recuperação.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuir fontes proteicas ao longo do dia favorece consistência da ingestão.',
        ),
        factor(
          'TRAINING_ALIGNMENT',
          'A estratégia alimentar deve acompanhar estímulo e rotina de treino.',
        ),
        factor(
          'RECOVERY',
          'Sono, hidratação e alimentação participam da recuperação.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNCONTROLLED_SURPLUS',
          'Superávit indiscriminado não garante melhor ganho muscular.',
        ),
        factor(
          'SINGLE_MEAL_CONCENTRATION',
          'Concentrar toda a ingestão em uma refeição pode dificultar adequação.',
        ),
      ],
      educationalMessages: [
        education(
          'HYPERTROPHY_FOUNDATIONS',
          'Relacionar alimentação, treino e recuperação.',
          [
            'PROTEIN',
            'DISTRIBUTION',
            'ENERGY_AVAILABILITY',
            'TRAINING',
            'RECOVERY',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.MAINTENANCE,
      domain: D.MAINTENANCE,
      objective:
        'Sustentar composição corporal e rotina com equilíbrio energético flexível.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'PRIMARY_GOAL',
            operator: 'EQUALS',
            value: FitnessGoal.MAINTENANCE,
          }),
        ]),
      }),
      conflictingPackageIds: [P.WEIGHT_LOSS, P.HYPERTROPHY],
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION, P.BEHAVIOR_ADHERENCE],
      positiveFactors: [
        factor(
          'ENERGY_BALANCE',
          'A manutenção depende de equilíbrio energético observado ao longo do tempo.',
        ),
        factor(
          'ROUTINE_STABILITY',
          'Rotinas simples e repetíveis favorecem estabilidade.',
        ),
        factor(
          'FLEXIBLE_ADHERENCE',
          'Flexibilidade planejada apoia manutenção de longo prazo.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNMONITORED_ROUTINE_CHANGE',
          'Mudanças de rotina podem alterar ingestão e gasto sem percepção.',
        ),
      ],
      educationalMessages: [
        education(
          'MAINTENANCE_FOUNDATIONS',
          'Explicar manutenção como processo ativo.',
          ['ENERGY_BALANCE', 'ROUTINE', 'ADHERENCE', 'MONITORING'],
        ),
      ],
    }),
    definePackage({
      id: P.SPORTS_NUTRITION_FOUNDATION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Alinhar alimentação, hidratação e recuperação às demandas do exercício.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'RUNNING',
              'CORRIDA',
              'CYCLING',
              'CICLISMO',
              'BIKE',
              'CROSSFIT',
              'CROSS TRAINING',
              'STRENGTH',
              'FORCA',
              'MUSCULACAO',
              'FUNCTIONAL',
              'FUNCIONAL',
              'HIIT',
              'ENDURANCE',
              'RESISTENCIA',
              'HYBRID',
              'HIBRIDO',
              'HIBRIDA',
            ]),
          }),
        ]),
      }),
      dependencyPackageIds: [P.HYDRATION, P.MEAL_TIMING],
      positiveFactors: [
        factor(
          'TRAINING_DEMAND',
          'Volume, intensidade, duração e ambiente modificam necessidades.',
        ),
        factor(
          'RECOVERY_WINDOW',
          'A recuperação considera alimentação total, hidratação e intervalo até o próximo treino.',
        ),
      ],
      negativeFactors: [
        factor(
          'ONE_SIZE_FITS_ALL',
          'Uma estratégia única não atende modalidades e sessões diferentes.',
        ),
      ],
      educationalMessages: [
        education(
          'SPORTS_CONTEXT',
          'Explicar que a sessão determina a estratégia.',
          ['DURATION', 'INTENSITY', 'ENVIRONMENT', 'RECOVERY_TIME'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.RUNNING,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Estruturar princípios de alimentação e hidratação para corrida.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['RUNNING', 'CORRIDA', 'RUN']),
          }),
        ]),
      }),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'PRE_RUN_TOLERANCE',
          'A refeição pré-corrida deve considerar tempo disponível e tolerância gastrointestinal.',
        ),
        factor(
          'POST_RUN_RECOVERY',
          'A recuperação deve repor energia, líquidos e oferecer proteína conforme a demanda.',
        ),
        factor(
          'ENVIRONMENTAL_HYDRATION',
          'Clima, suor e duração influenciam hidratação.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNTESTED_RACE_STRATEGY',
          'Estratégias novas não devem ser testadas pela primeira vez em competição.',
        ),
      ],
      educationalMessages: [
        education(
          'RUNNING_FUELING',
          'Diferenciar pré, durante e pós-corrida.',
          ['TIMING', 'TOLERANCE', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.CROSSFIT,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Apoiar sessões de alta intensidade com energia, carboidrato e recuperação.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['CROSSFIT', 'CROSS FIT', 'CROSS TRAINING']),
          }),
        ]),
      }),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Carboidratos contribuem para demandas de alta intensidade.',
        ),
        factor(
          'BETWEEN_SESSION_RECOVERY',
          'Frequência e proximidade entre sessões orientam recuperação.',
        ),
        factor(
          'HYDRATION',
          'Hidratação deve acompanhar intensidade, ambiente e suor.',
        ),
      ],
      negativeFactors: [
        factor(
          'INTENSITY_WITH_LOW_AVAILABILITY',
          'Baixa disponibilidade energética pode comprometer desempenho e recuperação.',
        ),
      ],
      educationalMessages: [
        education(
          'CROSSFIT_FUELING',
          'Relacionar intensidade a combustível e recuperação.',
          ['CARBOHYDRATE', 'INTENSITY', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.CYCLING,
      domain: D.SPORTS_NUTRITION,
      objective: 'Apoiar energia, hidratação e recuperação no ciclismo.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['CYCLING', 'CICLISMO', 'BIKE', 'BICICLETA']),
          }),
        ]),
      }),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'DURATION_AWARE_ENERGY',
          'A duração do pedal modifica a necessidade de energia durante a sessão.',
        ),
        factor(
          'FLUID_ACCESS_PLAN',
          'O acesso a líquidos deve ser planejado conforme percurso e clima.',
        ),
        factor(
          'POST_RIDE_RECOVERY',
          'Recuperação considera reposição energética, líquidos e proteína.',
        ),
      ],
      negativeFactors: [
        factor(
          'LATE_FUELING',
          'Esperar queda acentuada de energia dificulta sustentar sessões longas.',
        ),
      ],
      educationalMessages: [
        education(
          'CYCLING_FUELING',
          'Planejar alimentação pelo percurso e duração.',
          ['DURATION', 'ENERGY', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.VEGETARIAN,
      domain: D.CLINICAL_RESTRICTIONS,
      objective:
        'Apoiar padrão vegetariano com variedade e substituições nutricionalmente coerentes.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'DIETARY_PATTERN',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'VEGETARIAN',
              'VEGETARIANO',
              'OVOLACTOVEGETARIANO',
            ]),
          }),
          Object.freeze({
            fact: 'FOOD_CONSTRAINT',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['VEGETARIAN', 'VEGETARIANO']),
          }),
        ]),
      }),
      conflictingPackageIds: [P.VEGAN],
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION, P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'PROTEIN_VARIETY',
          'Variar leguminosas e outras fontes proteicas apoia adequação.',
        ),
        factor(
          'MICRONUTRIENT_AWARENESS',
          'Ferro, cálcio, zinco, vitamina B12 e vitamina D merecem atenção conforme o padrão.',
        ),
      ],
      negativeFactors: [
        factor(
          'REMOVAL_WITHOUT_REPLACEMENT',
          'Retirar alimentos sem substituição adequada pode reduzir qualidade nutricional.',
        ),
      ],
      educationalMessages: [
        education(
          'VEGETARIAN_BALANCE',
          'Ensinar substituição por função nutricional.',
          [
            'PROTEIN_SOURCES',
            'VARIETY',
            'IRON_AND_ZINC_AWARENESS',
            'CALCIUM_AWARENESS',
            'B12_AND_VITAMIN_D_AWARENESS',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.VEGETARIAN_DIETS],
    }),
    definePackage({
      id: P.VEGAN,
      domain: D.CLINICAL_RESTRICTIONS,
      objective:
        'Apoiar padrão vegano com planejamento de proteínas, substituições e micronutrientes.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'DIETARY_PATTERN',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['VEGAN', 'VEGANO']),
          }),
          Object.freeze({
            fact: 'FOOD_CONSTRAINT',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['VEGAN', 'VEGANO']),
          }),
        ]),
      }),
      conflictingPackageIds: [P.VEGETARIAN],
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION, P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'PLANT_PROTEIN_VARIETY',
          'Diversidade de fontes vegetais ajuda a compor ingestão proteica.',
        ),
        factor(
          'B12_ATTENTION',
          'Vitamina B12 exige atenção específica em padrões veganos.',
        ),
        factor(
          'MICRONUTRIENT_PLANNING',
          'Ferro, cálcio, zinco, vitamina B12, vitamina D, iodo e ômega-3 podem exigir avaliação individual.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNPLANNED_EXCLUSION',
          'Exclusão sem planejamento aumenta risco de inadequação.',
        ),
      ],
      educationalMessages: [
        education(
          'VEGAN_BALANCE',
          'Ensinar planejamento alimentar vegano sem prescrever suplementação.',
          [
            'PROTEIN_VARIETY',
            'B12_AWARENESS',
            'MICRONUTRIENT_AWARENESS',
            'SUBSTITUTION',
          ],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_SUPPLEMENT_PRESCRIPTION',
          enforcement: 'PROHIBIT',
          description:
            'Não prescrever suplementação ou dose sem avaliação profissional.',
        }),
      ],
      evidenceReferences: [EVIDENCE.VEGETARIAN_DIETS],
    }),
    definePackage({
      id: P.LACTOSE_INTOLERANCE,
      domain: D.CLINICAL_RESTRICTIONS,
      objective:
        'Apoiar escolhas compatíveis com intolerância à lactose declarada.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'FOOD_CONSTRAINT',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'LACTOSE',
              'INTOLERANCIA A LACTOSE',
              'SEM LACTOSE',
            ]),
          }),
        ]),
      }),
      dependencyPackageIds: [P.FOOD_RESTRICTION_SAFETY, P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'TOLERANCE_AWARE_SUBSTITUTION',
          'Substituições devem respeitar tolerância individual e função nutricional.',
        ),
        factor(
          'CALCIUM_SOURCE_AWARENESS',
          'A retirada de laticínios pede atenção a fontes alternativas de cálcio.',
        ),
      ],
      negativeFactors: [
        factor(
          'MILK_ALLERGY_EQUIVALENCE',
          'Intolerância à lactose não deve ser tratada como alergia à proteína do leite.',
        ),
      ],
      educationalMessages: [
        education(
          'LACTOSE_EDUCATION',
          'Diferenciar lactose, laticínios e alergia ao leite.',
          ['INDIVIDUAL_TOLERANCE', 'LABEL_READING', 'NUTRIENT_REPLACEMENT'],
        ),
      ],
      evidenceReferences: [EVIDENCE.NIDDK_INTOLERANCES],
    }),
    definePackage({
      id: P.GLUTEN_RESTRICTION,
      domain: D.CLINICAL_RESTRICTIONS,
      objective:
        'Preservar restrição ao glúten declarada sem diagnosticar sua causa.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'FOOD_CONSTRAINT',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['GLUTEN', 'CELIACA', 'CELIACO', 'CELIAC']),
          }),
        ]),
      }),
      dependencyPackageIds: [P.FOOD_RESTRICTION_SAFETY, P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'SAFE_ALTERNATIVES',
          'Alternativas devem manter variedade e adequação nutricional.',
        ),
        factor(
          'CROSS_CONTACT_AWARENESS',
          'Doença celíaca declarada exige atenção a contaminação cruzada.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNNECESSARY_CLINICAL_CLAIM',
          'Não atribuir sintomas ou diagnóstico ao glúten.',
        ),
      ],
      educationalMessages: [
        education(
          'GLUTEN_EDUCATION',
          'Ensinar substituição segura sem estabelecer diagnóstico.',
          ['LABEL_READING', 'CROSS_CONTACT_IF_CELIAC', 'NUTRIENT_REPLACEMENT'],
        ),
      ],
      evidenceReferences: [EVIDENCE.NIDDK_INTOLERANCES],
    }),
    definePackage({
      id: P.FOOD_RESTRICTION_SAFETY,
      domain: D.SAFETY,
      objective:
        'Tornar restrições e alergias confirmadas invariantes da estratégia.',
      priority: 'CRITICAL',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_FOOD_CONSTRAINTS',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'CONFIRMED_CONSTRAINTS',
          'Restrições confirmadas devem permanecer explícitas em todo artefato.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNVERIFIED_REMOVAL',
          'Restrições inferidas não devem ser promovidas silenciosamente a diagnóstico.',
        ),
      ],
      educationalMessages: [
        education(
          'RESTRICTION_SAFETY',
          'Explicar como preservar segurança nas escolhas.',
          [
            'CONFIRMED_RESTRICTION',
            'LABEL_READING',
            'CROSS_CONTACT_WHEN_RELEVANT',
          ],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_REINTRODUCTION_OF_RESTRICTED_FOOD',
          enforcement: 'PROHIBIT',
          description:
            'Não sugerir alimento incompatível com restrição ou alergia confirmada.',
        }),
      ],
    }),
    definePackage({
      id: P.FOOD_SUBSTITUTION,
      domain: D.FOOD_SUBSTITUTION,
      objective:
        'Substituir alimentos preservando função nutricional, preferência, acesso e segurança.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_FOOD_CONSTRAINTS',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'HAS_FOOD_REJECTIONS',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'FOOD_BUDGET',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['LOW', 'BAIXO']),
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'FUNCTIONAL_EQUIVALENCE',
          'A substituição deve preservar a função principal do alimento na refeição.',
        ),
        factor(
          'ACCESSIBILITY',
          'Disponibilidade, custo e preparo fazem parte da equivalência prática.',
        ),
      ],
      negativeFactors: [
        factor(
          'NAME_ONLY_SWAP',
          'Trocar pelo nome sem considerar nutrientes e papel da refeição é insuficiente.',
        ),
      ],
      educationalMessages: [
        education('SUBSTITUTION_LOGIC', 'Ensinar substituição por função.', [
          'NUTRITIONAL_ROLE',
          'PORTION_CONTEXT',
          'PREFERENCE',
          'ACCESS',
        ]),
      ],
    }),
    definePackage({
      id: P.BUDGET_LOW,
      domain: D.FOOD_BUDGET,
      objective:
        'Priorizar alimentação acessível, nutritiva e operacionalmente simples.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'FOOD_BUDGET',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['LOW', 'BAIXO', 'LIMITADO']),
          }),
        ]),
      }),
      conflictingPackageIds: [P.BUDGET_MEDIUM, P.BUDGET_HIGH],
      dependencyPackageIds: [P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'STAPLE_FOODS',
          'Alimentos básicos, sazonais e de boa disponibilidade podem compor uma base nutritiva.',
        ),
        factor(
          'WASTE_REDUCTION',
          'Planejamento e aproveitamento reduzem desperdício e custo.',
        ),
      ],
      negativeFactors: [
        factor(
          'EXPENSIVE_DEFAULTS',
          'Não pressupor produtos especiais ou caros como necessários.',
        ),
      ],
      educationalMessages: [
        education(
          'LOW_BUDGET_STRATEGY',
          'Ensinar escolhas por custo e função.',
          ['STAPLES', 'SEASONALITY', 'BATCH_PREPARATION', 'WASTE_REDUCTION'],
        ),
      ],
    }),
    definePackage({
      id: P.BUDGET_MEDIUM,
      domain: D.FOOD_BUDGET,
      objective: 'Equilibrar variedade, conveniência e custo moderado.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'FOOD_BUDGET',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['MEDIUM', 'MODERATE', 'MEDIO', 'MODERADO']),
          }),
        ]),
      }),
      conflictingPackageIds: [P.BUDGET_LOW, P.BUDGET_HIGH],
      positiveFactors: [
        factor(
          'COST_CONVENIENCE_BALANCE',
          'Combinar alimentos básicos com conveniências úteis preserva custo e rotina.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNNECESSARY_SPECIALTY_PRODUCTS',
          'Produtos especiais não devem ser pressupostos sem necessidade.',
        ),
      ],
      educationalMessages: [
        education(
          'MEDIUM_BUDGET_STRATEGY',
          'Ensinar equilíbrio entre praticidade e custo.',
          ['BASIC_FOODS', 'SELECTIVE_CONVENIENCE', 'VARIETY'],
        ),
      ],
    }),
    definePackage({
      id: P.BUDGET_HIGH,
      domain: D.FOOD_BUDGET,
      objective:
        'Usar maior flexibilidade financeira sem confundir preço com qualidade nutricional.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'FOOD_BUDGET',
            operator: 'CONTAINS_ANY',
            values: Object.freeze(['HIGH', 'ALTO']),
          }),
        ]),
      }),
      conflictingPackageIds: [P.BUDGET_LOW, P.BUDGET_MEDIUM],
      positiveFactors: [
        factor(
          'ACCESS_FLEXIBILITY',
          'Maior acesso permite ampliar variedade e conveniência conforme preferência.',
        ),
      ],
      negativeFactors: [
        factor(
          'PRICE_EQUALS_QUALITY',
          'Preço elevado não determina superioridade nutricional.',
        ),
      ],
      educationalMessages: [
        education(
          'HIGH_BUDGET_STRATEGY',
          'Ensinar escolha por adequação, não por preço.',
          ['QUALITY', 'PREFERENCE', 'CONVENIENCE', 'VARIETY'],
        ),
      ],
    }),
    definePackage({
      id: P.LIMITED_COOKING_TIME,
      domain: D.ROUTINE,
      objective: 'Adaptar alimentação a pouco tempo disponível para cozinhar.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'COOKING_AVAILABILITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'LOW',
              'BAIXA',
              'LIMITED',
              'LIMITADA',
              'POUCO TEMPO',
              'SEM TEMPO',
            ]),
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'BATCH_PREPARATION',
          'Preparos base e reaproveitamento seguro reduzem esforço diário.',
        ),
        factor(
          'SIMPLE_ASSEMBLY',
          'Refeições de montagem simples aumentam viabilidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'COMPLEX_DAILY_RECIPES',
          'Receitas complexas diárias reduzem aderência em rotina restrita.',
        ),
      ],
      educationalMessages: [
        education('LOW_TIME_ROUTINE', 'Ensinar simplificação operacional.', [
          'BASE_PREPARATION',
          'SIMPLE_ASSEMBLY',
          'SAFE_STORAGE',
          'CONVENIENT_OPTIONS',
        ]),
      ],
    }),
    definePackage({
      id: P.MEALS_AWAY_FROM_HOME,
      domain: D.ROUTINE,
      objective: 'Apoiar escolhas consistentes em refeições fora de casa.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'MEALS_AWAY_FROM_HOME',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'EATING_OUT_FREQUENCY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'FREQUENT',
              'FREQUENTLY',
              'ALWAYS',
              'HIGH',
              'MUITO',
              'FREQUENTE',
            ]),
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'MENU_PATTERN_RECOGNITION',
          'Reconhecer composição e porções do prato ajuda decisões sem exigir perfeição.',
        ),
        factor(
          'FLEXIBLE_PLANNING',
          'Planejar o restante do dia evita compensações extremas.',
        ),
      ],
      negativeFactors: [
        factor(
          'COMPENSATORY_RESTRICTION',
          'Compensar refeições fora com restrição extrema prejudica aderência.',
        ),
      ],
      educationalMessages: [
        education(
          'EATING_OUT_STRATEGY',
          'Ensinar leitura prática da refeição.',
          [
            'PROTEIN_SOURCE',
            'VEGETABLES',
            'ENERGY_SOURCE',
            'PORTION_CONTEXT',
            'FLEXIBILITY',
          ],
        ),
      ],
    }),
    definePackage({
      id: P.MEAL_TIMING,
      domain: D.MEAL_TIMING,
      objective:
        'Organizar horários conforme rotina, treino, fome e tolerância.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_MEAL_TIMES',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'HAS_TRAINING_TIME',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'ROUTINE_ALIGNMENT',
          'Horários devem ser praticáveis e compatíveis com treino e sono.',
        ),
      ],
      negativeFactors: [
        factor(
          'RIGID_CLOCK',
          'Horários rígidos sem necessidade podem reduzir aderência.',
        ),
      ],
      educationalMessages: [
        education(
          'MEAL_TIMING_EDUCATION',
          'Explicar timing como ferramenta contextual.',
          ['ROUTINE', 'HUNGER', 'TRAINING', 'TOLERANCE'],
        ),
      ],
    }),
    definePackage({
      id: P.HYDRATION,
      domain: D.HYDRATION,
      objective:
        'Manter hidratação contextualizada por rotina, clima e exercício.',
      priority: 'STANDARD',
      whenToApply: ALWAYS,
      positiveFactors: [
        factor(
          'REGULAR_ACCESS',
          'Acesso regular a líquidos facilita consistência.',
        ),
        factor(
          'EXERCISE_CONTEXT',
          'Duração, intensidade, ambiente e suor alteram a estratégia.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNIVERSAL_FIXED_VOLUME',
          'Um volume fixo universal ignora diferenças individuais e ambientais.',
        ),
      ],
      educationalMessages: [
        education(
          'HYDRATION_CONTEXT',
          'Ensinar sinais e contextos que modificam hidratação.',
          ['ROUTINE', 'CLIMATE', 'SWEAT', 'EXERCISE_DURATION'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.FOOD_PREFERENCES,
      domain: D.PREFERENCES,
      objective:
        'Usar alimentos preferidos para aumentar adequação e aderência.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_FOOD_PREFERENCES',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'PREFERENCE_ALIGNMENT',
          'Preferências confirmadas aumentam viabilidade do plano.',
        ),
      ],
      negativeFactors: [
        factor('MONOTONY', 'Usar apenas favoritos pode reduzir variedade.'),
      ],
      educationalMessages: [
        education(
          'PREFERENCE_INTEGRATION',
          'Ensinar como favoritos cabem em uma alimentação variada.',
          ['FAVORITES', 'VARIETY', 'PORTION_CONTEXT'],
        ),
      ],
    }),
    definePackage({
      id: P.FOOD_REJECTIONS,
      domain: D.PREFERENCES,
      objective:
        'Evitar alimentos rejeitados e oferecer equivalentes aceitáveis.',
      priority: 'HIGH',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_FOOD_REJECTIONS',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      dependencyPackageIds: [P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'ACCEPTABLE_ALTERNATIVES',
          'Alternativas aceitáveis sustentam a função nutricional sem coerção.',
        ),
      ],
      negativeFactors: [
        factor(
          'FORCED_EXPOSURE',
          'Não insistir em alimento rejeitado como única solução.',
        ),
      ],
      educationalMessages: [
        education(
          'REJECTION_RESPECT',
          'Ensinar equivalências respeitando rejeições.',
          ['REJECTION', 'ALTERNATIVE', 'NUTRITIONAL_ROLE'],
        ),
      ],
    }),
    definePackage({
      id: P.BEHAVIOR_ADHERENCE,
      domain: D.BEHAVIOR,
      objective: 'Adaptar complexidade e metas à aderência observada.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_ADHERENCE_CONTEXT',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'SMALL_REPEATABLE_ACTIONS',
          'Ações pequenas e repetíveis favorecem continuidade.',
        ),
      ],
      negativeFactors: [
        factor(
          'MORAL_JUDGMENT',
          'Julgamento moral sobre escolhas reduz segurança psicológica.',
        ),
      ],
      educationalMessages: [
        education(
          'ADHERENCE_EDUCATION',
          'Tratar aderência como ajuste de sistema, não caráter.',
          ['BARRIERS', 'SMALL_STEP', 'FEEDBACK', 'ADAPTATION'],
        ),
      ],
    }),
    definePackage({
      id: P.CLINICAL_SAFETY_BOUNDARY,
      domain: D.SAFETY,
      objective:
        'Restringir orientação a educação geral diante de contexto clínico.',
      priority: 'CRITICAL',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_MEDICAL_CONTEXT',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'PROFESSIONAL_COORDINATION',
          'Orientação geral deve respeitar acompanhamento profissional existente.',
        ),
      ],
      negativeFactors: [
        factor(
          'CLINICAL_PROTOCOL',
          'Não criar protocolo para diabetes, doença renal, câncer ou outra doença grave.',
        ),
      ],
      educationalMessages: [
        education(
          'CLINICAL_BOUNDARY',
          'Explicar o limite de orientação com clareza.',
          ['GENERAL_EDUCATION_ONLY', 'NO_TREATMENT', 'PROFESSIONAL_FOLLOW_UP'],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_CLINICAL_PROTOCOL',
          enforcement: 'PROHIBIT',
          description: 'Não gerar protocolo clínico ou terapêutico.',
        }),
        Object.freeze({
          code: 'REQUIRE_PROFESSIONAL_FOLLOW_UP',
          enforcement: 'REQUIRE',
          description:
            'Indicar avaliação profissional quando a orientação depender da condição clínica.',
        }),
      ],
    }),
    definePackage({
      id: P.SPECIAL_POPULATION_BOUNDARY,
      domain: D.SPECIAL_POPULATIONS,
      objective:
        'Limitar recomendações individualizadas para populações que exigem avaliação específica.',
      priority: 'CRITICAL',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'IS_SPECIAL_POPULATION',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      positiveFactors: [
        factor(
          'INDIVIDUAL_ASSESSMENT',
          'Necessidades devem ser avaliadas conforme fase de vida e contexto clínico.',
        ),
      ],
      negativeFactors: [
        factor(
          'GENERIC_PROTOCOL',
          'Não aplicar protocolos genéricos a gestantes, menores ou idosos vulneráveis.',
        ),
      ],
      educationalMessages: [
        education(
          'SPECIAL_POPULATION_BOUNDARY',
          'Explicar necessidade de avaliação individual.',
          ['LIFE_STAGE', 'SAFETY', 'PROFESSIONAL_FOLLOW_UP'],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_PREGNANCY_PROTOCOL',
          enforcement: 'PROHIBIT',
          description: 'Não gerar protocolo nutricional para gestação.',
        }),
        Object.freeze({
          code: 'NO_SPECIAL_POPULATION_PROTOCOL',
          enforcement: 'PROHIBIT',
          description: 'Não gerar protocolo clínico para população especial.',
        }),
      ],
    }),
    definePackage({
      id: P.BODY_RECOMPOSITION,
      domain: D.BODY_COMPOSITION,
      objective:
        'Apoiar recomposição corporal conciliando energia, proteína, treino, recuperação e aderência.',
      priority: 'HIGH',
      whenToApply: stringApplicability('DESIRED_OUTCOME', [
        'RECOMPOSICAO',
        'RECOMPOSITION',
        'PERDER GORDURA E GANHAR MASSA',
      ]),
      conflictingPackageIds: [P.MUSCLE_PRESERVING_CUT, P.CONTROLLED_BULKING],
      dependencyPackageIds: [
        P.HEALTHY_EATING_FOUNDATION,
        P.PROTEIN_DISTRIBUTION_EDUCATION,
        P.BEHAVIOR_ADHERENCE,
      ],
      positiveFactors: [
        factor(
          'ENERGY_BALANCE',
          'Ajustes graduais preservam treino, recuperação e aderência.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuição proteica apoia preservação e desenvolvimento muscular.',
        ),
        factor(
          'TRAINING_ALIGNMENT',
          'A alimentação deve acompanhar o estímulo de treino e a recuperação.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Restrição agressiva conflita com recuperação e preservação muscular.',
        ),
      ],
      educationalMessages: [
        education(
          'BODY_RECOMPOSITION_FOUNDATIONS',
          'Explicar recomposição como processo gradual e multifatorial.',
          [
            'ENERGY_BALANCE',
            'PROTEIN_DISTRIBUTION',
            'TRAINING',
            'RECOVERY',
            'ADHERENCE',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.MUSCLE_PRESERVING_CUT,
      domain: D.WEIGHT_LOSS,
      objective:
        'Apoiar cutting conservador com prioridade para preservação de massa, treino e aderência.',
      priority: 'HIGH',
      whenToApply: stringApplicability('DESIRED_OUTCOME', [
        'CUTTING',
        'CUT',
        'DEFINICAO MUSCULAR',
        'PERDER GORDURA PRESERVANDO MASSA',
      ]),
      conflictingPackageIds: [P.BODY_RECOMPOSITION, P.CONTROLLED_BULKING],
      dependencyPackageIds: [P.HEALTHY_EATING_FOUNDATION, P.BEHAVIOR_ADHERENCE],
      positiveFactors: [
        factor(
          'ENERGY_DEFICIT',
          'O déficit deve ser moderado e compatível com desempenho e aderência.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuir proteína apoia preservação muscular.',
        ),
        factor(
          'RECOVERY',
          'Recuperação deve ser protegida durante redução energética.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Déficits agressivos não são compatíveis com preservação e segurança.',
        ),
      ],
      educationalMessages: [
        education(
          'MUSCLE_PRESERVING_CUT_EDUCATION',
          'Explicar cutting sem atalhos ou extremos.',
          [
            'MODERATE_ENERGY_ADJUSTMENT',
            'PROTEIN_DISTRIBUTION',
            'TRAINING_QUALITY',
            'RECOVERY',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.CONTROLLED_BULKING,
      domain: D.HYPERTROPHY,
      objective:
        'Apoiar bulking controlado com energia suficiente, proteína distribuída e monitoramento da rotina.',
      priority: 'HIGH',
      whenToApply: stringApplicability('DESIRED_OUTCOME', [
        'BULKING',
        'BULK',
        'GANHO DE MASSA CONTROLADO',
      ]),
      conflictingPackageIds: [P.BODY_RECOMPOSITION, P.MUSCLE_PRESERVING_CUT],
      dependencyPackageIds: [
        P.HEALTHY_EATING_FOUNDATION,
        P.SPORTS_NUTRITION_FOUNDATION,
      ],
      positiveFactors: [
        factor(
          'ADEQUATE_ENERGY',
          'Disponibilidade energética deve apoiar treino sem justificar excesso indiscriminado.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuição proteica complementa energia e estímulo de treino.',
        ),
        factor(
          'RECOVERY',
          'Recuperação integra o processo de desenvolvimento muscular.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNCONTROLLED_SURPLUS',
          'Excesso energético indiscriminado não define um bulking de qualidade.',
        ),
      ],
      educationalMessages: [
        education(
          'CONTROLLED_BULKING_EDUCATION',
          'Diferenciar adequação energética de excesso sem controle.',
          [
            'ADEQUATE_ENERGY',
            'PROTEIN_DISTRIBUTION',
            'TRAINING_ALIGNMENT',
            'MONITORING',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.STRENGTH_NUTRITION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Alinhar energia, proteína e recuperação ao treinamento de força.',
      priority: 'STANDARD',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'STRENGTH',
        'FORCA',
        'MUSCULACAO',
        'POWERLIFTING',
      ]),
      dependencyPackageIds: [
        P.SPORTS_NUTRITION_FOUNDATION,
        P.PROTEIN_DISTRIBUTION_EDUCATION,
      ],
      positiveFactors: [
        factor(
          'TRAINING_ALIGNMENT',
          'Energia e distribuição de nutrientes devem acompanhar sessões de força.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Fontes proteicas distribuídas apoiam recuperação muscular.',
        ),
        factor('RECOVERY', 'Recuperação entre sessões é parte do desempenho.'),
      ],
      educationalMessages: [
        education(
          'STRENGTH_NUTRITION_EDUCATION',
          'Relacionar alimentação à demanda de força sem protocolo rígido.',
          ['ENERGY_AVAILABILITY', 'PROTEIN_DISTRIBUTION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.FUNCTIONAL_TRAINING_NUTRITION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Apoiar energia, hidratação e recuperação no treinamento funcional.',
      priority: 'STANDARD',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'FUNCTIONAL',
        'FUNCIONAL',
      ]),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'TRAINING_DEMAND',
          'A estratégia deve considerar duração e intensidade registradas.',
        ),
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Carboidratos podem apoiar sessões com maior demanda energética.',
        ),
        factor('RECOVERY', 'Recuperação favorece consistência entre sessões.'),
      ],
      educationalMessages: [
        education(
          'FUNCTIONAL_TRAINING_EDUCATION',
          'Explicar suporte alimentar ao treino funcional.',
          ['ENERGY', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.HIIT_NUTRITION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Apoiar disponibilidade energética, hidratação e recuperação para HIIT.',
      priority: 'STANDARD',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'HIIT',
        'INTERVALADO DE ALTA INTENSIDADE',
        'HIGH INTENSITY INTERVAL',
      ]),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Disponibilidade energética deve acompanhar a intensidade registrada.',
        ),
        factor(
          'EXERCISE_CONTEXT',
          'Hidratação deve considerar o contexto da sessão.',
        ),
        factor(
          'RECOVERY_WINDOW',
          'Recuperação apoia a repetição de sessões intensas.',
        ),
      ],
      educationalMessages: [
        education(
          'HIIT_NUTRITION_EDUCATION',
          'Relacionar intensidade, energia e recuperação.',
          ['ENERGY', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.ENDURANCE_NUTRITION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Apoiar energia, hidratação e recuperação em atividades de endurance.',
      priority: 'HIGH',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'ENDURANCE',
        'RESISTENCIA',
        'LONGA DISTANCIA',
      ]),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'DURATION_AWARE_ENERGY',
          'A duração registrada deve modular o suporte energético.',
        ),
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Carboidratos têm papel estratégico em esforços prolongados.',
        ),
        factor(
          'EXERCISE_CONTEXT',
          'Hidratação deve acompanhar a demanda do exercício.',
        ),
        factor(
          'RECOVERY',
          'Recuperação deve considerar a proximidade entre sessões.',
        ),
      ],
      educationalMessages: [
        education(
          'ENDURANCE_NUTRITION_EDUCATION',
          'Explicar suporte nutricional de endurance sem prescrição individual.',
          ['DURATION', 'ENERGY', 'HYDRATION', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.HYBRID_TRAINING_NUTRITION,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Conciliar energia e recuperação quando força e endurance coexistem.',
      priority: 'HIGH',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'HYBRID',
        'HIBRIDO',
        'HIBRIDA',
        'FORCA E CORRIDA',
      ]),
      dependencyPackageIds: [
        P.SPORTS_NUTRITION_FOUNDATION,
        P.PROTEIN_DISTRIBUTION_EDUCATION,
      ],
      positiveFactors: [
        factor(
          'TRAINING_ALIGNMENT',
          'A estratégia deve reconhecer demandas concorrentes de força e resistência.',
        ),
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Disponibilidade de carboidratos apoia sessões de maior demanda.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuição proteica apoia recuperação muscular.',
        ),
        factor(
          'RECOVERY',
          'Recuperação entre modalidades deve orientar a praticidade da rotina.',
        ),
      ],
      educationalMessages: [
        education(
          'HYBRID_TRAINING_EDUCATION',
          'Explicar prioridades alimentares do treino híbrido.',
          ['SESSION_DEMAND', 'ENERGY', 'PROTEIN', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.BEGINNER_NUTRITION_GUIDANCE,
      domain: D.NUTRITION_EDUCATION,
      objective:
        'Priorizar fundamentos simples, exemplos práticos e progressão gradual para iniciantes.',
      priority: 'STANDARD',
      whenToApply: booleanApplicability('IS_BEGINNER'),
      conflictingPackageIds: [
        P.INTERMEDIATE_NUTRITION_GUIDANCE,
        P.ADVANCED_NUTRITION_GUIDANCE,
      ],
      dependencyPackageIds: [P.NUTRITION_EDUCATION_FOUNDATION],
      positiveFactors: [
        factor(
          'SMALL_REPEATABLE_ACTIONS',
          'Poucas ações repetíveis reduzem sobrecarga e favorecem aprendizagem.',
        ),
        factor(
          'ROUTINE_ALIGNMENT',
          'A orientação deve começar pela rotina real disponível.',
        ),
      ],
      negativeFactors: [
        factor(
          'COMPLEX_DAILY_RECIPES',
          'Complexidade desnecessária dificulta a execução inicial.',
        ),
      ],
      educationalMessages: [
        education(
          'BEGINNER_NUTRITION_EDUCATION',
          'Ensinar fundamentos antes de estratégias avançadas.',
          [
            'ONE_PRIORITY_AT_A_TIME',
            'PRACTICAL_EXAMPLE',
            'GRADUAL_PROGRESSION',
          ],
        ),
      ],
    }),
    definePackage({
      id: P.INTERMEDIATE_NUTRITION_GUIDANCE,
      domain: D.NUTRITION_EDUCATION,
      objective:
        'Consolidar autonomia e ajustes contextuais para experiência intermediária.',
      priority: 'STANDARD',
      whenToApply: booleanApplicability('IS_INTERMEDIATE'),
      conflictingPackageIds: [
        P.BEGINNER_NUTRITION_GUIDANCE,
        P.ADVANCED_NUTRITION_GUIDANCE,
      ],
      dependencyPackageIds: [P.NUTRITION_EDUCATION_FOUNDATION],
      positiveFactors: [
        factor(
          'FLEXIBLE_ADHERENCE',
          'Ajustes contextuais devem preservar consistência sem rigidez.',
        ),
        factor(
          'ROUTINE_ALIGNMENT',
          'Maior autonomia continua subordinada à rotina disponível.',
        ),
      ],
      educationalMessages: [
        education(
          'INTERMEDIATE_NUTRITION_EDUCATION',
          'Aprofundar relações entre escolhas, treino e recuperação.',
          ['CONTEXT', 'TRADE_OFFS', 'AUTONOMY'],
        ),
      ],
    }),
    definePackage({
      id: P.ADVANCED_NUTRITION_GUIDANCE,
      domain: D.NUTRITION_EDUCATION,
      objective:
        'Oferecer detalhamento contextual compatível com experiência avançada sem prescrição clínica.',
      priority: 'STANDARD',
      whenToApply: booleanApplicability('IS_ADVANCED'),
      conflictingPackageIds: [
        P.BEGINNER_NUTRITION_GUIDANCE,
        P.INTERMEDIATE_NUTRITION_GUIDANCE,
      ],
      dependencyPackageIds: [P.NUTRITION_EDUCATION_FOUNDATION],
      positiveFactors: [
        factor(
          'TRAINING_ALIGNMENT',
          'Detalhamento deve responder à modalidade, duração e intensidade registradas.',
        ),
        factor(
          'RECOVERY',
          'Recuperação e continuidade devem permanecer prioridades.',
        ),
      ],
      educationalMessages: [
        education(
          'ADVANCED_NUTRITION_EDUCATION',
          'Aprofundar estratégia sem criar protocolo individual prescritivo.',
          ['TRAINING_DEMAND', 'TIMING_CONTEXT', 'RECOVERY', 'SELF_MONITORING'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.PRE_WORKOUT_NUTRITION,
      domain: D.MEAL_TIMING,
      objective:
        'Apoiar conforto, energia e praticidade antes do treino conforme horários registrados.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_TRAINING_TIME',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'HAS_MEAL_TIMES',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      dependencyPackageIds: [P.MEAL_TIMING],
      positiveFactors: [
        factor(
          'ROUTINE_ALIGNMENT',
          'A refeição pré-treino deve caber na janela real disponível.',
        ),
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Fontes de carboidrato podem apoiar energia para a sessão.',
        ),
      ],
      educationalMessages: [
        education(
          'PRE_WORKOUT_EDUCATION',
          'Explicar escolhas pré-treino por proximidade, tolerância e praticidade.',
          ['TIMING', 'DIGESTIVE_COMFORT', 'ENERGY', 'PRACTICALITY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.INTRA_WORKOUT_NUTRITION,
      domain: D.MEAL_TIMING,
      objective:
        'Reconhecer suporte durante sessões prolongadas somente quando duração e modalidade o sustentam.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'SESSION_DURATION_MINUTES',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 60,
          }),
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'ENDURANCE',
              'RUNNING',
              'CORRIDA',
              'CYCLING',
              'CICLISMO',
              'BIKE',
              'HYBRID',
              'HIBRIDO',
            ]),
          }),
        ]),
      }),
      dependencyPackageIds: [
        P.SPORTS_NUTRITION_FOUNDATION,
        P.ELECTROLYTE_CAUTION,
      ],
      positiveFactors: [
        factor(
          'DURATION_AWARE_ENERGY',
          'Duração e modalidade registradas determinam se suporte durante a sessão é relevante.',
        ),
        factor(
          'EXERCISE_CONTEXT',
          'Ingestão hídrica deve ser contextual, sem protocolo universal.',
        ),
      ],
      educationalMessages: [
        education(
          'INTRA_WORKOUT_EDUCATION',
          'Explicar quando suporte durante o treino pode ser relevante.',
          ['DURATION', 'MODALITY', 'HYDRATION', 'ENERGY_AVAILABILITY'],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_UNIVERSAL_INTRA_WORKOUT_PROTOCOL',
          enforcement: 'PROHIBIT',
          description:
            'Não aplicar protocolo intra-treino sem contexto individual suficiente.',
        }),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.POST_WORKOUT_RECOVERY,
      domain: D.MEAL_TIMING,
      objective:
        'Apoiar recuperação pós-treino dentro da rotina alimentar registrada.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_TRAINING_TIME',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'HAS_MEAL_TIMES',
            operator: 'IS',
            value: true,
          }),
        ]),
      }),
      dependencyPackageIds: [P.MEAL_TIMING, P.PROTEIN_DISTRIBUTION_EDUCATION],
      positiveFactors: [
        factor(
          'RECOVERY_WINDOW',
          'A refeição posterior deve integrar a rotina, sem tratar uma janela como regra rígida.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Proteína distribuída ao longo do dia apoia recuperação.',
        ),
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Reposição energética ganha relevância conforme a demanda e a próxima sessão.',
        ),
      ],
      educationalMessages: [
        education(
          'POST_WORKOUT_EDUCATION',
          'Relacionar recuperação ao conjunto do dia.',
          [
            'PROTEIN_DISTRIBUTION',
            'ENERGY_REPLENISHMENT',
            'HYDRATION',
            'NEXT_SESSION',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.TRAINING_DAY_CARBOHYDRATE_SUPPORT,
      domain: D.SPORTS_NUTRITION,
      objective:
        'Explicar uso estratégico de carboidratos conforme demanda da modalidade.',
      priority: 'STANDARD',
      whenToApply: stringApplicability('TRAINING_MODALITY', [
        'RUNNING',
        'CORRIDA',
        'CYCLING',
        'CICLISMO',
        'CROSSFIT',
        'HIIT',
        'FUNCTIONAL',
        'FUNCIONAL',
        'ENDURANCE',
        'HYBRID',
        'HIBRIDO',
        'STRENGTH',
        'FORCA',
        'MUSCULACAO',
      ]),
      dependencyPackageIds: [P.SPORTS_NUTRITION_FOUNDATION],
      positiveFactors: [
        factor(
          'CARBOHYDRATE_AVAILABILITY',
          'Carboidratos podem ser distribuídos conforme demanda e rotina de treino.',
        ),
        factor(
          'TRAINING_ALIGNMENT',
          'A estratégia deve acompanhar modalidade, duração e intensidade registradas.',
        ),
      ],
      educationalMessages: [
        education(
          'STRATEGIC_CARBOHYDRATE_EDUCATION',
          'Explicar carboidratos como fonte de energia contextual.',
          ['TRAINING_DEMAND', 'TIMING', 'FOOD_SOURCES', 'RECOVERY'],
        ),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.PROTEIN_DISTRIBUTION_EDUCATION,
      domain: D.NUTRITION_EDUCATION,
      objective:
        'Explicar função, variedade e distribuição de fontes proteicas ao longo do dia.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ANY',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'HAS_TRAINING_TIME',
            operator: 'IS',
            value: true,
          }),
          Object.freeze({
            fact: 'DIETARY_PATTERN',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'VEGETARIAN',
              'VEGETARIANO',
              'VEGAN',
              'VEGANO',
            ]),
          }),
        ]),
      }),
      dependencyPackageIds: [P.NUTRITION_EDUCATION_FOUNDATION],
      positiveFactors: [
        factor(
          'PROTEIN_DISTRIBUTION',
          'Distribuir fontes proteicas favorece adequação e recuperação.',
        ),
        factor(
          'PLANT_PROTEIN_VARIETY',
          'Variedade de fontes vegetais amplia possibilidades alimentares.',
        ),
      ],
      educationalMessages: [
        education(
          'PROTEIN_DISTRIBUTION_EDUCATION',
          'Ensinar distribuição e diversidade sem prescrever dose.',
          ['FUNCTION', 'FOOD_SOURCES', 'DISTRIBUTION', 'DIETARY_PATTERN'],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_UNSUPPORTED_PROTEIN_DOSAGE',
          enforcement: 'PROHIBIT',
          description:
            'Não prescrever dose proteica individual sem dados e escopo adequados.',
        }),
      ],
      evidenceReferences: [
        EVIDENCE.SPORTS_NUTRITION,
        EVIDENCE.VEGETARIAN_DIETS,
      ],
    }),
    definePackage({
      id: P.HYDRATION_INSUFFICIENCY,
      domain: D.HYDRATION,
      objective:
        'Priorizar acesso regular a líquidos quando a hidratação declarada é insuficiente.',
      priority: 'HIGH',
      whenToApply: booleanApplicability('HAS_INADEQUATE_HYDRATION'),
      dependencyPackageIds: [P.HYDRATION],
      positiveFactors: [
        factor(
          'REGULAR_ACCESS',
          'Acesso regular e lembretes contextuais apoiam melhora gradual da hidratação.',
        ),
        factor(
          'ROUTINE_ALIGNMENT',
          'A estratégia de hidratação deve caber na rotina registrada.',
        ),
      ],
      educationalMessages: [
        education(
          'INADEQUATE_HYDRATION_EDUCATION',
          'Apoiar hidratação gradual com sinais observáveis da rotina.',
          ['REGULAR_ACCESS', 'ROUTINE_CUES', 'EXERCISE_CONTEXT'],
        ),
      ],
    }),
    definePackage({
      id: P.ELECTROLYTE_CAUTION,
      domain: D.HYDRATION,
      objective:
        'Manter eletrólitos em escopo educacional e contextual, sem protocolo universal.',
      priority: 'STANDARD',
      whenToApply: Object.freeze({
        match: 'ALL',
        conditions: Object.freeze([
          Object.freeze({
            fact: 'SESSION_DURATION_MINUTES',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 60,
          }),
          Object.freeze({
            fact: 'TRAINING_MODALITY',
            operator: 'CONTAINS_ANY',
            values: Object.freeze([
              'ENDURANCE',
              'RUNNING',
              'CORRIDA',
              'CYCLING',
              'CICLISMO',
              'BIKE',
              'HYBRID',
              'HIBRIDO',
            ]),
          }),
        ]),
      }),
      dependencyPackageIds: [P.HYDRATION],
      positiveFactors: [
        factor(
          'EXERCISE_CONTEXT',
          'A relevância de eletrólitos depende do exercício e do contexto individual.',
        ),
      ],
      educationalMessages: [
        education(
          'ELECTROLYTE_EDUCATION',
          'Explicar eletrólitos sem recomendar dose ou reposição automática.',
          [
            'CONTEXT_DEPENDENCE',
            'FOOD_AND_FLUID_SOURCES',
            'NO_UNIVERSAL_DOSAGE',
          ],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'NO_UNSUPPORTED_ELECTROLYTE_PROTOCOL',
          enforcement: 'PROHIBIT',
          description:
            'Não prescrever eletrólitos ou dose de reposição sem avaliação individual.',
        }),
      ],
      evidenceReferences: [EVIDENCE.SPORTS_NUTRITION],
    }),
    definePackage({
      id: P.MULTIPLE_FOOD_CONSTRAINTS,
      domain: D.CLINICAL_RESTRICTIONS,
      objective:
        'Preservar segurança e variedade quando coexistem múltiplas restrições alimentares.',
      priority: 'CRITICAL',
      whenToApply: booleanApplicability('HAS_MULTIPLE_RESTRICTIONS'),
      dependencyPackageIds: [P.FOOD_RESTRICTION_SAFETY, P.FOOD_SUBSTITUTION],
      positiveFactors: [
        factor(
          'SAFE_ALTERNATIVES',
          'Substituições devem preservar todas as restrições confirmadas.',
        ),
        factor(
          'CONFIRMED_CONSTRAINTS',
          'A combinação de restrições deve ser tratada como um conjunto indivisível.',
        ),
      ],
      negativeFactors: [
        factor(
          'UNVERIFIED_REINTRODUCTION',
          'Nenhum alimento restrito deve ser reintroduzido por suposição.',
        ),
      ],
      educationalMessages: [
        education(
          'MULTIPLE_CONSTRAINTS_EDUCATION',
          'Explicar substituições seguras e preservação de variedade.',
          [
            'ALL_CONSTRAINTS',
            'CROSS_CONTACT',
            'SAFE_ALTERNATIVES',
            'PROFESSIONAL_FOLLOW_UP',
          ],
        ),
      ],
    }),
    definePackage({
      id: P.LOW_ADHERENCE_SUPPORT,
      domain: D.BEHAVIOR,
      objective:
        'Reduzir complexidade e priorizar ações pequenas quando a aderência estruturada é baixa.',
      priority: 'HIGH',
      whenToApply: booleanApplicability('HAS_LOW_ADHERENCE'),
      dependencyPackageIds: [P.BEHAVIOR_ADHERENCE],
      positiveFactors: [
        factor(
          'SMALL_REPEATABLE_ACTIONS',
          'Ações pequenas e verificáveis favorecem retomada da consistência.',
        ),
        factor(
          'ROUTINE_ALIGNMENT',
          'A estratégia deve caber na rotina antes de ampliar variedade.',
        ),
      ],
      negativeFactors: [
        factor(
          'COMPLEX_DAILY_RECIPES',
          'Complexidade elevada aumenta fricção em baixa aderência.',
        ),
      ],
      educationalMessages: [
        education(
          'LOW_ADHERENCE_EDUCATION',
          'Focar retomada sem culpa ou rigidez.',
          ['ONE_NEXT_STEP', 'LOW_FRICTION', 'CONSISTENCY', 'FLEXIBILITY'],
        ),
      ],
    }),
    definePackage({
      id: P.HIGH_ADHERENCE_AUTONOMY,
      domain: D.BEHAVIOR,
      objective:
        'Ampliar autonomia e detalhamento quando a aderência estruturada é alta.',
      priority: 'SUPPORTING',
      whenToApply: booleanApplicability('HAS_HIGH_ADHERENCE'),
      dependencyPackageIds: [
        P.BEHAVIOR_ADHERENCE,
        P.NUTRITION_EDUCATION_FOUNDATION,
      ],
      positiveFactors: [
        factor(
          'FLEXIBLE_ADHERENCE',
          'Alta aderência permite ampliar autonomia sem introduzir rigidez.',
        ),
        factor(
          'ROUTINE_STABILITY',
          'Rotina estável permite testar ajustes graduais e observáveis.',
        ),
      ],
      educationalMessages: [
        education(
          'HIGH_ADHERENCE_AUTONOMY_EDUCATION',
          'Aprofundar decisões conscientes e auto-observação.',
          ['AUTONOMY', 'FLEXIBILITY', 'SELF_MONITORING', 'SUSTAINABILITY'],
        ),
      ],
    }),
    definePackage({
      id: P.ADOLESCENT_SAFETY,
      domain: D.SPECIAL_POPULATIONS,
      objective:
        'Manter orientação para adolescentes educacional, suficiente e dependente de acompanhamento responsável.',
      priority: 'CRITICAL',
      whenToApply: booleanApplicability('IS_ADOLESCENT'),
      dependencyPackageIds: [P.SPECIAL_POPULATION_BOUNDARY],
      positiveFactors: [
        factor(
          'CONFIRMED_CONSTRAINTS',
          'Idade e condições declaradas devem limitar a intensidade da intervenção.',
        ),
        factor(
          'ADEQUATE_ENERGY',
          'Crescimento e atividade exigem evitar restrição energética agressiva.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Não aplicar estratégias agressivas durante crescimento e desenvolvimento.',
        ),
        factor(
          'CLINICAL_PROTOCOL',
          'Não criar protocolo individual para adolescente.',
        ),
      ],
      educationalMessages: [
        education(
          'ADOLESCENT_NUTRITION_SAFETY',
          'Priorizar educação, crescimento e acompanhamento apropriado.',
          [
            'GROWTH',
            'ADEQUATE_ENERGY',
            'IRON_AND_CALCIUM_AWARENESS',
            'RESPONSIBLE_FOLLOW_UP',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
    }),
    definePackage({
      id: P.OLDER_ADULT_SAFETY,
      domain: D.SPECIAL_POPULATIONS,
      objective:
        'Manter orientação para pessoa idosa conservadora, prática e coordenada com contexto de saúde.',
      priority: 'CRITICAL',
      whenToApply: booleanApplicability('IS_OLDER_ADULT'),
      dependencyPackageIds: [P.SPECIAL_POPULATION_BOUNDARY],
      positiveFactors: [
        factor(
          'CONFIRMED_CONSTRAINTS',
          'Condições e restrições declaradas prevalecem sobre metas gerais.',
        ),
        factor(
          'PROTEIN_DISTRIBUTION',
          'Fontes proteicas distribuídas podem apoiar preservação funcional em nível educacional.',
        ),
        factor(
          'HYDRATION',
          'Acesso regular a líquidos integra cuidados gerais.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Restrição agressiva pode comprometer segurança e funcionalidade.',
        ),
        factor(
          'CLINICAL_PROTOCOL',
          'Não criar protocolo clínico para pessoa idosa.',
        ),
      ],
      educationalMessages: [
        education(
          'OLDER_ADULT_NUTRITION_SAFETY',
          'Priorizar função, hidratação e adequação sem prescrição clínica.',
          [
            'FUNCTION',
            'PROTEIN_DISTRIBUTION',
            'HYDRATION',
            'CALCIUM_AND_VITAMIN_D_AWARENESS',
            'PROFESSIONAL_FOLLOW_UP',
          ],
        ),
      ],
      evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
    }),
    definePackage({
      id: P.PREGNANCY_SAFETY,
      domain: D.SPECIAL_POPULATIONS,
      objective:
        'Restringir gestação a educação geral e encaminhamento, sem plano ou protocolo individual.',
      priority: 'CRITICAL',
      whenToApply: booleanApplicability('IS_PREGNANT'),
      dependencyPackageIds: [
        P.SPECIAL_POPULATION_BOUNDARY,
        P.CLINICAL_SAFETY_BOUNDARY,
      ],
      positiveFactors: [
        factor(
          'CONFIRMED_CONSTRAINTS',
          'A gestação declarada deve limitar toda intervenção nutricional.',
        ),
      ],
      negativeFactors: [
        factor(
          'AGGRESSIVE_RESTRICTION',
          'Não introduzir restrição agressiva durante gestação.',
        ),
        factor(
          'CLINICAL_PROTOCOL',
          'Não criar protocolo nutricional para gestação.',
        ),
      ],
      educationalMessages: [
        education(
          'PREGNANCY_NUTRITION_SAFETY',
          'Manter apenas educação geral e coordenação profissional.',
          [
            'FOOD_SAFETY',
            'IRON_AND_CALCIUM_AWARENESS',
            'NO_WEIGHT_LOSS_PROTOCOL',
            'PRENATAL_FOLLOW_UP',
          ],
        ),
      ],
      limits: [
        Object.freeze({
          code: 'PREGNANCY_PROFESSIONAL_COORDINATION',
          enforcement: 'REQUIRE',
          description:
            'Orientação deve ser coordenada com pré-natal e profissional habilitado.',
        }),
      ],
      evidenceReferences: [EVIDENCE.WHO_HEALTHY_DIET],
    }),
    defineClinicalSafetyPackage({
      id: P.DIABETES_SAFETY,
      fact: 'HAS_DIABETES_CONTEXT',
      objective:
        'Manter contexto de diabetes em educação geral, preservando tratamento e acompanhamento existentes.',
      educationCode: 'DIABETES_SAFETY',
      keyPoints: [
        'REGULARITY',
        'CARBOHYDRATE_CONTEXT',
        'NO_GLYCEMIC_PROTOCOL',
        'PROFESSIONAL_FOLLOW_UP',
      ],
    }),
    defineClinicalSafetyPackage({
      id: P.HYPERTENSION_SAFETY,
      fact: 'HAS_HYPERTENSION_CONTEXT',
      objective:
        'Manter contexto de hipertensão em educação geral, sem prescrever sódio, eletrólitos ou tratamento.',
      educationCode: 'HYPERTENSION_SAFETY',
      keyPoints: [
        'FOOD_PATTERN',
        'LABEL_AWARENESS',
        'NO_SODIUM_PROTOCOL',
        'PROFESSIONAL_FOLLOW_UP',
      ],
    }),
    defineClinicalSafetyPackage({
      id: P.RENAL_CONDITION_SAFETY,
      fact: 'HAS_RENAL_CONTEXT',
      objective:
        'Impedir protocolos de proteína, potássio, fósforo, líquidos ou eletrólitos em contexto renal.',
      educationCode: 'RENAL_CONDITION_SAFETY',
      keyPoints: [
        'NO_PROTEIN_PROTOCOL',
        'NO_ELECTROLYTE_PROTOCOL',
        'NO_FLUID_PROTOCOL',
        'PROFESSIONAL_FOLLOW_UP',
      ],
    }),
    defineClinicalSafetyPackage({
      id: P.HEPATIC_CONDITION_SAFETY,
      fact: 'HAS_HEPATIC_CONTEXT',
      objective:
        'Manter contexto hepático fora de protocolos nutricionais e terapêuticos automatizados.',
      educationCode: 'HEPATIC_CONDITION_SAFETY',
      keyPoints: [
        'GENERAL_EDUCATION_ONLY',
        'NO_SUPPLEMENT_PROTOCOL',
        'NO_TREATMENT',
        'PROFESSIONAL_FOLLOW_UP',
      ],
    }),
    defineClinicalSafetyPackage({
      id: P.SEVERE_OBESITY_SAFETY,
      fact: 'HAS_SEVERE_OBESITY_CONTEXT',
      objective:
        'Manter obesidade grave declarada em abordagem conservadora, não estigmatizante e multiprofissional.',
      educationCode: 'SEVERE_OBESITY_SAFETY',
      keyPoints: [
        'NO_STIGMA',
        'NO_AGGRESSIVE_RESTRICTION',
        'SUSTAINABLE_ACTIONS',
        'PROFESSIONAL_FOLLOW_UP',
      ],
    }),
  ]);
