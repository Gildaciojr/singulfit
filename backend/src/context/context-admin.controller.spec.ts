import { UserRole } from '@prisma/client';
import { ContextAdminController } from './context-admin.controller';
import { ContextService } from './context.service';

describe('ContextAdminController', () => {
  it('delegates read-only administrative context operations', async () => {
    const contextService = {
      listUsers: jest.fn(),
      buildUserContext: jest.fn(),
      getMemory: jest.fn(),
    };
    const controller = new ContextAdminController(
      contextService as unknown as ContextService,
    );
    const query = {
      limit: 25,
    };
    const user = {
      userId: 'admin-id',
      role: UserRole.ADMIN,
    };

    await controller.listUsers(query);
    await controller.getContext(user.userId);
    await controller.getMemory(user.userId);

    expect(contextService.listUsers).toHaveBeenCalledWith(query);
    expect(contextService.buildUserContext).toHaveBeenCalledWith('admin-id');
    expect(contextService.getMemory).toHaveBeenCalledWith('admin-id');
  });
});
