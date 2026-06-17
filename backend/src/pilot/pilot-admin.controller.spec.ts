import 'reflect-metadata';
import {
  PilotCohortStatus,
  PilotManualCheckStatus,
  PilotManualCheckType,
  UserRole,
} from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ListPilotCohortsDto } from './dto/list-pilot-cohorts.dto';
import { PilotAdminController } from './pilot-admin.controller';
import { PilotMetricsService } from './pilot-metrics.service';
import { PilotReportService } from './pilot-report.service';
import { PilotService } from './pilot.service';

describe('PilotAdminController', () => {
  it('delegates all pilot administration APIs', async () => {
    const pilot = {
      list: jest.fn(),
      create: jest.fn(),
      get: jest.fn(),
      addParticipants: jest.fn(),
      recordManualCheck: jest.fn(),
      complete: jest.fn(),
    };
    const metrics = { calculate: jest.fn() };
    const reports = { generate: jest.fn() };
    const controller = new PilotAdminController(
      pilot as unknown as PilotService,
      metrics as unknown as PilotMetricsService,
      reports as unknown as PilotReportService,
    );
    const query = new ListPilotCohortsDto();
    const create = {
      name: 'Pilot',
      description: 'Controlled pilot',
      status: PilotCohortStatus.PLANNED,
      startsAt: '2026-06-15T00:00:00.000Z',
      endsAt: '2026-06-30T00:00:00.000Z',
    };
    const participants = {
      userIds: ['00000000-0000-4000-8000-000000000001'],
    };
    const check = {
      checkType: PilotManualCheckType.TLS,
      status: PilotManualCheckStatus.PASSED,
    };
    const user = {
      userId: 'admin-id',
      role: UserRole.ADMIN,
      sessionId: 'session-id',
      jti: 'jti',
    };

    await controller.list(query);
    await controller.create(create);
    await controller.get('cohort-id');
    await controller.addParticipants('cohort-id', participants);
    await controller.getMetrics('cohort-id');
    await controller.recordCheck('cohort-id', user, check);
    await controller.complete('cohort-id');
    await controller.report('cohort-id');

    expect(pilot.list).toHaveBeenCalledWith(query);
    expect(pilot.create).toHaveBeenCalledWith(create);
    expect(pilot.get).toHaveBeenCalledWith('cohort-id');
    expect(pilot.addParticipants).toHaveBeenCalledWith(
      'cohort-id',
      participants,
    );
    expect(metrics.calculate).toHaveBeenCalledWith('cohort-id');
    expect(pilot.recordManualCheck).toHaveBeenCalledWith(
      'cohort-id',
      'admin-id',
      check,
    );
    expect(pilot.complete).toHaveBeenCalledWith('cohort-id');
    expect(reports.generate).toHaveBeenCalledWith('cohort-id');
  });

  it('requires JWT ADMIN authorization metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PilotAdminController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
