import { ConfigService } from '@nestjs/config';
import { AudioTranscriptionGateway } from './audio-transcription.gateway';

describe('AudioTranscriptionGateway (controlled HTTP)', () => {
  const config = new ConfigService({
    OPENAI_API_KEY: 'synthetic-test-key',
    OPENAI_MODEL_AUDIO: 'gpt-4o-mini-transcribe',
  });
  afterEach(() => jest.restoreAllMocks());
  it('uploads bytes with a filename, normalized MIME and language without a manual multipart boundary', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'Me mostra minha dieta',
          usage: {
            type: 'tokens',
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { headers: { 'x-request-id': 'req_synthetic' } },
      ),
    );
    const response = await new AudioTranscriptionGateway(config).transcribe({
      content: Buffer.from('synthetic'),
      mimeType: 'audio/ogg',
      filename: 'recording.ogg',
      requestId: 'job-test',
    });
    expect(response).toMatchObject({
      responseId: 'req_synthetic',
      outputText: 'Me mostra minha dieta',
      totalTokens: 15,
    });
    const options = request.mock.calls[0][1];
    expect(request.mock.calls[0][0]).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    );
    expect(options?.headers).toEqual({
      Authorization: 'Bearer synthetic-test-key',
      'X-Client-Request-Id': 'job-test',
    });
    const form = options?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error('Missing form');
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('pt');
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file');
    if (!(file instanceof Blob)) throw new Error('Missing audio');
    expect(file.type).toBe('audio/ogg');
    expect(file.size).toBe(9);
  });
  it.each([429, 400, 401, 500])(
    'classifies HTTP %s without implicit retries',
    async (status) => {
      const request = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status }));
      await expect(
        new AudioTranscriptionGateway(config).transcribe({
          content: Buffer.from('synthetic'),
          mimeType: 'audio/wav',
          filename: 'recording.wav',
          requestId: 'job',
        }),
      ).rejects.toMatchObject({ retryable: status === 429 });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it('does not repeat a request whose network outcome is unknown', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('timeout'));
    await expect(
      new AudioTranscriptionGateway(config).transcribe({
        content: Buffer.from('synthetic'),
        mimeType: 'audio/wav',
        filename: 'recording.wav',
        requestId: 'job',
      }),
    ).rejects.toMatchObject({
      code: 'AUDIO_PROVIDER_OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { text: 'hello' },
    { text: 'hello', usage: { type: 'duration', seconds: 4 } },
    {
      text: 'hello',
      usage: {
        type: 'duration',
        seconds: 4,
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    },
    {
      text: 'hello',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    {
      text: 'hello',
      usage: {
        type: 'tokens',
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    },
    {
      text: 'hello',
      usage: {
        type: 'tokens',
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 5,
      },
    },
    {
      text: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  ])(
    'rejects unverifiable transcript/accounting without inventing tokens: %j',
    async (value) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(value)));
      await expect(
        new AudioTranscriptionGateway(config).transcribe({
          content: Buffer.from('synthetic'),
          mimeType: 'audio/wav',
          filename: 'recording.wav',
          requestId: 'job',
        }),
      ).rejects.toThrow('AUDIO_PROVIDER_INVALID');
    },
  );
  it.each([
    'gpt-transcribe',
    'whisper-1',
    'gpt-4o-transcribe-diarize',
    'unverified-model',
  ])('rejects incompatible model %s before a provider call', async (model) => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Provider calls disabled in this test'));
    await expect(
      new AudioTranscriptionGateway(
        new ConfigService({
          OPENAI_API_KEY: 'synthetic-test-key',
          OPENAI_MODEL_AUDIO: model,
        }),
      ).transcribe({
        content: Buffer.from('synthetic'),
        mimeType: 'audio/ogg',
        filename: 'recording.ogg',
        requestId: 'job-test',
      }),
    ).rejects.toThrow('MODEL_UNSUPPORTED');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    'gpt-4o-mini-transcribe',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe-2025-12-15',
  ])('preserves documented token-accounted model %s', async (model) => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'Já bebi água hoje',
          usage: {
            type: 'tokens',
            input_tokens: 10,
            input_token_details: { audio_tokens: 10, text_tokens: 0 },
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
      ),
    );
    await expect(
      new AudioTranscriptionGateway(
        new ConfigService({
          OPENAI_API_KEY: 'synthetic-test-key',
          OPENAI_MODEL_AUDIO: model,
        }),
      ).transcribe({
        content: Buffer.from('synthetic'),
        mimeType: 'audio/ogg',
        filename: 'recording.ogg',
        requestId: 'job-test',
      }),
    ).resolves.toMatchObject({ model, totalTokens: 15 });
    const form = request.mock.calls[0][1]?.body;
    if (!(form instanceof FormData)) throw new Error('Missing form');
    expect(form.get('language')).toBe('pt');
    expect(form.get('languages[]')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires an explicitly configured token-accounted audio model', () => {
    expect(() =>
      new AudioTranscriptionGateway(new ConfigService()).configuration(),
    ).toThrow('NOT_CONFIGURED');
    expect(() =>
      new AudioTranscriptionGateway(
        new ConfigService({
          OPENAI_API_KEY: 'synthetic',
          OPENAI_MODEL_AUDIO: 'whisper-1',
        }),
      ).configuration(),
    ).toThrow('MODEL_UNSUPPORTED');
  });
});
