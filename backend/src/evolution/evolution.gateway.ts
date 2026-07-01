import {
  BadRequestException,
  BadGatewayException,
  Injectable,
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

@Injectable()
export class EvolutionGateway {
  constructor(private readonly configService: ConfigService) {}

  getInstanceName(): string {
    return this.getRequiredConfig('EVOLUTION_INSTANCE_NAME');
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

    try {
      response = await fetch(
        `${this.getBaseUrl()}/message/sendText/${encodeURIComponent(instanceName)}`,
        {
          method: 'POST',
          headers: {
            apikey: this.getRequiredConfig('EVOLUTION_API_KEY'),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            number,
            text,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new BadGatewayException(
        'Não foi possível enviar a mensagem pela Evolution API',
      );
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Evolution API rejeitou o envio da mensagem (${response.status})`,
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
