import { BadRequestException } from '@nestjs/common';
import { SecureMediaDownloader } from './secure-media-downloader';

describe('SecureMediaDownloader', () => {
  it.each([
    'http://media.example.com/file.jpg',
    'https://localhost/file.jpg',
    'https://127.0.0.1/file.jpg',
    'https://10.0.0.1/file.jpg',
    'https://[::1]/file.jpg',
  ])('blocks unsafe media URL %s', async (url) => {
    const downloader = new SecureMediaDownloader();

    await expect(downloader.download(url, 1024)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
