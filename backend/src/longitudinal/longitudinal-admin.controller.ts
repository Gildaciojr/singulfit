import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListLongitudinalDto } from './dto/list-longitudinal.dto';
import { LongitudinalAdminService } from './longitudinal-admin.service';

@Controller('api/v1/admin/longitudinal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class LongitudinalAdminController {
  constructor(private readonly admin: LongitudinalAdminService) {}

  @Get('users')
  users(@Query() query: ListLongitudinalDto) {
    return this.admin.users(query);
  }

  @Get('preferences')
  preferences(@Query() query: ListLongitudinalDto) {
    return this.admin.preferences(query);
  }

  @Get('relapses')
  relapses(@Query() query: ListLongitudinalDto) {
    return this.admin.relapses(query);
  }

  @Get('evolution')
  evolution(@Query() query: ListLongitudinalDto) {
    return this.admin.evolution(query);
  }

  @Get('reviews')
  reviews(@Query() query: ListLongitudinalDto) {
    return this.admin.reviews(query);
  }
}
