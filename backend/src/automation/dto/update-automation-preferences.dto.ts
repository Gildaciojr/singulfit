import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAutomationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  workoutReminderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mealReminderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  hydrationReminderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  progressReminderEnabled?: boolean;
}
