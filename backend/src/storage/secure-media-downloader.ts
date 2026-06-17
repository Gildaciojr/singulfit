import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { DownloadedMedia } from './interfaces/media.interface';

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class SecureMediaDownloader {
  download(sourceUrl: string, maxBytes: number): Promise<DownloadedMedia> {
    return this.downloadUrl(sourceUrl, maxBytes, 0);
  }

  private async downloadUrl(
    sourceUrl: string,
    maxBytes: number,
    redirectCount: number,
  ): Promise<DownloadedMedia> {
    const url = this.validateUrl(sourceUrl);
    const address = await this.resolvePublicAddress(url.hostname);
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, address.address, address.family);
    };

    return new Promise<DownloadedMedia>((resolve, reject) => {
      const mediaRequest = request(
        url,
        {
          method: 'GET',
          headers: {
            Accept: '*/*',
            'User-Agent': 'LucyFit-Media-Downloader/1.0',
          },
          lookup: pinnedLookup,
          servername: url.hostname,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;

          if (
            statusCode >= 300 &&
            statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();

            if (redirectCount >= MAX_REDIRECTS) {
              reject(
                new BadGatewayException(
                  'A mídia excedeu o limite de redirecionamentos',
                ),
              );
              return;
            }

            const redirectUrl = new URL(response.headers.location, url);
            void this.downloadUrl(
              redirectUrl.toString(),
              maxBytes,
              redirectCount + 1,
            ).then(resolve, reject);
            return;
          }

          if (statusCode !== 200) {
            response.resume();
            reject(
              new BadGatewayException(
                `Servidor de mídia retornou status ${statusCode}`,
              ),
            );
            return;
          }

          const declaredLength = this.parseContentLength(response.headers);

          if (declaredLength !== undefined && declaredLength > maxBytes) {
            response.destroy();
            reject(
              new PayloadTooLargeException(
                'A mídia excede o tamanho máximo permitido',
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          let settled = false;

          response.on('data', (chunk: Buffer | string) => {
            if (settled) {
              return;
            }

            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;

            if (receivedBytes > maxBytes) {
              settled = true;
              response.destroy();
              reject(
                new PayloadTooLargeException(
                  'A mídia excede o tamanho máximo permitido',
                ),
              );
              return;
            }

            chunks.push(buffer);
          });
          response.on('end', () => {
            if (settled) {
              return;
            }

            settled = true;
            resolve({
              content: Buffer.concat(chunks),
              contentType: this.firstHeaderValue(
                response.headers['content-type'],
              ),
              originalFileName: this.parseContentDisposition(
                this.firstHeaderValue(response.headers['content-disposition']),
              ),
            });
          });
          response.on('error', (error) => {
            if (!settled) {
              settled = true;
              reject(
                new BadGatewayException(
                  `Falha durante o download da mídia: ${error.message}`,
                ),
              );
            }
          });
        },
      );

      mediaRequest.setTimeout(REQUEST_TIMEOUT_MS, () => {
        mediaRequest.destroy(
          new Error('Tempo limite de download da mídia excedido'),
        );
      });
      mediaRequest.on('error', (error) => {
        reject(
          new BadGatewayException(
            `Não foi possível baixar a mídia: ${error.message}`,
          ),
        );
      });
      mediaRequest.end();
    });
  }

  private validateUrl(sourceUrl: string): URL {
    let url: URL;

    try {
      url = new URL(sourceUrl);
    } catch {
      throw new BadRequestException('URL de mídia inválida');
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      throw new BadRequestException(
        'A URL de mídia deve utilizar HTTPS sem credenciais',
      );
    }

    const hostname = url.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new BadRequestException('Host de mídia não permitido');
    }

    return url;
  }

  private async resolvePublicAddress(hostname: string) {
    const directFamily = isIP(hostname);
    const addresses = directFamily
      ? [{ address: hostname, family: directFamily }]
      : await lookup(hostname, {
          all: true,
          verbatim: true,
        });

    if (
      addresses.length === 0 ||
      addresses.some((address) => !this.isPublicIp(address.address))
    ) {
      throw new BadRequestException(
        'O host de mídia não possui endereço público permitido',
      );
    }

    return addresses[0];
  }

  private isPublicIp(address: string): boolean {
    if (address.includes(':')) {
      const normalized = address.toLowerCase();

      if (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized)
      ) {
        return false;
      }

      if (normalized.startsWith('::ffff:')) {
        return this.isPublicIpv4(normalized.slice(7));
      }

      return true;
    }

    return this.isPublicIpv4(address);
  }

  private isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);

    if (
      octets.length !== 4 ||
      octets.some(
        (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
      )
    ) {
      return false;
    }

    const [first, second] = octets;

    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  private parseContentLength(headers: IncomingHttpHeaders): number | undefined {
    const value = this.firstHeaderValue(headers['content-length']);

    if (!value) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private parseContentDisposition(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);

    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return undefined;
      }
    }

    return /filename="?([^";]+)"?/i.exec(value)?.[1];
  }

  private firstHeaderValue(
    value: string | string[] | undefined,
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
