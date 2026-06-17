import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LOCAL_STORAGE_PROVIDER } from './interfaces/storage-provider.interface';
import { LocalStorageProvider } from './local-storage.provider';
import { MediaService } from './media.service';
import { SecureMediaDownloader } from './secure-media-downloader';
import { StorageController } from './storage.controller';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [StorageController],
  providers: [
    MediaService,
    SecureMediaDownloader,
    LocalStorageProvider,
    {
      provide: LOCAL_STORAGE_PROVIDER,
      useExisting: LocalStorageProvider,
    },
  ],
  exports: [MediaService, LOCAL_STORAGE_PROVIDER],
})
export class StorageModule {}
