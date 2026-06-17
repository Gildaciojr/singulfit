import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionGateway } from './evolution.gateway';

describe('EvolutionGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createGateway() {
    const values: Record<string, string> = {
      EVOLUTION_BASE_URL: 'https://evolution.example.com',
      EVOLUTION_API_KEY: 'evolution-api-key',
      EVOLUTION_INSTANCE_NAME: 'lucyfit',
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
      instance: 'lucyfit',
      state: 'open',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/connectionState/lucyfit',
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
      'https://evolution.example.com/message/sendText/lucyfit',
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
});
