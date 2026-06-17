import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersService } from './users.service';
import { UsageService } from '../usage/usage.service';
import { FindOrCreateUserDto } from './dto/find-or-create-user.dto';
import { UseUserDto } from './dto/use-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly usageService: UsageService,
  ) {}

  @Post('find-or-create')
  async findOrCreate(@Body() body: FindOrCreateUserDto) {
    return this.usersService.findOrCreateUser(body);
  }

  @Post('use')
  async use(@Body() body: UseUserDto) {
    return this.usageService.checkAvailability(body.userId);
  }
}
