import { Readable } from 'node:stream';

export const LOCAL_STORAGE_PROVIDER = Symbol('LOCAL_STORAGE_PROVIDER');

export interface StoreObjectInput {
  checksum: string;
  content: Buffer;
}

export interface StoredObject {
  storagePath: string;
  deduplicated: boolean;
}

export interface OpenedObject {
  stream: Readable;
  fileSize: number;
}

export interface StorageProviderAdapter {
  store(input: StoreObjectInput): Promise<StoredObject>;
  open(storagePath: string): Promise<OpenedObject>;
}
