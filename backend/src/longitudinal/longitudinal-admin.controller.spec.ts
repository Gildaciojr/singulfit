import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ListLongitudinalDto } from './dto/list-longitudinal.dto';
import { LongitudinalAdminController } from './longitudinal-admin.controller';
import { LongitudinalAdminService } from './longitudinal-admin.service';

describe('LongitudinalAdminController', () => {
  it('exposes all longitudinal views through an ADMIN-only controller', async () => {
    const admin = {
      users: jest.fn().mockResolvedValue({ items: [] }),
      preferences: jest.fn().mockResolvedValue({ items: [] }),
      relapses: jest.fn().mockResolvedValue({ items: [] }),
      evolution: jest.fn().mockResolvedValue({ items: [] }),
      reviews: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new LongitudinalAdminController(
      admin as unknown as LongitudinalAdminService,
    );
    const query = new ListLongitudinalDto();

    await controller.users(query);
    await controller.preferences(query);
    await controller.relapses(query);
    await controller.evolution(query);
    await controller.reviews(query);

    expect(admin.users).toHaveBeenCalledWith(query);
    expect(admin.preferences).toHaveBeenCalledWith(query);
    expect(admin.relapses).toHaveBeenCalledWith(query);
    expect(admin.evolution).toHaveBeenCalledWith(query);
    expect(admin.reviews).toHaveBeenCalledWith(query);
    expect(Reflect.getMetadata(ROLES_KEY, LongitudinalAdminController)).toEqual(
      [UserRole.ADMIN],
    );
  });
});
