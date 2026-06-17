export const AUTOMATION_RULE_CODES = {
  GOOD_MORNING: 'GOOD_MORNING',
  DAILY_WORKOUT: 'DAILY_WORKOUT',
  MEAL_REMINDER: 'MEAL_REMINDER',
  HYDRATION_REMINDER: 'HYDRATION_REMINDER',
  DAILY_CHECK_IN: 'DAILY_CHECK_IN',
  WEEKLY_SUMMARY: 'WEEKLY_SUMMARY',
  DAILY_COACH: 'DAILY_COACH',
  WEEKLY_REVIEW: 'WEEKLY_REVIEW',
  MONTHLY_REVIEW: 'MONTHLY_REVIEW',
  REENGAGEMENT: 'REENGAGEMENT',
} as const;

export type AutomationRuleCode =
  (typeof AUTOMATION_RULE_CODES)[keyof typeof AUTOMATION_RULE_CODES];

export const INITIAL_AUTOMATION_RULES: ReadonlyArray<{
  code: AutomationRuleCode;
  name: string;
}> = [
  {
    code: AUTOMATION_RULE_CODES.GOOD_MORNING,
    name: 'Bom dia',
  },
  {
    code: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
    name: 'Treino do dia',
  },
  {
    code: AUTOMATION_RULE_CODES.MEAL_REMINDER,
    name: 'Lembrete de refeição',
  },
  {
    code: AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
    name: 'Lembrete de água',
  },
  {
    code: AUTOMATION_RULE_CODES.DAILY_CHECK_IN,
    name: 'Check-in diário',
  },
  {
    code: AUTOMATION_RULE_CODES.WEEKLY_SUMMARY,
    name: 'Resumo semanal',
  },
  {
    code: AUTOMATION_RULE_CODES.DAILY_COACH,
    name: 'Coach diário',
  },
  {
    code: AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
    name: 'Revisão semanal',
  },
  {
    code: AUTOMATION_RULE_CODES.MONTHLY_REVIEW,
    name: 'Revisão mensal',
  },
  {
    code: AUTOMATION_RULE_CODES.REENGAGEMENT,
    name: 'Reengajamento',
  },
];
