import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  const rootPath = resolve('.tmp', `storage-unit-${randomUUID()}`);
  const configService = {
    get: jest.fn().mockReturnValue(rootPath),
  };
  const provider = new LocalStorageProvider(
    configService as unknown as ConfigService,
  );

  beforeAll(async () => {
    await mkdir(rootPath, {
      recursive: true,
    });
  });

  afterAll(async () => {
    await rm(rootPath, {
      recursive: true,
      force: true,
    });
  });

  it('writes one checksum-addressed object and deduplicates repeated content', async () => {
    const content = Buffer.from('same-media-content');
    const checksum = createHash('sha256').update(content).digest('hex');

    const first = await provider.store({
      checksum,
      content,
    });
    const repeated = await provider.store({
      checksum,
      content,
    });

    expect(first.deduplicated).toBe(false);
    expect(repeated).toEqual({
      storagePath: first.storagePath,
      deduplicated: true,
    });
    await expect(
      readFile(resolve(rootPath, first.storagePath)),
    ).resolves.toEqual(content);
  });

  it('rejects path traversal when opening an object', async () => {
    await expect(provider.open('../outside')).rejects.toThrow(
      'Caminho de mídia inválido',
    );
  });
});
