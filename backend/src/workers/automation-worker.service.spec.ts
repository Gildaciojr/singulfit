import { AutomationWorkerService } from './automation-worker.service';

describe('AutomationWorkerService', () => {
  class TestAutomationWorkerService extends AutomationWorkerService {
    maintenance(at: Date): Promise<void> {
      return this.runMaintenance(at);
    }
  }

  it('keeps maintenance order and only delegates proactive materialization', async () => {
    const calls: string[] = [];
    const worker = new TestAutomationWorkerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        processDue: jest.fn().mockImplementation(() => {
          calls.push('activation');
          return Promise.resolve(0);
        }),
      } as never,
      {
        processDue: jest.fn().mockImplementation(() => {
          calls.push('subscription');
          return Promise.resolve({ scanned: 0, processed: 0 });
        }),
      } as never,
      {
        materializeDueMessages: jest.fn().mockImplementation(() => {
          calls.push('proactive');
          return Promise.resolve({ scanned: 0, materialized: 0 });
        }),
      } as never,
    );

    await worker.maintenance(new Date('2026-08-18T12:00:00.000Z'));

    expect(calls).toEqual(['activation', 'subscription', 'proactive']);
    expect(JSON.stringify(worker)).not.toMatch(/Evolution/u);
  });
});
