import { FitnessGoal } from '@prisma/client';
import {
  NUTRITION_KNOWLEDGE_CATALOG_VERSION,
  NUTRITION_KNOWLEDGE_DOMAIN,
  NUTRITION_KNOWLEDGE_PACKAGE_ID,
  NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
  type NutritionEducationalMessage,
  type NutritionKnowledgeApplicability,
  type NutritionKnowledgeEvidenceReference,
  type NutritionKnowledgeFactor,
  type NutritionKnowledgeLimit,
  type NutritionKnowledgePackage,
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
    packageVersion: 1,
    ...seed,
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
          'Ferro, vitamina B12 e outros micronutrientes merecem atenção conforme o padrão.',
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
          ['PROTEIN_SOURCES', 'VARIETY', 'IRON_AWARENESS', 'B12_AWARENESS'],
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
          'Ferro, cálcio, iodo, vitamina D e ômega-3 podem exigir avaliação individual.',
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
  ]);
