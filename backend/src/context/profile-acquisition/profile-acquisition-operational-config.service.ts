import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROFILE_ACQUISITION_MODE,
  ProfileAcquisitionMode,
} from './profile-acquisition.contract';

const MODE_KEY = 'PROFILE_ACQUISITION_MODE';
export interface ProfileAcquisitionOperationalConfig {
  readonly mode: ProfileAcquisitionMode;
  readonly questionExpirationHours: number;
}

@Injectable()
export class ProfileAcquisitionOperationalConfigService {
  constructor(private readonly configService: ConfigService) {}

  get(): ProfileAcquisitionOperationalConfig {
    return Object.freeze({
      mode: this.mode(this.configService.get<string>(MODE_KEY)),
      questionExpirationHours: 48,
    });
  }

  private mode(value: string | undefined): ProfileAcquisitionMode {
    const normalized = value?.trim().toUpperCase();
    switch (normalized) {
      case PROFILE_ACQUISITION_MODE.SHADOW:
        return PROFILE_ACQUISITION_MODE.SHADOW;
      case PROFILE_ACQUISITION_MODE.INTERNAL:
        return PROFILE_ACQUISITION_MODE.INTERNAL;
      default:
        return PROFILE_ACQUISITION_MODE.OFF;
    }
  }
}
