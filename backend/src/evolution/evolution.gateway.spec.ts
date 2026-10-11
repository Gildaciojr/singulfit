import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionGateway, EvolutionSendError } from './evolution.gateway';

describe('EvolutionGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createGateway() {
    const values: Record<string, string> = {
      EVOLUTION_BASE_URL: 'https://evolution.example.com',
      EVOLUTION_API_KEY: 'evolution-api-key',
      EVOLUTION_INSTANCE_NAME: 'singulfit',
      EVOLUTION_WEBHOOK_SECRET: 'evolution-webhook-secret',
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    };

    return new EvolutionGateway(configService as unknown as ConfigService);
  }

  it('retrieves decrypted audio from the configured Evolution instance without fetching the CDN URL', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          mediaType: 'audioMessage',
          fileName: 'synthetic-audio.ogg',
          caption: null,
          size: { fileLength: 4 },
          base64: 'T2dnUw==',
          mimetype: 'audio/ogg; codecs=opus',
          buffer: null,
        }),
      ),
    );
    const gateway = createGateway();
    await expect(
      gateway.getAudioBase64({
        instanceName: 'singulfit',
        externalMessageId: 'synthetic-audio',
        remoteJid: '5511987654321@s.whatsapp.net',
      }),
    ).resolves.toEqual({
      base64: 'T2dnUw==',
      mimeType: 'audio/ogg; codecs=opus',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://evolution.example.com/chat/getBase64FromMediaMessage/singulfit',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        apikey: 'evolution-api-key',
        'Content-Type': 'application/json',
      },
    });
    const body = fetchMock.mock.calls[0][1]?.body;
    if (typeof body !== 'string') throw new Error('Missing audio request JSON');
    expect(JSON.parse(body)).toEqual({
      message: {
        key: {
          id: 'synthetic-audio',
          remoteJid: '5511987654321@s.whatsapp.net',
          fromMe: false,
        },
      },
      convertToMp4: false,
    });
  });
  it('rejects foreign instances before retrieving private audio', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      createGateway().getAudioBase64({
        instanceName: 'foreign',
        externalMessageId: 'synthetic',
        remoteJid: '5511987654321@s.whatsapp.net',
      }),
    ).rejects.toThrow('instance mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([400, 401, 404, 429, 500])(
    'classifies audio retrieval failure %s without falling back to encrypted bytes',
    async (status) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status }));
      await expect(
        createGateway().getAudioBase64({
          instanceName: 'singulfit',
          externalMessageId: 'synthetic',
          remoteJid: '5511987654321@s.whatsapp.net',
        }),
      ).rejects.toThrow(
        status >= 500 || status === 429
          ? 'AUDIO_DOWNLOAD_UNAVAILABLE'
          : 'AUDIO_DOWNLOAD_REJECTED',
      );
    },
  );
  it.each([{}, { base64: '' }, { base64: null }])(
    'rejects invalid decrypted media responses: %j',
    async (value) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(value)));
      await expect(
        createGateway().getAudioBase64({
          instanceName: 'singulfit',
          externalMessageId: 'synthetic',
          remoteJid: '5511987654321@s.whatsapp.net',
        }),
      ).rejects.toThrow('AUDIO_DOWNLOAD_EMPTY');
    },
  );
  it('consults the configured instance using the API key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          instance: {
            state: 'open',
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const gateway = createGateway();

    await expect(gateway.getConnectionState()).resolves.toEqual({
      instance: 'singulfit',
      state: 'open',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/connectionState/singulfit',
      expect.objectContaining({
        method: 'GET',
        headers: {
          apikey: 'evolution-api-key',
          Accept: 'application/json',
        },
      }),
    );
  });

  it('validates the custom webhook secret', () => {
    const gateway = createGateway();

    expect(() =>
      gateway.validateWebhookSecret('evolution-webhook-secret'),
    ).not.toThrow();
    expect(() => gateway.validateWebhookSecret('invalid-secret')).toThrow(
      UnauthorizedException,
    );
  });

  it('sends a text message and returns its external ID', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          key: {
            id: 'wamid-outbound-test',
          },
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const gateway = createGateway();

    await expect(
      gateway.sendText({
        number: '+55 (11) 99999-9999',
        text: 'Resposta nutricional',
      }),
    ).resolves.toEqual({
      externalMessageId: 'wamid-outbound-test',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/message/sendText/singulfit',
      expect.objectContaining({
        method: 'POST',
        headers: {
          apikey: 'evolution-api-key',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          number: '5511999999999',
          text: 'Resposta nutricional',
        }),
      }),
    );
  });

  it('classifies a structured nonexistent destination as permanent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            message: [
              {
                number: '5511999999999',
                exists: false,
              },
            ],
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const gateway = createGateway();

    const send = gateway.sendText({
      number: '+5511999999999',
      text: 'Mensagem',
    });

    await expect(send).rejects.toMatchObject({
      retryable: false,
      providerStatus: 400,
    });
    await expect(send).rejects.toBeInstanceOf(EvolutionSendError);
  });

  it('classifies provider unavailability as retryable', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'temporarily unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const gateway = createGateway();

    await expect(
      gateway.sendText({
        number: '+5511999999999',
        text: 'Mensagem',
      }),
    ).rejects.toMatchObject({
      retryable: true,
      providerStatus: 503,
    });
  });

  it.each([401, 403])(
    'classifies provider authentication status %s as retryable',
    async (status) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'authentication failed' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const gateway = createGateway();

      await expect(
        gateway.sendText({
          number: '+5511999999999',
          text: 'Mensagem',
        }),
      ).rejects.toMatchObject({
        retryable: true,
        providerStatus: status,
      });
    },
  );
});
