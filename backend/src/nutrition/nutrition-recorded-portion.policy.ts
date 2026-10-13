export interface RecordedFoodReference {
  readonly foodName: string;
  readonly quantity: string;
  readonly calories: number | null;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
}
const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ');
function quantity(value: string) {
  const parsed = /^(\d+(?:[.,]\d+)?)\s*([\p{L} ]+)$/u.exec(fold(value));
  if (!parsed) return null;
  const amount = Number(parsed[1].replace(',', '.'));
  return Number.isFinite(amount) && amount > 0
    ? { amount, unit: parsed[2].trim() }
    : null;
}
/** Scale only a recorded numeric reference with exactly the same food and unit. */
export function recordedPortion(
  foods: readonly RecordedFoodReference[],
  item: { foodQuote: string; quantityQuote: string },
) {
  const candidates = foods.filter(
    (food) => fold(food.foodName) === fold(item.foodQuote),
  );
  if (candidates.length !== 1) return null;
  const reference = candidates[0];
  const source = quantity(reference.quantity);
  const reported = quantity(item.quantityQuote);
  if (!source || !reported || source.unit !== reported.unit) return null;
  const ratio = reported.amount / source.amount;
  const metric = (value: number | null) =>
    value !== null && Number.isFinite(value) && value >= 0
      ? value * ratio
      : null;
  return {
    food: reference.foodName,
    reportedQuantity: item.quantityQuote,
    referenceQuantity: reference.quantity,
    calories: metric(reference.calories),
    protein: metric(reference.protein),
    carbs: metric(reference.carbs),
    fat: metric(reference.fat),
  };
}
