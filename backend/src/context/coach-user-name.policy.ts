import type { CoachProfileIdentity } from './coach-profile-snapshot.contract';

/** Only a canonical User identity can supply a conversational name. */
export function coachUserFirstName(
  identity: CoachProfileIdentity,
  expectedUserId?: string,
): string | null {
  const user = identity.userId;
  const name = identity.displayName;
  if (
    !expectedUserId?.trim() ||
    !user ||
    !name ||
    user.status !== 'KNOWN' ||
    !user.sources.includes('USER') ||
    !user.value.trim() ||
    user.value !== expectedUserId ||
    name.status !== 'KNOWN' ||
    !name.sources.includes('USER')
  )
    return null;
  return name.value.trim().split(/\s+/u)[0] || null;
}
