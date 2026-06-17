import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdaptiveIntelligenceService } from './adaptive-intelligence.service';
import { ListAdaptiveIntelligenceDto } from './dto/list-adaptive-intelligence.dto';

@Controller('api/v1/admin/nutrition')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdaptiveNutritionAdminController {
  constructor(private readonly adaptive: AdaptiveIntelligenceService) {}

  @Get('evidence')
  evidence(@Query() query: ListAdaptiveIntelligenceDto) {
    return this.adaptive.listEvidence(query);
  }

  @Get('patterns')
  patterns(@Query() query: ListAdaptiveIntelligenceDto) {
    return this.adaptive.listPatterns(query);
  }
}

@Controller('api/v1/admin/coach')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdaptiveCoachAdminController {
  constructor(private readonly adaptive: AdaptiveIntelligenceService) {}

  @Get('learning')
  learning(@Query() query: ListAdaptiveIntelligenceDto) {
    return this.adaptive.listLearning(query);
  }

  @Get('communication')
  communication(@Query() query: ListAdaptiveIntelligenceDto) {
    return this.adaptive.listCommunication(query);
  }
}

@Controller('api/v1/admin/churn')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EarlyChurnAdminController {
  constructor(private readonly adaptive: AdaptiveIntelligenceService) {}

  @Get('early')
  early(@Query() query: ListAdaptiveIntelligenceDto) {
    return this.adaptive.listEarlyChurn(query);
  }
}
