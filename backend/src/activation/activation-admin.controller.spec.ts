import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ActivationAdminController } from './activation-admin.controller';
import { ActivationMetricsService } from './activation-metrics.service';
import { ListActivationDto } from './dto/list-activation.dto';

describe('ActivationAdminController', () => {
  it('delegates all activation admin APIs', async () => {
    const metrics = {
      listUsers: jest.fn().mockResolvedValue({ items: [] }),
      funnel: jest.fn().mockResolvedValue({ stages: [] }),
      risk: jest.fn().mockResolvedValue({ items: [] }),
      snapshots: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new ActivationAdminController(
      metrics as unknown as ActivationMetricsService,
    );
    const query = new ListActivationDto();

    await controller.users(query);
    await controller.funnel();
    await controller.risk(query);
    await controller.snapshots(query);

    expect(metrics.listUsers).toHaveBeenCalledWith(query);
    expect(metrics.funnel).toHaveBeenCalledTimes(1);
    expect(metrics.risk).toHaveBeenCalledWith(query);
    expect(metrics.snapshots).toHaveBeenCalledWith(query);
  });

  it('requires the ADMIN role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ActivationAdminController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
