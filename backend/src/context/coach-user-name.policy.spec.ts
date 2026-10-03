import { coachUserFirstName } from './coach-user-name.policy';
import { CoachConversationHumanContextBuilder } from './coach-conversation-human-context.builder';
import {
  knownDatum,
  routingSnapshot,
  unknownDatum,
} from '../conversation/tests/conversation-routing.fixtures';

describe('canonical coach user name', () => {
  it('requires an explicit nonempty expected owner, including human context', () => {
    const snapshot = routingSnapshot();
    for (const expected of [undefined, '', '   ', 'foreign'])
      expect(coachUserFirstName(snapshot.identity, expected)).toBeNull();
    expect(
      new CoachConversationHumanContextBuilder().build(snapshot).preferredName,
    ).toBeNull();
  });
  it.each(['  Gildacio   Junior ', 'Gildacio Junior'])(
    'preserves the registered first name: %s',
    (name) => {
      const identity = {
        ...routingSnapshot().identity,
        displayName: knownDatum(name),
      };
      expect(coachUserFirstName(identity, 'user-id')).toBe('Gildacio');
      expect(coachUserFirstName(identity, 'foreign-user')).toBeNull();
    },
  );
  it('does not infer a name from unknown, empty or non-User data', () => {
    const identity = routingSnapshot().identity;
    for (const displayName of [
      unknownDatum<string>(),
      knownDatum('  '),
      { status: 'INFERRED' as const, value: 'Ana', sources: ['USER'] as const },
      {
        status: 'KNOWN' as const,
        value: 'Ana',
        sources: ['CONVERSATION_MEMORY'] as const,
      },
    ])
      expect(
        coachUserFirstName({ ...identity, displayName }, 'user-id'),
      ).toBeNull();
  });
  it('uses canonical name even when conversation memory contains another name', () => {
    const snapshot = routingSnapshot();
    const human = new CoachConversationHumanContextBuilder().build(
      {
        ...snapshot,
        identity: {
          ...snapshot.identity,
          displayName: knownDatum(' Gildacio Junior '),
        },
      },
      {
        expectedUserId: 'user-id',
        recentHistory: [
          { direction: 'INBOUND', text: 'Meu amigo se chama Carlos' },
        ],
      },
    );
    expect(human.preferredName?.value).toBe('Gildacio');
  });
});
