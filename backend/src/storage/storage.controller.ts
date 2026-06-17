import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { MediaService } from './media.service';

@Controller('api/v1/media')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':mediaFileId/download')
  async download(
    @Param('mediaFileId', ParseUUIDPipe) mediaFileId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.mediaService.openForDownload(
      mediaFileId,
      currentUser,
    );
    const asciiFileName = result.mediaFile.originalFileName.replace(
      /[^\x20-\x7e]/g,
      '_',
    );
    const encodedFileName = encodeURIComponent(
      result.mediaFile.originalFileName,
    );

    response.set({
      'Content-Type': result.mediaFile.mimeType,
      'Content-Length': result.mediaFile.fileSize.toString(),
      'Content-Disposition': `attachment; filename="${asciiFileName.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodedFileName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(result.stream);
  }
}
