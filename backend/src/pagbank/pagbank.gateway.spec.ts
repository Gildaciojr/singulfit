import { ConfigService } from '@nestjs/config';
import { PagBankGateway } from './pagbank.gateway';

describe('PagBankGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a PagBank order and maps the PIX data', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          PAGBANK_API_URL: 'https://sandbox.api.pagseguro.com',
          PAGBANK_TOKEN: 'test-token',
        };

        return values[key];
      }),
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'ORDE_TEST',
          reference_id: 'pay_reference',
          qr_codes: [
            {
              id: 'QRCO_TEST',
              expiration_date: '2026-06-06T18:30:00.000Z',
              text: '00020101021226860014br.gov.bcb.pix',
              links: [
                {
                  rel: 'QRCODE.PNG',
                  href: 'https://api.pagseguro.com/qrcode.png',
                },
              ],
            },
          ],
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const gateway = new PagBankGateway(
      configService as unknown as ConfigService,
    );

    const result = await gateway.createPixPayment({
      idempotencyKey: 'pix-idempotency-key',
      externalReference: 'pay_reference',
      amountInCents: 1990,
      expirationDate: new Date('2026-06-06T18:30:00.000Z'),
      customer: {
        name: 'SingulFit',
        email: 'lucy@example.com',
        taxId: '12345678901',
        phone: {
          country: '55',
          area: '11',
          number: '999999999',
          type: 'MOBILE',
        },
      },
      item: {
        referenceId: 'BASIC',
        name: 'Assinatura SingulFit Basic',
      },
    });

    expect(result).toEqual({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'QRCO_TEST',
      qrCode: '00020101021226860014br.gov.bcb.pix',
      qrCodeImageUrl: 'https://api.pagseguro.com/qrcode.png',
      expiresAt: new Date('2026-06-06T18:30:00.000Z'),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.api.pagseguro.com/orders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'x-idempotency-key': 'pix-idempotency-key',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado ao PagBank deveria ser JSON');
    }

    const body = JSON.parse(request.body) as {
      notification_urls: string[];
      qr_codes: Array<{
        amount: {
          value: number;
        };
      }>;
    };

    expect(body.notification_urls).toEqual([
      'https://api.singulfit.com.br/api/v1/webhooks/pagbank',
    ]);
    expect(body.qr_codes[0].amount.value).toBe(1990);
  });

  it('consults a charge and maps the canonical paid status', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          PAGBANK_API_URL: 'https://sandbox.api.pagseguro.com',
          PAGBANK_TOKEN: 'test-token',
        };

        return values[key];
      }),
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'ORDE_TEST',
          reference_id: 'pay_reference',
          charges: [
            {
              id: 'CHAR_TEST',
              reference_id: 'pay_reference',
              status: 'PAID',
              paid_at: '2026-06-06T18:30:00.000Z',
              amount: {
                value: 1990,
                currency: 'BRL',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const gateway = new PagBankGateway(
      configService as unknown as ConfigService,
    );

    const result = await gateway.getPayment('CHAR_TEST');

    expect(result).toEqual({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      externalReference: 'pay_reference',
      status: 'APPROVED',
      statusDetail: undefined,
      amountInCents: 1990,
      currency: 'BRL',
      approvedAt: new Date('2026-06-06T18:30:00.000Z'),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.api.pagseguro.com/orders?charge_id=CHAR_TEST',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('creates a PagBank order with an encrypted credit card charge', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          PAGBANK_API_URL: 'https://sandbox.api.pagseguro.com',
          PAGBANK_TOKEN: 'test-token',
        };

        return values[key];
      }),
    };
    const approvedAt = '2026-06-06T18:30:00.000Z';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'ORDE_TEST',
          reference_id: 'pay_reference',
          charges: [
            {
              id: 'CHAR_TEST',
              reference_id: 'pay_reference',
              status: 'PAID',
              paid_at: approvedAt,
              amount: {
                value: 4990,
                currency: 'BRL',
              },
              payment_response: {
                code: '20000',
                message: 'SUCESSO',
              },
              payment_method: {
                card: {
                  brand: 'visa',
                  last_digits: '1111',
                },
              },
            },
          ],
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const gateway = new PagBankGateway(
      configService as unknown as ConfigService,
    );

    const result = await gateway.createCreditCardPayment({
      idempotencyKey: 'card-idempotency-key',
      externalReference: 'pay_reference',
      amountInCents: 4990,
      customer: {
        name: 'SingulFit',
        email: 'lucy@example.com',
        taxId: '12345678901',
        phone: {
          country: '55',
          area: '11',
          number: '999999999',
          type: 'MOBILE',
        },
      },
      item: {
        referenceId: 'PREMIUM',
        name: 'Assinatura SingulFit Premium',
      },
      encryptedCard: 'encrypted-card-payload',
      holder: {
        name: 'SingulFit',
        taxId: '12345678901',
      },
      installments: 1,
    });

    expect(result).toEqual({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      status: 'APPROVED',
      statusDetail: 'SUCESSO',
      approvedAt: new Date(approvedAt),
      cardBrand: 'visa',
      cardLastFour: '1111',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.api.pagseguro.com/orders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'x-idempotency-key': 'card-idempotency-key',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0][1];

    if (typeof request?.body !== 'string') {
      throw new Error('O corpo enviado ao PagBank deveria ser JSON');
    }

    const body = JSON.parse(request.body) as {
      notification_urls: string[];
      charges: Array<{
        payment_method: {
          type: string;
          installments: number;
          capture: boolean;
          card: {
            encrypted: string;
            store: boolean;
          };
        };
      }>;
    };

    expect(body.notification_urls).toEqual([
      'https://api.singulfit.com.br/api/v1/webhooks/pagbank',
    ]);
    expect(body.charges[0].payment_method).toEqual(
      expect.objectContaining({
        type: 'CREDIT_CARD',
        installments: 1,
        capture: true,
        card: {
          encrypted: 'encrypted-card-payload',
          store: false,
        },
      }),
    );
  });
});
