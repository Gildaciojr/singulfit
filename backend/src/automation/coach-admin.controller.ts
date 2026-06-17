import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CoachExperienceService } from './coach-experience.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { ListCoachAdminDto } from './dto/list-coach-admin.dto';

@Controller('api/v1/admin/coach')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CoachAdminController {
  constructor(
    private readonly coach: CoachIntelligenceService,
    private readonly experience: CoachExperienceService,
  ) {}

  @Get('users')
  listUsers(@Query() query: ListCoachAdminDto) {
    return this.coach.listUsers(query);
  }

  @Get('engagement')
  listEngagement(@Query() query: ListCoachAdminDto) {
    return this.coach.listEngagement(query);
  }

  @Get('churn')
  listChurn(@Query() query: ListCoachAdminDto) {
    return this.coach.listChurn(query);
  }

  @Get('reviews')
  listReviews(@Query() query: ListCoachAdminDto) {
    return this.coach.listReviews(query);
  }

  @Get('profiles')
  listProfiles(@Query() query: ListCoachAdminDto) {
    return this.experience.listProfiles(query);
  }

  @Get('fatigue')
  listFatigue(@Query() query: ListCoachAdminDto) {
    return this.experience.listFatigue(query);
  }

  @Get('momentum')
  listMomentum(@Query() query: ListCoachAdminDto) {
    return this.experience.listMomentum(query);
  }

  @Get('retention')
  listRetention(@Query() query: ListCoachAdminDto) {
    return this.experience.listRetention(query);
  }
}
