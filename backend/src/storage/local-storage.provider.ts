import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  OpenedObject,
  StorageProviderAdapter,
  StoredObject,
  StoreObjectInput,
} from './interfaces/storage-provider.interface';

@Injectable()
export class LocalStorageProvider implements StorageProviderAdapter {
  constructor(private readonly configService: ConfigService) {}

  async store(input: StoreObjectInput): Promise<StoredObject> {
    const storagePath = this.buildStoragePath(input.checksum);
    const absolutePath = this.resolveStoragePath(storagePath);

    await mkdir(dirname(absolutePath), {
      recursive: true,
    });

    try {
      await writeFile(absolutePath, input.content, {
        flag: 'wx',
        mode: 0o600,
      });

      return {
        storagePath,
        deduplicated: false,
      };
    } catch (error: unknown) {
      if (!this.isFileExistsError(error)) {
        throw error;
      }

      await this.assertExistingObject(
        absolutePath,
        input.checksum,
        input.content.length,
      );

      return {
        storagePath,
        deduplicated: true,
      };
    }
  }

  async open(storagePath: string): Promise<OpenedObject> {
    const absolutePath = this.resolveStoragePath(storagePath);

    try {
      const fileStats = await stat(absolutePath);

      if (!fileStats.isFile()) {
        throw new NotFoundException('Arquivo de mídia não encontrado');
      }

      return {
        stream: createReadStream(absolutePath),
        fileSize: fileStats.size,
      };
    } catch (error: unknown) {
      if (this.isFileNotFoundError(error)) {
        throw new NotFoundException('Arquivo de mídia não encontrado');
      }

      throw error;
    }
  }

  private getRootPath(): string {
    const configuredPath = this.configService
      .get<string>('UPLOAD_PATH', './uploads')
      .trim();

    if (!configuredPath) {
      throw new ServiceUnavailableException('UPLOAD_PATH não configurado');
    }

    return resolve(configuredPath);
  }

  private buildStoragePath(checksum: string): string {
    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      throw new ServiceUnavailableException(
        'Checksum inválido para armazenamento local',
      );
    }

    return `sha256/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}`;
  }

  private resolveStoragePath(storagePath: string): string {
    if (!storagePath || isAbsolute(storagePath) || storagePath.includes('\0')) {
      throw new NotFoundException('Caminho de mídia inválido');
    }

    const rootPath = this.getRootPath();
    const absolutePath = resolve(rootPath, storagePath);
    const relativePath = relative(rootPath, absolutePath);

    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new NotFoundException('Caminho de mídia inválido');
    }

    return absolutePath;
  }

  private async assertExistingObject(
    absolutePath: string,
    checksum: string,
    expectedSize: number,
  ): Promise<void> {
    const existingContent = await readFile(absolutePath);
    const existingChecksum = createHash('sha256')
      .update(existingContent)
      .digest('hex');

    if (
      existingContent.length !== expectedSize ||
      existingChecksum !== checksum
    ) {
      throw new ServiceUnavailableException(
        'Colisão ou corrupção detectada no armazenamento local',
      );
    }
  }

  private isFileExistsError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    );
  }

  private isFileNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }
}
