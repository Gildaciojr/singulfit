import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActivationMetricsService } from './activation-metrics.service';
import { ListActivationDto } from './dto/list-activation.dto';

@Controller('api/v1/admin/activation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ActivationAdminController {
  constructor(private readonly metrics: ActivationMetricsService) {}

  @Get('users')
  users(@Query() query: ListActivationDto) {
    return this.metrics.listUsers(query);
  }

  @Get('funnel')
  funnel() {
    return this.metrics.funnel();
  }

  @Get('risk')
  risk(@Query() query: ListActivationDto) {
    return this.metrics.risk(query);
  }

  @Get('snapshots')
  snapshots(@Query() query: ListActivationDto) {
    return this.metrics.snapshots(query);
  }
}
