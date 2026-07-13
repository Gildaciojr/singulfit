export type AuthorizedFactId = string;

export type AuthorizedFactScalar = string | number | boolean | null;

export type AuthorizedFactValue =
  | AuthorizedFactScalar
  | readonly AuthorizedFactValue[]
  | { readonly [key: string]: AuthorizedFactValue };

export type AuthorizedFactSource =
  | 'MEAL_ANALYSIS'
  | 'USER_CONTEXT'
  | 'RECOMMENDATION'
  | 'COACH'
  | 'BEHAVIOR'
  | 'LONGITUDINAL'
  | 'MEMORY';

export interface AuthorizedFact {
  readonly id: AuthorizedFactId;
  readonly source: AuthorizedFactSource;
  readonly value: AuthorizedFactValue;
  readonly confidence?: number;
  readonly estimated: boolean;
  readonly sensitive: boolean;
}

export interface AuthorizedFacts {
  readonly allowed: readonly AuthorizedFact[];
  readonly restricted: readonly AuthorizedFactId[];
  readonly sensitive: readonly AuthorizedFact[];
  readonly disclaimerRequired: readonly AuthorizedFactId[];
}
