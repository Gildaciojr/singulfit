import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { AutomationService } from './automation.service';
import { UpdateAutomationPreferencesDto } from './dto/update-automation-preferences.dto';

@Controller('api/v1/automations')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.getPreferences(user.userId);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateAutomationPreferencesDto,
  ) {
    return this.automationService.updatePreferences(user.userId, body);
  }

  @Get()
  getAutomations(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.getAutomations(user.userId);
  }
}
