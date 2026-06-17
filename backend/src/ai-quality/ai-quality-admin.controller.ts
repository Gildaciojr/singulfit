import {
  Body,
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
import { AIQualityAdminService } from './ai-quality-admin.service';
import { ListAIQualityDto } from './dto/list-ai-quality.dto';
import { ResolveAIReviewDto } from './dto/resolve-ai-review.dto';

@Controller('api/v1/admin/ai-quality')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AIQualityAdminController {
  constructor(private readonly quality: AIQualityAdminService) {}

  @Get('evaluations')
  evaluations(@Query() query: ListAIQualityDto) {
    return this.quality.listEvaluations(query);
  }

  @Get('flags')
  flags(@Query() query: ListAIQualityDto) {
    return this.quality.listFlags(query);
  }

  @Get('prompts')
  prompts(@Query() query: ListAIQualityDto) {
    return this.quality.listPrompts(query);
  }

  @Get('review-queue')
  reviewQueue(@Query() query: ListAIQualityDto) {
    return this.quality.listReviewQueue(query);
  }

  @Post('review-queue/:id/resolve')
  resolveReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ResolveAIReviewDto,
  ) {
    return this.quality.resolveReview(id, input);
  }
}
