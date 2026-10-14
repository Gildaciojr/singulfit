import { CoachCommandService } from './coach-command.service';

describe('Generic short replies cannot report a refused turn as handled', () => {
  it.each([false, true])(
    'preserves the real handled result: %s',
    async (handled) => {
      const prisma = {
        message: {
          findFirst: jest.fn().mockResolvedValue({
            content: 'sim',
            replyToExternalMessageId: null,
          }),
        },
      };
      const args = [
        prisma,
        {},
        {},
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {},
      ] as const;
      const service = new CoachCommandService(
        ...(args as unknown as ConstructorParameters<
          typeof CoachCommandService
        >),
      );
      jest
        .spyOn(service, 'processTextMessage')
        .mockResolvedValue({ handled, duplicated: false, intent: 'UNKNOWN' });
      expect(
        await service.processUncorrelatedShortReply({
          userId: 'fixture',
          messageId: 'fixture',
        }),
      ).toBe(handled);
    },
  );
});
