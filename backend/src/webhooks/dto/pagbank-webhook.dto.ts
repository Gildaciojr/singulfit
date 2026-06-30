import { Prisma } from '@prisma/client';
import type { IncomingHttpHeaders } from 'node:http';

export interface PagBankWebhookPayload {
  id: string;
  referenceId?: string;
  status?: string;
  payload: Prisma.InputJsonObject;
}

export interface PagBankWebhookHeaders {
  authenticityToken?: string;
  requestId?: string;
  receivedHeaders?: IncomingHttpHeaders;
}
