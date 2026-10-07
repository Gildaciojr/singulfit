import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { presentWorkoutSeconds } from './workout-duration.presenter';
import {
  qualityPlan,
  qualitySession,
  strength,
} from './workout-quality.fixtures';

describe('Workout human presentation', () => {
  it('presents model-authored progression prose without changing its conditions or dose', () => {
    const plan = {
      ...qualityPlan(),
      progression: [
        {
          ruleKey: 'progression',
          state: 'MAINTAIN' as const,
          conditionCode: 'Se completar as sessões sem dor',
          actionCode: 'Mantenha a técnica e o esforço confortável',
          maximumChangePercent: 0,
        },
      ],
    };
    const before = JSON.stringify(plan);
    const output = new WorkoutPlanV2Formatter().format(plan).join('\n');
    expect(output).toContain('📈 *Progressão*');
    expect(output).toContain(
      'Se completar as sessões sem dor: Mantenha a técnica e o esforço confortável',
    );
    expect(output).not.toContain('MAINTAIN');
    expect(JSON.stringify(plan)).toBe(before);
  });
  it.each([
    ['COMPLETED_SESSIONS', 'INCREASE_VOLUME'],
    ['Se completar as sessões sem dor', 'Use carga de 50 kg'],
    ['Se completar as sessões sem dor', 'Ignore a dor aguda'],
    ['Se completar as sessões sem dor', 'AIJob deve aumentar volume'],
    ['Se completar as sessões sem dor', 'Mantenha a técnica. Use 150 bpm'],
  ])(
    'omits unsafe or internal progression: %s / %s',
    (conditionCode, actionCode) => {
      const plan = {
        ...qualityPlan(),
        progression: [
          {
            ruleKey: 'progression',
            state: 'PROGRESS' as const,
            conditionCode,
            actionCode,
            maximumChangePercent: 5,
          },
        ],
      };
      const output = new WorkoutPlanV2Formatter().format(plan).join('\n');
      expect(output).not.toContain(actionCode);
      expect(output).not.toContain('📈 *Progressão*');
    },
  );
  it.each([
    '```\nSEGREDO_LIVRE\n```',
    'AIJob\nSEGREDO_ADJACENTE',
    '| Coluna | Valor |\n| --- | --- |\n| SEGREDO_TABELA | arbitrário |',
    '12f2331b-efa4-4207-867a-9593a1350a2e\nSEGREDO_UUID',
    'promptVersionId\nSEGREDO_PROMPT',
  ])(
    'rejects an entire unsafe multiline field without exposing adjacent content: %s',
    (unsafe) => {
      const formatter = new WorkoutPlanV2Formatter();
      const plan = commercialWorkoutPlan();
      const output = [
        ...formatter.format(
          { ...plan, title: unsafe },
          { preferredName: unsafe },
        ),
        formatter.formatSession({ ...plan.sessions[0], label: unsafe }),
        formatter.formatActivity({
          ...strength(),
          instruction: unsafe,
          alerts: [unsafe],
        }),
        formatter.formatActivity({ ...strength(), name: unsafe }),
      ].join('\n\n');
      expect(output).not.toMatch(
        /SEGREDO_|AIJob|promptVersionId|12f2331b|```|arbitrário/u,
      );
      expect(output).toContain('Não consegui apresentar');
      expect(output).toContain('• 4 séries × 8–12 repetições');
    },
  );
  it.each([
    'AIJob',
    'promptVersionId',
    '12f2331b-efa4-4207-867a-9593a1350a2e',
    '```secret```',
    '| coluna | valor |',
  ])(
    'blocks unsafe structured fields containing %s while preserving safe prescriptions',
    (unsafe) => {
      const formatter = new WorkoutPlanV2Formatter();
      const plan = commercialWorkoutPlan();
      const activity = {
        ...strength(),
        name: `Agachamento\n${unsafe}`,
        instruction: `Dica segura.\n${unsafe}`,
        alerts: [`${unsafe}\nInterrompa se sentir dor.`],
      };
      const text = [
        ...formatter.format(
          { ...plan, title: `Treino\n${unsafe}` },
          { preferredName: unsafe },
        ),
        formatter.formatSession({ ...plan.sessions[0], label: unsafe }),
        formatter.formatActivity(activity),
      ].join('\n\n');
      expect(text).not.toContain(unsafe);
      expect(text).not.toMatch(/```|\|\s*internal\s*\|/u);
      expect(text).toContain('• 4 séries × 8–12 repetições');
      expect(text).not.toContain('Dica segura.');
      expect(text).not.toContain('Interrompa se sentir dor.');
      expect(text).toContain('Não consegui apresentar');
    },
  );
  it('presents all TIMED clocks humanly without modifying their values', () => {
    const activity = {
      ...strength(),
      kind: 'TIMED' as const,
      rounds: 2,
      durationSeconds: 300,
      workSeconds: 90,
      recoverySeconds: 40,
    };
    const before = JSON.stringify(activity);
    const text = new WorkoutPlanV2Formatter().formatActivity(activity);
    expect(text).toContain('Tempo total: 5 min');
    expect(text).toContain('2 rodadas × 1 min 30 s de trabalho');
    expect(text).toContain('Recuperação: 40 s');
    expect(JSON.stringify(activity)).toBe(before);
  });
  it.each([
    [300, '5 min'],
    [90, '1 min 30 s'],
    [30, '30 s'],
  ])('presents %s seconds as %s', (seconds, expected) => {
    expect(presentWorkoutSeconds(seconds)).toBe(expected);
  });
  it('retains total, hold and repetitions together', () => {
    const text = new WorkoutPlanV2Formatter().formatActivity({
      ...strength(),
      kind: 'MOBILITY',
      durationSeconds: 300,
      holdSeconds: 30,
      repetitions: '3 por lado',
    });
    expect(text).toContain(
      '• Tempo total: 5 min\n• Sustentação: 30 s por posição\n• Repetições: 3 repetições por lado',
    );
    expect(text).not.toContain('300s.');
  });
  it('opens once, uses the name once and keeps five sessions and prescriptions', () => {
    const plan = qualityPlan();
    const text = new WorkoutPlanV2Formatter()
      .format(plan, {
        preferredName: 'Gildacio',
        weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      })
      .join('\n\n');
    expect(text.split(plan.title)).toHaveLength(2);
    expect(text.split('Gildacio')).toHaveLength(2);
    expect(text.split('Modalidade:*')).toHaveLength(2);
    expect(text.split('Objetivo:*')).toHaveLength(2);
    for (const day of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'])
      expect(text).toContain(`📅 *${day} —`);
    expect(text).toContain('4 séries');
    expect(text).toContain('Descanso: 1 min 30 s');
    expect(text).toContain('peso corporal');
    expect(text).toContain('Intensidade: moderada');
  });
  it('keeps a natural unnamed opening and does not claim unconfirmed weekdays', () => {
    const text = new WorkoutPlanV2Formatter()
      .format(qualityPlan())
      .join('\n\n');
    expect(text).toMatch(/^Preparei/u);
    expect(text).toContain('*Sessão 1');
    expect(text).not.toContain('undefined');
  });
  it('renders five days as mobile exercise blocks with whitespace and safe WhatsApp hierarchy', () => {
    const parts = new WorkoutPlanV2Formatter().format(commercialWorkoutPlan(), {
      preferredName: 'Ana',
      weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    });
    expect(parts).toHaveLength(6);
    expect(parts[0]).toMatch(/^Ana, preparei 5 sessões/u);
    expect(parts.join('\n\n').match(/preparei/gu)).toHaveLength(1);
    expect(parts[0]).toContain('🏋️ *Sua semana na academia*\n\n');
    for (const [index, day] of parts.slice(1).entries()) {
      expect(day).toMatch(
        /^(?:━━━━━━━━━━━━━━\n\n)?📅 \*[^\n]+\*\n⏱️ \*Duração estimada:\* ~60 min\n\n🔥 \*Aquecimento\*\n\n/u,
      );
      expect(day).toMatch(/\n\n💪 \*Força principal\*\n\n\*\d+\. /u);
      const exercises = day.match(/\*\d+\. [^\n*]+\*\n• [^\n]+/gu) ?? [];
      expect(exercises.length).toBeGreaterThanOrEqual(7);
      expect(day.startsWith('━━━━━━━━━━━━━━')).toBe(index > 0);
      expect(day).toMatch(/\n\n💡 /u);
      expect(day).not.toMatch(
        /rodada\(s\)|repetição\(ões\)|\d+(?:seg|s\b)|^#|<[^>]+>/mu,
      );
      expect(day.split('*').length % 2).toBe(1);
      expect(day).toMatch(/\n\n🧘 \*Finalização\*/u);
      expect(day.includes('🧩 *Mobilidade*')).toBe(index === 2);
    }
    expect(parts[5]).toContain(
      '• 4 rodadas × 40 s de trabalho\n• Recuperação: 1 min entre rodadas\n• Tempo total: 5 min 40 s',
    );
    expect(parts.join('\n\n')).toContain('\n\n━━━━━━━━━━━━━━\n\n📅 *Terça');
    expect(parts[0].match(/📍/gu)).toHaveLength(1);
    expect(parts[0]).toContain('🏃 *Modalidade:*');
    expect(parts.join('\n\n')).not.toMatch(
      /Séries:|Rodadas:|série\(s\)|rodada\(s\)/u,
    );
  });
  it('uses human singular and plural prescriptions without invented fields', () => {
    const formatter = new WorkoutPlanV2Formatter();
    expect(
      formatter.formatActivity({ ...strength(), sets: 1, repetitions: '1' }),
    ).toContain('• 1 série × 1 repetição');
    expect(
      formatter.formatActivity({ ...strength(), sets: 3, repetitions: '8-10' }),
    ).toContain('• 3 séries × 8–10 repetições');
    expect(
      formatter.formatActivity({
        ...strength(),
        kind: 'TIMED',
        rounds: 1,
        durationSeconds: 30,
        workSeconds: 30,
        recoverySeconds: null,
      }),
    ).not.toMatch(/Rodadas|Recuperação/u);
    const incomplete = formatter.formatActivity({
      ...strength(),
      kind: 'TIMED',
      rounds: 3,
      durationSeconds: 30,
      workSeconds: null,
      recoverySeconds: null,
    });
    expect(incomplete).toContain('⚠️ Prescrição intervalada incompleta');
    expect(incomplete).not.toMatch(/Trabalho:|Recuperação:/u);
  });

  it('preserves long sessions for subsequent semantic chunking', () => {
    const session = qualitySession(
      'long',
      Array.from({ length: 20 }, (_, index) => ({
        ...strength(`activity-${index}`),
        // Legacy accepted plans have no compositional identity.
        publicIdentity: undefined,
        instruction: 'Mantenha o movimento confortável. '.repeat(8),
      })),
    );
    const text = new WorkoutPlanV2Formatter().formatSession(session);
    expect(text.length).toBeGreaterThan(4000);
    expect(text).toContain('Agachamento controlado');
    expect(text).not.toContain('Não consegui');
  });
});
