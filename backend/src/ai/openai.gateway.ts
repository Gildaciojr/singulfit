import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OpenAIJsonSchema,
  OpenAIModelCapability,
  OpenAIResponseResult,
  OpenAITextRequest,
  OpenAIVisionRequest,
} from './interfaces/openai.interface';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

@Injectable()
export class OpenAIGateway {
  constructor(private readonly configService: ConfigService) {}

  createTextResponse(
    request: OpenAITextRequest,
  ): Promise<OpenAIResponseResult> {
    return this.createResponse('TEXT', {
      instructions: this.requireText(request.instructions, 'Instruções'),
      input: this.requireText(request.input, 'Entrada'),
      requestId: request.requestId,
      text: request.jsonSchema
        ? {
            format: this.createJsonSchemaFormat(request.jsonSchema),
          }
        : undefined,
    });
  }

  createVisionResponse(
    request: OpenAIVisionRequest,
  ): Promise<OpenAIResponseResult> {
    const imageUrl = this.validateImageUrl(request.imageUrl);

    return this.createResponse('VISION', {
      instructions: this.requireText(request.instructions, 'Instruções'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: this.requireText(request.input, 'Entrada'),
            },
            {
              type: 'input_image',
              image_url: imageUrl,
            },
          ],
        },
      ],
      requestId: request.requestId,
      text: request.jsonSchema
        ? {
            format: this.createJsonSchemaFormat(request.jsonSchema),
          }
        : undefined,
    });
  }

  private async createResponse(
    capability: OpenAIModelCapability,
    request: {
      instructions: string;
      input: string | Array<Record<string, unknown>>;
      requestId: string;
      text?: {
        format: {
          type: 'json_schema';
          name: string;
          description?: string;
          strict: true;
          schema: Record<string, unknown>;
        };
      };
    },
  ): Promise<OpenAIResponseResult> {
    const apiKey = this.getRequiredConfig('OPENAI_API_KEY');
    const model = this.getModel(capability);
    let response: Response;

    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Client-Request-Id': request.requestId,
        },
        body: JSON.stringify({
          model,
          instructions: request.instructions,
          input: request.input,
          text: request.text,
          store: false,
          metadata: {
            ai_job_id: request.requestId,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new BadGatewayException('Não foi possível comunicar com a OpenAI');
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      const requestId = response.headers.get('x-request-id');
      const suffix = requestId ? `, request ${requestId}` : '';

      throw new BadGatewayException(
        `OpenAI rejeitou a solicitação (${response.status}${suffix})`,
      );
    }

    return this.parseResponse(payload);
  }

  private parseResponse(payload: unknown): OpenAIResponseResult {
    if (
      !this.isRecord(payload) ||
      typeof payload.id !== 'string' ||
      typeof payload.model !== 'string' ||
      !this.isRecord(payload.usage)
    ) {
      throw new BadGatewayException('Resposta inválida da OpenAI');
    }

    const promptTokens = payload.usage.input_tokens;
    const completionTokens = payload.usage.output_tokens;
    const totalTokens = payload.usage.total_tokens;

    if (
      !this.isNonNegativeInteger(promptTokens) ||
      !this.isNonNegativeInteger(completionTokens) ||
      !this.isNonNegativeInteger(totalTokens) ||
      totalTokens !== promptTokens + completionTokens
    ) {
      throw new BadGatewayException(
        'OpenAI não retornou contabilização válida de tokens',
      );
    }

    return {
      responseId: payload.id,
      model: payload.model,
      outputText: this.extractOutputText(payload),
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  private extractOutputText(payload: Record<string, unknown>): string {
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
      return payload.output_text.trim();
    }

    if (!Array.isArray(payload.output)) {
      throw new BadGatewayException('OpenAI não retornou conteúdo textual');
    }

    const texts: string[] = [];

    for (const outputItem of payload.output) {
      if (!this.isRecord(outputItem) || !Array.isArray(outputItem.content)) {
        continue;
      }

      for (const contentItem of outputItem.content) {
        if (
          this.isRecord(contentItem) &&
          contentItem.type === 'output_text' &&
          typeof contentItem.text === 'string' &&
          contentItem.text.trim()
        ) {
          texts.push(contentItem.text.trim());
        }
      }
    }

    if (texts.length === 0) {
      throw new BadGatewayException('OpenAI não retornou conteúdo textual');
    }

    return texts.join('\n');
  }

  private getModel(capability: OpenAIModelCapability): string {
    return this.getRequiredConfig(
      capability === 'TEXT' ? 'OPENAI_MODEL_TEXT' : 'OPENAI_MODEL_VISION',
    );
  }

  private validateImageUrl(value: string): string {
    const normalized = value.trim();

    if (
      /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        normalized,
      )
    ) {
      return normalized;
    }

    let url: URL;

    try {
      url = new URL(normalized);
    } catch {
      throw new BadRequestException('URL da imagem inválida');
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException('URL da imagem deve utilizar HTTPS');
    }

    return url.toString();
  }

  private createJsonSchemaFormat(schema: OpenAIJsonSchema) {
    const name = this.requireText(schema.name, 'Nome do JSON Schema');

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new BadRequestException('Nome do JSON Schema inválido');
    }

    const description = schema.description?.trim();

    return {
      type: 'json_schema' as const,
      name,
      ...(description ? { description } : {}),
      strict: true as const,
      schema: schema.schema,
    };
  }

  private requireText(value: string, label: string): string {
    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException(`${label} não informada`);
    }

    return normalized;
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
      throw new BadGatewayException('OpenAI retornou uma resposta inválida');
    }
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
