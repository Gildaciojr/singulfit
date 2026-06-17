import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

@Injectable()
export class WorkerIdentityService {
  readonly instanceId: string;

  constructor(configService: ConfigService) {
    this.instanceId =
      configService.get<string>('WORKER_INSTANCE_ID')?.trim() ||
      `${hostname()}:${process.pid}:${randomUUID()}`;
  }
}
