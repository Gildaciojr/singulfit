import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PILOT_ENABLED_KEY = 'NUTRITION_V2_PILOT_ENABLED';
const PILOT_USER_IDS_KEY = 'NUTRITION_V2_PILOT_USER_IDS';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const NUTRITION_V2_PILOT_TIMEOUT_MS = 50_000;

export type NutritionV2PilotAuthorization =
  | Readonly<{ status: 'AUTHORIZED' }>
  | Readonly<{
      status: 'DISABLED' | 'INVALID_CONFIG' | 'NOT_AUTHORIZED';
    }>;

@Injectable()
export class NutritionV2PilotConfigService {
  constructor(private readonly config: ConfigService) {}

  authorize(userId: string): NutritionV2PilotAuthorization {
    const enabled = this.config.get<string>(PILOT_ENABLED_KEY);

    if (enabled === undefined || enabled.trim() === '' || enabled === 'false')
      return Object.freeze({ status: 'DISABLED' });
    if (enabled !== 'true') return Object.freeze({ status: 'INVALID_CONFIG' });

    const parsed = this.parseAllowlist(
      this.config.get<string>(PILOT_USER_IDS_KEY),
    );
    if (!parsed) return Object.freeze({ status: 'INVALID_CONFIG' });

    const normalizedUserId = userId.trim().toLowerCase();
    return Object.freeze({
      status: parsed.has(normalizedUserId)
        ? ('AUTHORIZED' as const)
        : ('NOT_AUTHORIZED' as const),
    });
  }

  timeoutMs(): number {
    return NUTRITION_V2_PILOT_TIMEOUT_MS;
  }

  private parseAllowlist(
    value: string | undefined,
  ): ReadonlySet<string> | null {
    if (value === undefined) return new Set<string>();

    const entries = value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    if (entries.some((entry) => !UUID_PATTERN.test(entry))) return null;
    return new Set(entries);
  }
}
