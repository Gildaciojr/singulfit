import { Prisma } from '@prisma/client';

export interface PagBankWebhookPayload {
  id: string;
  referenceId?: string;
  status?: string;
  payload: Prisma.InputJsonObject;
}

export interface PagBankWebhookHeaders {
  authenticityToken?: string;
  requestId?: string;
}
