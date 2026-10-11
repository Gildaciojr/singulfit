import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  EvolutionConnectionState,
  EvolutionSendTextInput,
  EvolutionSendTextResult,
} from './interfaces/evolution-api.interface';

export class EvolutionSendError extends BadGatewayException {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerStatus?: number,
  ) {
    super(message);
  }
}

export function isRetryableEvolutionSendError(error: unknown): boolean {
  if (error instanceof EvolutionSendError) {
    return error.retryable;
  }

  return !(error instanceof BadRequestException);
}

@Injectable()
export class EvolutionGateway {
  private readonly logger = new Logger(EvolutionGateway.name);

  constructor(private readonly configService: ConfigService) {}

  getInstanceName(): string {
    return this.getRequiredConfig('EVOLUTION_INSTANCE_NAME');
  }

  async getAudioBase64(input: {
    instanceName: string;
    externalMessageId: string;
    remoteJid: string;
  }): Promise<{ base64: string; mimeType?: string }> {
    if (
      input.instanceName !== this.getInstanceName() ||
      !input.externalMessageId.trim()
    )
      throw new BadRequestException('Audio source instance mismatch');
    let response: Response;
    try {
      response = await fetch(
        `${this.getBaseUrl()}/chat/getBase64FromMediaMessage/${encodeURIComponent(input.instanceName)}`,
        {
          method: 'POST',
          headers: {
            apikey: this.getRequiredConfig('EVOLUTION_API_KEY'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              key: {
                id: input.externalMessageId,
                remoteJid: input.remoteJid,
                fromMe: false,
              },
            },
            convertToMp4: false,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new BadGatewayException('AUDIO_DOWNLOAD_UNAVAILABLE');
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429)
        throw new BadGatewayException('AUDIO_DOWNLOAD_UNAVAILABLE');
      throw new BadRequestException('AUDIO_DOWNLOAD_REJECTED');
    }
    if (!response.body) throw new BadRequestException('AUDIO_DOWNLOAD_EMPTY');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    // Base64 overhead plus JSON metadata; never buffer an unbounded API response.
    const maxBytes = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 65536;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > maxBytes)
          throw new BadRequestException('AUDIO_DOWNLOAD_TOO_LARGE');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('AUDIO_DOWNLOAD_INVALID');
    }
    if (
      !this.isRecord(payload) ||
      typeof payload.base64 !== 'string' ||
      !payload.base64.trim()
    )
      throw new BadRequestException('AUDIO_DOWNLOAD_EMPTY');
    return {
      base64: payload.base64,
      mimeType:
        typeof payload.mimetype === 'string' ? payload.mimetype : undefined,
    };
  }

  validateWebhookSecret(suppliedSecret: string | undefined): void {
    const configuredSecret = this.getRequiredConfig('EVOLUTION_WEBHOOK_SECRET');
    const suppliedDigest = createHash('sha256')
      .update(suppliedSecret?.trim() ?? '', 'utf8')
      .digest();
    const configuredDigest = createHash('sha256')
      .update(configuredSecret, 'utf8')
      .digest();

    if (!timingSafeEqual(suppliedDigest, configuredDigest)) {
      throw new UnauthorizedException('Webhook Evolution não autorizado');
    }
  }

  async getConnectionState(): Promise<EvolutionConnectionState> {
    const instanceName = this.getInstanceName();
    let response: Response;

    try {
      response = await fetch(
        `${this.getBaseUrl()}/instance/connectionState/${encodeURIComponent(instanceName)}`,
        {
          method: 'GET',
          headers: {
            apikey: this.getRequiredConfig('EVOLUTION_API_KEY'),
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new BadGatewayException(
        'Não foi possível comunicar com a Evolution API',
      );
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Evolution API rejeitou a consulta da instância (${response.status})`,
      );
    }

    return this.parseConnectionState(payload, instanceName);
  }

  async sendText(
    input: EvolutionSendTextInput,
  ): Promise<EvolutionSendTextResult> {
    const instanceName = this.getInstanceName();
    const number = input.number.replace(/\D/g, '');
    const text = input.text.trim();

    if (!/^\d{10,15}$/.test(number)) {
      throw new BadRequestException('Telefone inválido para envio Evolution');
    }

    if (!text || text.length > 10_000) {
      throw new BadRequestException('Conteúdo inválido para envio Evolution');
    }

    let response: Response;
    const url = `${this.getBaseUrl()}/message/sendText/${encodeURIComponent(instanceName)}`;
    const requestPayload = {
      number,
      text,
    };

    this.logger.debug(
      `Evolution sendText request: ${JSON.stringify({
        url,
        payload: requestPayload,
      })}`,
    );

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: this.getRequiredConfig('EVOLUTION_API_KEY'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new EvolutionSendError(
        'Não foi possível enviar a mensagem pela Evolution API',
        true,
      );
    }

    const payload = await this.readJson(response);
    this.logger.debug(
      `Evolution sendText response: ${JSON.stringify({
        status: response.status,
        headers: this.relevantResponseHeaders(response),
        body: payload,
      })}`,
    );

    if (!response.ok) {
      throw new EvolutionSendError(
        `Evolution API rejeitou o envio da mensagem (${response.status})`,
        this.isRetryableSendFailure(response.status, payload),
        response.status,
      );
    }

    return this.parseSentMessage(payload);
  }

  private getBaseUrl(): string {
    const configuredUrl = this.getRequiredConfig('EVOLUTION_BASE_URL');
    let url: URL;

    try {
      url = new URL(configuredUrl);
    } catch {
      throw new ServiceUnavailableException(
        'EVOLUTION_BASE_URL possui formato inválido',
      );
    }

    if (url.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'EVOLUTION_BASE_URL deve utilizar HTTPS',
      );
    }

    return url.toString().replace(/\/$/, '');
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Configuração obrigatória ausente: ${key}`,
      );
    }

    return value;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException(
        'Evolution API retornou uma resposta inválida',
      );
    }
  }

  private relevantResponseHeaders(response: Response): Record<string, string> {
    const headerNames = [
      'content-type',
      'content-length',
      'date',
      'request-id',
      'x-request-id',
      'x-correlation-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ];
    const headers: Record<string, string> = {};

    for (const headerName of headerNames) {
      const value = response.headers.get(headerName);

      if (value) {
        headers[headerName] = value;
      }
    }

    return headers;
  }

  private parseConnectionState(
    payload: unknown,
    instanceName: string,
  ): EvolutionConnectionState {
    if (!this.isRecord(payload)) {
      throw new BadGatewayException(
        'Evolution API retornou estado de conexão inválido',
      );
    }

    const nestedInstance = this.isRecord(payload.instance)
      ? payload.instance
      : undefined;
    const state =
      typeof payload.state === 'string'
        ? payload.state
        : typeof nestedInstance?.state === 'string'
          ? nestedInstance.state
          : undefined;

    if (!state) {
      throw new BadGatewayException(
        'Evolution API não retornou o estado da instância',
      );
    }

    return {
      instance: instanceName,
      state,
    };
  }

  private parseSentMessage(payload: unknown): EvolutionSendTextResult {
    if (!this.isRecord(payload)) {
      throw new BadGatewayException(
        'Evolution API retornou confirmação de envio inválida',
      );
    }

    const nestedData = this.isRecord(payload.data) ? payload.data : undefined;
    const key = this.isRecord(payload.key)
      ? payload.key
      : this.isRecord(nestedData?.key)
        ? nestedData.key
        : undefined;
    const externalMessageId = typeof key?.id === 'string' ? key.id.trim() : '';
    const remoteJid =
      typeof key?.remoteJid === 'string' && key.remoteJid.trim()
        ? key.remoteJid.trim()
        : undefined;

    if (!externalMessageId) {
      throw new BadGatewayException(
        'Evolution API não retornou o ID da mensagem enviada',
      );
    }

    return {
      externalMessageId,
      ...(remoteJid ? { remoteJid } : {}),
    };
  }

  private isRetryableSendFailure(status: number, payload: unknown): boolean {
    if (this.containsNonexistentDestination(payload)) {
      return false;
    }

    return (
      status === 401 ||
      status === 403 ||
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  private containsNonexistentDestination(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some((entry) => this.containsNonexistentDestination(entry));
    }

    if (!this.isRecord(value)) {
      return false;
    }

    if (value.exists === false) {
      return true;
    }

    return Object.values(value).some((entry) =>
      this.containsNonexistentDestination(entry),
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
