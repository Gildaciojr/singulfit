import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListRecommendationsDto } from './dto/list-recommendations.dto';
import { RecommendationService } from './recommendation.service';

@Controller('api/v1/admin/recommendations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class RecommendationAdminController {
  constructor(private readonly recommendations: RecommendationService) {}

  @Get()
  list(@Query() query: ListRecommendationsDto) {
    return this.recommendations.list(query);
  }

  @Get('stats')
  stats(@Query() query: ListRecommendationsDto) {
    return this.recommendations.stats(query);
  }

  @Post(':id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.recommendations.accept(id);
  }

  @Post(':id/dismiss')
  dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.recommendations.dismiss(id);
  }
}
