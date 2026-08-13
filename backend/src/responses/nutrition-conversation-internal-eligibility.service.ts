import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const INTERNAL_USER_IDS_KEY = 'NUTRITION_CONVERSATION_INTERNAL_USER_IDS';

@Injectable()
export class NutritionConversationInternalEligibilityService {
  constructor(private readonly configService: ConfigService) {}

  isEligible(userId: string): boolean {
    const configured = this.configService.get<string>(INTERNAL_USER_IDS_KEY);
    if (!configured) return false;

    const userIds = new Set(
      configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );

    return userIds.has(userId);
  }
}
