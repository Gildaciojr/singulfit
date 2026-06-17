import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListNutritionAdminDto } from './dto/list-nutrition-admin.dto';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';

@Controller('api/v1/admin/nutrition')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class NutritionAdminController {
  constructor(
    private readonly intelligenceService: NutritionIntelligenceService,
  ) {}

  @Get('insights')
  listInsights(@Query() query: ListNutritionAdminDto) {
    return this.intelligenceService.listInsights(query);
  }

  @Get('trends')
  listTrends(@Query() query: ListNutritionAdminDto) {
    return this.intelligenceService.listTrends(query);
  }

  @Get('quality')
  listQuality(@Query() query: ListNutritionAdminDto) {
    return this.intelligenceService.listQuality(query);
  }
}
