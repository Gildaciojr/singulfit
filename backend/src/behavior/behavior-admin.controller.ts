import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BehavioralIntelligenceService } from './behavioral-intelligence.service';
import { ListBehaviorAdminDto } from './dto/list-behavior-admin.dto';

@Controller('api/v1/admin/behavior')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BehaviorAdminController {
  constructor(private readonly behavior: BehavioralIntelligenceService) {}

  @Get('users')
  users(@Query() query: ListBehaviorAdminDto) {
    return this.behavior.listUsers(query);
  }

  @Get('insights')
  insights(@Query() query: ListBehaviorAdminDto) {
    return this.behavior.listInsights(query);
  }

  @Get('adherence')
  adherence(@Query() query: ListBehaviorAdminDto) {
    return this.behavior.listAdherence(query);
  }

  @Get('stages')
  stages(@Query() query: ListBehaviorAdminDto) {
    return this.behavior.listStages(query);
  }
}
