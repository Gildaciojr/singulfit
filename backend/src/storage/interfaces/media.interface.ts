import { MediaType } from '@prisma/client';

export interface StoreRemoteMediaInput {
  userId: string;
  conversationId: string;
  messageId: string;
  mediaType: MediaType;
  sourceUrl?: string;
  base64Data?: string;
  originalFileName?: string;
  declaredMimeType?: string;
  declaredFileSize?: number;
}

export interface DownloadedMedia {
  content: Buffer;
  contentType?: string;
  originalFileName?: string;
}
