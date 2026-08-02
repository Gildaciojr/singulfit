import type { ProfileAcquisitionField } from '../../context/coach-adaptive-profile-collector.contract';
import type { NutritionArtifactType } from '../../diet/v2/nutrition-planning-artifact.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
} from '../../workout/v2/workout-planning-artifact.contract';

export type ConversationEntity =
  | Readonly<{
      kind: 'PLAN_COMPONENT';
      domain: 'NUTRITION' | 'WORKOUT';
      component: 'DAY' | 'MEAL' | 'FOOD' | 'SESSION' | 'EXERCISE' | 'SCHEDULE';
    }>
  | Readonly<{ kind: 'NUTRITION_ARTIFACT'; value: NutritionArtifactType }>
  | Readonly<{ kind: 'WORKOUT_ARTIFACT'; value: WorkoutArtifactType }>
  | Readonly<{ kind: 'MEAL'; name: string | null; time: string | null }>
  | Readonly<{ kind: 'FOOD'; name: string }>
  | Readonly<{ kind: 'EXERCISE'; name: string }>
  | Readonly<{ kind: 'WORKOUT_MODALITY'; value: WorkoutModality }>
  | Readonly<{
      kind: 'GOAL';
      value:
        | 'WEIGHT_LOSS'
        | 'MUSCLE_GAIN'
        | 'MAINTENANCE'
        | 'PERFORMANCE'
        | 'HEALTH'
        | 'OTHER';
    }>
  | Readonly<{
      kind: 'BODY_METRIC';
      metric: 'WEIGHT' | 'BODY_FAT' | 'MUSCLE_MASS' | 'MEASUREMENT';
      value: number | null;
      unit: 'KG' | 'PERCENT' | 'CM' | null;
    }>
  | Readonly<{
      kind: 'BUDGET';
      level: 'LOW' | 'MODERATE' | 'FLEXIBLE' | 'UNKNOWN';
    }>
  | Readonly<{
      kind: 'AVAILABILITY';
      area: 'COOKING' | 'TRAINING' | 'SCHEDULE';
      level: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
    }>
  | Readonly<{ kind: 'EQUIPMENT'; name: string }>
  | Readonly<{
      kind: 'RESTRICTION';
      restriction:
        | 'ALLERGY'
        | 'INTOLERANCE'
        | 'PREFERENCE'
        | 'REJECTION'
        | 'MEDICAL';
      value: string;
    }>
  | Readonly<{
      kind: 'SAFETY_REPORT';
      signal:
        | 'PAIN'
        | 'INJURY'
        | 'FEVER'
        | 'MALAISE'
        | 'INCAPACITY'
        | 'MEDICAL_CONDITION'
        | 'EXTREME_REQUEST'
        | 'REHABILITATION_REQUEST';
      bodyArea: string | null;
      severity: 'UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH';
    }>
  | Readonly<{ kind: 'TRAVEL'; active: boolean }>
  | Readonly<{
      kind: 'FEEDBACK';
      sentiment: 'POSITIVE' | 'NEGATIVE' | 'MIXED';
      target: 'PLAN' | 'MEAL' | 'FOOD' | 'WORKOUT' | 'EXERCISE';
    }>
  | Readonly<{
      kind: 'CONFIRMATION';
      value: 'YES' | 'NO' | 'CORRECTION' | 'UNKNOWN';
    }>
  | Readonly<{
      kind: 'TEMPORAL_REFERENCE';
      value:
        | 'TODAY'
        | 'TOMORROW'
        | 'YESTERDAY'
        | 'THIS_WEEK'
        | 'NEXT_WEEK'
        | 'PREVIOUS'
        | 'CURRENT'
        | 'UNSPECIFIED';
    }>
  | Readonly<{ kind: 'PROFILE_FIELD'; field: ProfileAcquisitionField }>;

export type ConversationReference =
  | Readonly<{
      kind: 'PLAN';
      domain: 'NUTRITION' | 'WORKOUT' | 'BOTH';
      target: 'CURRENT' | 'PREVIOUS' | 'NEW' | 'ORDINAL';
      ordinal: number | null;
      resolution: 'RESOLVED' | 'UNRESOLVED';
      source: 'CURRENT_TURN' | 'RECENT_HISTORY' | 'PROFILE_CONTEXT';
    }>
  | Readonly<{
      kind: 'HISTORY_TURN';
      logicalTurn: number;
      resolution: 'RESOLVED' | 'UNRESOLVED';
      source: 'CURRENT_TURN' | 'RECENT_HISTORY';
    }>
  | Readonly<{
      kind: 'PROFILE_FIELD';
      field: ProfileAcquisitionField;
      resolution: 'RESOLVED' | 'UNRESOLVED';
      source: 'PROFILE_CONTEXT';
    }>;
