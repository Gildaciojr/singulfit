export type NutritionEmotionalSignalKind =
  | 'FRUSTRATION'
  | 'CONFIDENCE'
  | 'OVERWHELM'
  | 'UNCERTAINTY'
  | 'MOTIVATION'
  | 'SATISFACTION'
  | 'REENGAGEMENT'
  | 'FATIGUE'
  | 'RESISTANCE'
  | 'CURIOSITY';

export type NutritionEmotionalSignalOrigin =
  | 'MEAL_ANALYSIS'
  | 'BEHAVIOR'
  | 'COACH'
  | 'LONGITUDINAL'
  | 'MEMORY'
  | 'RECOMMENDATION';

export interface NutritionEmotionalSignal {
  readonly kind: NutritionEmotionalSignalKind;
  readonly origin: NutritionEmotionalSignalOrigin;
  readonly confidence: 'MEDIUM' | 'HIGH';
  readonly evidence: readonly string[];
}

export interface NutritionEmotionalContext {
  readonly signals: readonly NutritionEmotionalSignal[];
}
