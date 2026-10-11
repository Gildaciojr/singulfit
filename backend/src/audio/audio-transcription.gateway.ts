import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { OpenAIResponseResult } from '../ai/interfaces/openai.interface';

export class AudioTranscriptionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export interface AudioTranscriptionRequest {
  readonly content: Buffer;
  readonly mimeType: string;
  readonly filename: string;
  readonly requestId: string;
}

@Injectable()
export class AudioTranscriptionGateway {
  constructor(private readonly config: ConfigService) {}

  configuration() {
    const provider = this.config.get<string>(
      'AUDIO_TRANSCRIPTION_PROVIDER',
      'OPENAI',
    );
    const model = this.config.get<string>('OPENAI_MODEL_AUDIO')?.trim();
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (provider !== 'OPENAI' || !model || !key)
      throw new ServiceUnavailableException(
        'AUDIO_TRANSCRIPTION_NOT_CONFIGURED',
      );
    // Launch model: gpt-4o-mini-transcribe. Only documented token-accounted
    // models are supported; duration-based usage cannot use these tariffs.
    if (
      ![
        'gpt-4o-transcribe',
        'gpt-4o-mini-transcribe',
        'gpt-4o-mini-transcribe-2025-12-15',
      ].includes(model)
    )
      throw new ServiceUnavailableException(
        'AUDIO_TRANSCRIPTION_MODEL_UNSUPPORTED',
      );
    return { model, key };
  }

  async transcribe(
    input: AudioTranscriptionRequest,
  ): Promise<OpenAIResponseResult> {
    const { model, key } = this.configuration();
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.content)], { type: input.mimeType }),
      input.filename,
    );
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('language', 'pt');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'X-Client-Request-Id': input.requestId,
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // A timeout may follow a charged request. It is not safe to automatically
      // recreate that request: the transcription endpoint has no retrieval API.
      throw new AudioTranscriptionError(
        'AUDIO_PROVIDER_OUTCOME_UNKNOWN',
        false,
      );
    }
    if (!response.ok) {
      // Explicit rate-limit rejection is the only provider retry with no accepted
      // result. No unbounded retries for 5xx, malformed responses or timeouts.
      throw new AudioTranscriptionError(
        response.status === 429
          ? 'AUDIO_PROVIDER_RATE_LIMIT'
          : 'AUDIO_PROVIDER_REJECTED',
        response.status === 429,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new BadGatewayException('AUDIO_PROVIDER_INVALID_RESPONSE');
    }
    if (
      !record(value) ||
      typeof value.text !== 'string' ||
      !record(value.usage)
    )
      throw new BadGatewayException('AUDIO_PROVIDER_INVALID_RESPONSE');
    const usage = value.usage;
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = usage.total_tokens;
    if (
      usage.type !== 'tokens' ||
      !integer(inputTokens) ||
      !integer(outputTokens) ||
      !integer(totalTokens) ||
      totalTokens === 0 ||
      inputTokens + outputTokens !== totalTokens
    )
      throw new AudioTranscriptionError('AUDIO_PROVIDER_INVALID_USAGE', false);
    return {
      responseId:
        response.headers.get('x-request-id') ?? `audio_${randomUUID()}`,
      model,
      outputText: value.text,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens,
    };
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
