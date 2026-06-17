import { ConfigService } from '@nestjs/config';
import { OpenAIGateway } from './openai.gateway';

describe('OpenAIGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createGateway() {
    const values: Record<string, string> = {
      OPENAI_API_KEY: 'openai-test-key',
      OPENAI_MODEL_TEXT: 'text-model-test',
      OPENAI_MODEL_VISION: 'vision-model-test',
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    };

    return new OpenAIGateway(configService as unknown as ConfigService);
  }

  it('creates a text response and maps token usage', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_test',
          model: 'text-model-test',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Resposta de teste',
                },
              ],
            },
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 150,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'request-test',
          },
        },
      ),
    );
    const gateway = createGateway();

    const result = await gateway.createTextResponse({
      instructions: 'Prompt versão 1',
      input: 'Mensagem do usuário',
      requestId: 'ai-job-id',
    });

    expect(result).toEqual({
      responseId: 'resp_test',
      model: 'text-model-test',
      outputText: 'Resposta de teste',
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-test-key',
          'X-Client-Request-Id': 'ai-job-id',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado à OpenAI deveria ser JSON');
    }

    const body = JSON.parse(request.body) as {
      model: string;
      store: boolean;
      metadata: {
        ai_job_id: string;
      };
    };

    expect(body).toEqual(
      expect.objectContaining({
        model: 'text-model-test',
        store: false,
        metadata: {
          ai_job_id: 'ai-job-id',
        },
      }),
    );
  });

  it('sends a strict JSON schema for structured text responses', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_structured',
          model: 'text-model-test',
          output_text: '{"title":"Treino"}',
          usage: {
            input_tokens: 80,
            output_tokens: 20,
            total_tokens: 100,
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

    await gateway.createTextResponse({
      instructions: 'Gere um treino',
      input: '{"goal":"WEIGHT_LOSS"}',
      requestId: 'workout-request-id',
      jsonSchema: {
        name: 'workout_plan',
        description: 'Treino estruturado',
        schema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
            },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
    });
    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado à OpenAI deveria ser JSON');
    }

    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({
        text: {
          format: {
            type: 'json_schema',
            name: 'workout_plan',
            description: 'Treino estruturado',
            strict: true,
            schema: expect.objectContaining({
              type: 'object',
            }),
          },
        },
      }),
    );
  });

  it('uses the vision model and multimodal input for image requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_vision',
          model: 'vision-model-test',
          output_text: 'Descrição genérica',
          usage: {
            input_tokens: 200,
            output_tokens: 20,
            total_tokens: 220,
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

    await gateway.createVisionResponse({
      instructions: 'Descreva a imagem sem análise especializada',
      input: 'Descreva o conteúdo',
      imageUrl: 'https://media.example.com/image.jpg',
      requestId: 'vision-job-id',
    });

    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado à OpenAI deveria ser JSON');
    }

    const body = JSON.parse(request.body) as {
      model: string;
      input: Array<{
        content: Array<{
          type: string;
          image_url?: string;
        }>;
      }>;
    };

    expect(body.model).toBe('vision-model-test');
    expect(body.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: 'https://media.example.com/image.jpg',
    });
  });

  it('sends private image data with a strict JSON schema', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_structured_vision',
          model: 'vision-model-test',
          output_text: '{"foods":[]}',
          usage: {
            input_tokens: 210,
            output_tokens: 40,
            total_tokens: 250,
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
    const schema = {
      type: 'object',
      properties: {
        foods: {
          type: 'array',
        },
      },
      required: ['foods'],
      additionalProperties: false,
    };

    await gateway.createVisionResponse({
      instructions: 'Analise a refeição',
      input: 'Retorne a estimativa nutricional',
      imageUrl: `data:image/jpeg;base64,${Buffer.from('image').toString('base64')}`,
      requestId: 'structured-vision-job-id',
      jsonSchema: {
        name: 'nutrition_analysis',
        description: 'Análise nutricional estruturada',
        schema,
      },
    });

    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado à OpenAI deveria ser JSON');
    }

    const body = JSON.parse(request.body) as {
      input: Array<{
        content: Array<{
          type: string;
          image_url?: string;
        }>;
      }>;
      text: {
        format: {
          type: string;
          name: string;
          strict: boolean;
          schema: Record<string, unknown>;
        };
      };
    };

    expect(body.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${Buffer.from('image').toString('base64')}`,
    });
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'nutrition_analysis',
      description: 'Análise nutricional estruturada',
      strict: true,
      schema,
    });
  });
});
