import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { OnboardingService } from './onboarding.service';
import { ProfileService } from './profile.service';

@Controller('api/v1/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly onboardingService: OnboardingService,
  ) {}

  @Get('onboarding')
  getOnboarding(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.getChecklist(user.userId);
  }

  @Get('measurements')
  getMeasurements(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.listMeasurements(user.userId);
  }

  @Post('measurements')
  createMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMeasurementDto,
  ) {
    return this.profileService.createMeasurement(user.userId, body);
  }

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.get(user.userId);
  }

  @Post()
  createProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProfileDto,
  ) {
    return this.profileService.create(user.userId, body);
  }

  @Patch()
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ) {
    return this.profileService.update(user.userId, body);
  }
}
