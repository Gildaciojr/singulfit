import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { workoutWeeklyRecoveryIssues } from './workout-plan-v2-quality.policy';
import { projectWorkoutActivity } from './workout-public-projection';
import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';
import {
  qualityCandidate,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';
import { chunkWorkoutWhatsApp } from './workout-whatsapp.chunker';
import type { WorkoutBlockWork } from './workout-plan-v2.contract';

describe('Production GYM commercial presentation hotfix', () => {
  const formatter = new WorkoutPlanV2Formatter();
  it('renders human names from execution facts, ignoring arbitrary provider names', () => {
    const plan = commercialWorkoutPlan();
    const lifts = plan.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.activities),
    );
    const bench = lifts.find(
      (activity) => activity.name === 'Supino inclinado com halteres',
    );
    const overhead = lifts.find(
      (activity) => activity.name === 'Desenvolvimento sentado com halteres',
    );
    const row = lifts.find(
      (activity) => activity.name === 'Remada baixa na polia',
    );
    if (!bench || !overhead || !row)
      throw new Error('Missing provider fixtures');
    expect(
      projectWorkoutActivity({ ...bench, name: 'XTrainerPro 20 kg' })
        .displayName,
    ).toMatch(/supino inclinado.*halteres/iu);
    expect(projectWorkoutActivity(overhead).displayName).toMatch(
      /desenvolvimento.*sentado/iu,
    );
    expect(projectWorkoutActivity(row).displayName).toBe(row.name);
    expect(
      projectWorkoutActivity({ ...row, name: 'XTrainerPro 20 kg' }).displayName,
    ).toMatch(/remada.*cabo/iu);
    expect(projectWorkoutActivity(bench).displayName).not.toBe(
      projectWorkoutActivity(overhead).displayName,
    );
    expect(formatter.format(plan).join('\n')).not.toMatch(
      /plano sagital|plano transversal|Empurrada horizontal para|Puxada horizontal para/u,
    );
  });
  it.each([
    'Mantenha escápulas estáveis',
    'Mantenha as escápulas apoiadas e controle a descida',
    'Mantenha os punhos alinhados',
    'Conduza os cotovelos para trás sem balançar o tronco',
    'Evite arquear a lombar',
    'Use RPE 7–8',
    'Mantenha 2–3 repetições em reserva',
  ])(
    'retains safe personalized cue without repeating a generic fallback: %s',
    (instruction) => {
      const output = formatter.formatActivity({ ...strength(), instruction });
      expect(output).toContain(instruction);
      expect(output).not.toContain(
        'Mantenha o movimento confortável e pare se sentir dor',
      );
      const mixed = formatter.formatActivity({
        ...strength(),
        instruction: `${instruction} e use SkiErg em 250 W`,
      });
      for (const clause of instruction.split(' e '))
        expect(mixed).toContain(clause);
      expect(mixed).not.toMatch(/SkiErg|250 W/u);
    },
  );
  it('omits unclassified instructions instead of adding identical invented cues to every exercise', () => {
    const output = formatter.formatSession(
      qualitySession('s', [
        { ...strength('a'), instruction: 'Use XTrainerPro' },
        { ...strength('b'), instruction: 'Use HyperCable9000' },
      ]),
    );
    expect(output).not.toMatch(
      /XTrainerPro|HyperCable9000|Mantenha o movimento confortável e pare se sentir dor/u,
    );
  });
  it('repairs missing executable repetitions in V10 but keeps legacy output truthful', () => {
    const context = qualityContext(['MONDAY']);
    const strategy = new WorkoutPlanningStrategyService().build(context);
    const activity = { ...strength(), repetitions: 'não confirmadas' };
    const candidate = qualityCandidate([
      { ...qualitySession('s', [activity]), weekday: 'MONDAY' },
    ]);
    const validator = new WorkoutPlanV2Validator();
    expect(
      validator.validate(candidate, context, strategy, true).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'PUBLIC_REPETITIONS_REQUIRED',
        severity: 'ERROR',
      }),
    );
    expect(
      validator.validate(candidate, context, strategy, false, false).issues,
    ).not.toContainEqual(
      expect.objectContaining({ code: 'PUBLIC_REPETITIONS_REQUIRED' }),
    );
    expect(formatter.formatActivity(activity)).toContain('4 séries');
    expect(formatter.formatActivity(activity)).not.toMatch(
      /repetições não confirmadas|×\s*\n/u,
    );
    expect(
      formatter.formatActivity({
        ...strength(),
        repetitions: '8–12 (cada perna)',
      }),
    ).toContain('8–12 repetições por perna');
  });
  it.each([
    ['CONTINUOUS', 1, 'Circuito contínuo'],
    ['CONTINUOUS', 2, '2 rodadas'],
    ['ROUNDS', 1, '1 rodada'],
    ['ROUNDS', 2, '2 rodadas'],
    ['FOR_TIME', null, 'Por tempo'],
    ['INTERVAL', 2, 'Intervalado'],
    ['AMRAP', null, 'AMRAP'],
    ['EMOM', 2, 'EMOM'],
  ] satisfies readonly (readonly [
    WorkoutBlockWork['format'],
    number | null,
    string,
  ])[])('humanizes %s and round grammar', (format, rounds, expected) => {
    const session = qualitySession();
    const work: WorkoutBlockWork = {
      format,
      rounds,
      durationSeconds: 600,
      intervalSeconds: null,
      movementActivityKeys: [session.blocks[0].activities[0].activityKey],
    };
    const output = formatter.formatSession({
      ...session,
      blocks: [{ ...session.blocks[0], work }],
    });
    if (format === 'CONTINUOUS' && rounds === 1) {
      expect(output).not.toContain('Circuito contínuo');
      expect(output).toContain('Caminhada');
      expect(output).toContain('Tempo: 10 min');
    } else expect(output).toContain(expected);
    expect(output).not.toMatch(/CONTINUOUS|FOR_TIME|INTERVAL|1 rodadas/u);
    if (format === 'CONTINUOUS' && rounds === 1)
      expect(output).not.toContain('rodada');
  });
  it('counts actual messages for a four-session plan even when chunk count differs', () => {
    const source = commercialWorkoutPlan();
    const plan = { ...source, sessions: source.sessions.slice(0, 4) };
    const original = formatter.format(plan).join('\n\n');
    const chunks = chunkWorkoutWhatsApp(original, 1100);
    expect(plan.sessions).toHaveLength(4);
    expect(chunks.length).toBeGreaterThan(4);
    chunks
      .slice(1)
      .forEach((chunk, index) =>
        expect(chunk).toContain(`mensagem ${index + 2} de ${chunks.length}`),
      );
    expect(
      chunks
        .map((chunk) =>
          chunk.replace(
            /^➡️ \*Continuação do seu treino — mensagem \d+ de \d+\*\n\n/u,
            '',
          ),
        )
        .join('\n\n'),
    ).toBe(original);
    expect(chunks.every((chunk) => chunk.length <= 1100)).toBe(true);
  });
  it('warns about four consecutive strength days with wider availability without programming or rejecting the week', () => {
    const context = qualityContext();
    const consecutive = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'] as const;
    const sessions = consecutive.map((weekday, index) => ({
      ...qualitySession(`s${index}`),
      sequence: index + 1,
      weekday,
    }));
    const candidate = qualityCandidate(sessions);
    expect(workoutWeeklyRecoveryIssues(candidate, context)).toContainEqual({
      code: 'CONSECUTIVE_STRENGTH_DAYS',
      severity: 'WARNING',
      path: 'sessions',
    });
    expect(candidate.sessions.map((session) => session.weekday)).toEqual(
      consecutive,
    );
    const spaced = {
      ...candidate,
      sessions: sessions.map((session, index) => ({
        ...session,
        weekday: (['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY'] as const)[index],
      })),
    };
    expect(workoutWeeklyRecoveryIssues(spaced, context)).not.toContainEqual(
      expect.objectContaining({ code: 'CONSECUTIVE_STRENGTH_DAYS' }),
    );
    const validation = new WorkoutPlanV2Validator().validate(
      candidate,
      {
        ...context,
        training: {
          ...context.training,
          weeklyFrequency: { status: 'CONFIRMED', value: 4 },
        },
      },
      {
        ...new WorkoutPlanningStrategyService().build(context),
        sessionCount: 4,
      },
      true,
    );
    expect(validation.status).not.toBe('INVALID');
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'quatro dias consecutivos de força exigem justificativa técnica forte',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'volume semanal coerente',
    );
  });
});
