export interface EvolutionConnectionState {
  instance: string;
  state: string;
}

export interface EvolutionSendTextInput {
  number: string;
  text: string;
}

export interface EvolutionSendTextResult {
  externalMessageId: string;
}

export interface EvolutionInboundMessage {
  instanceName: string;
  externalMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  messageTimestamp: Date;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT';
  content: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mimeType?: string;
  fileSize?: number;
  originalFileName?: string;
}

export interface EvolutionWebhookResult {
  received: true;
  processed: boolean;
  duplicated?: boolean;
  reason?:
    | 'EVENT_IGNORED'
    | 'INSTANCE_MISMATCH'
    | 'MESSAGE_IGNORED'
    | 'USER_NOT_FOUND'
    | 'QUEUED';
  messageId?: string;
  mediaFileId?: string;
  mealId?: string;
  mealAnalysisId?: string;
  usageLimited?: boolean;
  entitlementCode?: string;
  outboundMessageId?: string;
  outboundStatus?: 'PENDING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  userId?: string;
  subscriptionStatus?: 'ACTIVE' | 'PAST_DUE' | 'EXPIRED';
}
