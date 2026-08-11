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
