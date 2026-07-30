export type NutritionRecognitionKind =
  | 'EFFORT'
  | 'CONSISTENCY'
  | 'IMPROVEMENT'
  | 'SMALL_WIN'
  | 'BIG_WIN'
  | 'RECOVERY'
  | 'DISCIPLINE'
  | 'GOOD_DECISION'
  | 'GOOD_STRATEGY'
  | 'BAD_STRATEGY'
  | 'SETBACK'
  | 'RECURRENCE'
  | 'ADHERENCE'
  | 'MOMENTUM'
  | 'PLATEAU';

export type NutritionRecognitionOrigin =
  | 'BEHAVIOR'
  | 'COACH'
  | 'LONGITUDINAL'
  | 'RECOMMENDATION';

export interface NutritionRecognitionSignal {
  readonly kind: NutritionRecognitionKind;
  readonly origin: NutritionRecognitionOrigin;
  readonly confidence: 'MEDIUM' | 'HIGH';
  readonly evidence: readonly string[];
  readonly goalRelation?: string;
}

export interface NutritionRecognitionContext {
  readonly signals: readonly NutritionRecognitionSignal[];
}
