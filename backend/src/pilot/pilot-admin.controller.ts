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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { AddPilotParticipantsDto } from './dto/add-pilot-participants.dto';
import { CreatePilotCohortDto } from './dto/create-pilot-cohort.dto';
import { ListPilotCohortsDto } from './dto/list-pilot-cohorts.dto';
import { RecordPilotCheckDto } from './dto/record-pilot-check.dto';
import { PilotMetricsService } from './pilot-metrics.service';
import { PilotReportService } from './pilot-report.service';
import { PilotService } from './pilot.service';

@Controller('api/v1/admin/pilot/cohorts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PilotAdminController {
  constructor(
    private readonly pilot: PilotService,
    private readonly metrics: PilotMetricsService,
    private readonly reports: PilotReportService,
  ) {}

  @Get()
  list(@Query() query: ListPilotCohortsDto) {
    return this.pilot.list(query);
  }

  @Post()
  create(@Body() input: CreatePilotCohortDto) {
    return this.pilot.create(input);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pilot.get(id);
  }

  @Post(':id/participants')
  addParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AddPilotParticipantsDto,
  ) {
    return this.pilot.addParticipants(id, input);
  }

  @Get(':id/metrics')
  getMetrics(@Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.calculate(id);
  }

  @Post(':id/checks')
  recordCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RecordPilotCheckDto,
  ) {
    return this.pilot.recordManualCheck(id, user.userId, input);
  }

  @Post(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.pilot.complete(id);
  }

  @Get(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.generate(id);
  }
}
