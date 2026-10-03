import type { GeneratedWorkoutPlanV2Candidate } from './workout-plan-v2.contract';

/** Derive the total clock only from fully determined interval prescriptions. */
export function canonicalizeWorkoutTimedDurations(
  candidate: GeneratedWorkoutPlanV2Candidate,
): GeneratedWorkoutPlanV2Candidate {
  const sessions = candidate.sessions.map((session) => {
    const blocks = session.blocks.map((block) => {
      const activities = block.activities.map((activity) => {
        if (
          activity.kind !== 'TIMED' ||
          activity.workSeconds === null ||
          (activity.rounds > 1 && activity.recoverySeconds === null)
        )
          return activity;
        const durationSeconds =
          activity.workSeconds * activity.rounds +
          (activity.recoverySeconds ?? 0) * Math.max(0, activity.rounds - 1);
        if (
          !Number.isInteger(durationSeconds) ||
          durationSeconds < 1 ||
          durationSeconds > 7200 ||
          durationSeconds === activity.durationSeconds
        )
          return activity;
        return Object.freeze({ ...activity, durationSeconds });
      });
      return activities.some(
        (activity, index) => activity !== block.activities[index],
      )
        ? Object.freeze({ ...block, activities: Object.freeze(activities) })
        : block;
    });
    return blocks.some((block, index) => block !== session.blocks[index])
      ? Object.freeze({ ...session, blocks: Object.freeze(blocks) })
      : session;
  });
  return sessions.some(
    (session, index) => session !== candidate.sessions[index],
  )
    ? Object.freeze({ ...candidate, sessions: Object.freeze(sessions) })
    : candidate;
}
