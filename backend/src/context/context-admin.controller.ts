import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ContextService } from './context.service';
import { ListContextUsersDto } from './dto/list-context-users.dto';

@Controller('api/v1/admin/context')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ContextAdminController {
  constructor(private readonly contextService: ContextService) {}

  @Get('users')
  listUsers(@Query() query: ListContextUsersDto) {
    return this.contextService.listUsers(query);
  }

  @Get(':userId/memory')
  getMemory(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.contextService.getMemory(userId);
  }

  @Get(':userId')
  getContext(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.contextService.buildUserContext(userId);
  }
}
