import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PagBankRecurringProvisioningService } from '../pagbank/pagbank-recurring-provisioning.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import { CreateRecurringCreditCardSubscriptionDto } from './dto/create-recurring-credit-card-subscription.dto';
import { PaymentsController } from './payments.controller';
import { PixPaymentsService } from './pix-payments.service';
import { validate } from 'class-validator';

const encryptedCard = 'encrypted-card-payload-'.repeat(8);
const authenticatedUser = { userId: 'authenticated-user-id' } as never;
const recurringBody = {
  subscriptionId: 'subscription-id',
  planId: 'plan-id',
  billingCycles: 1 as const,
  encryptedCard,
  holderName: 'Titular do Cartão',
  holderCpf: '12345678909',
};

describe('PaymentsController', () => {
  let controller: PaymentsController;
  const creditCardPaymentsService = {
    create: jest.fn(),
    getPublicKey: jest.fn().mockReturnValue('public-key-value'),
  };
  const recurringProvisioning = {
    createSubscription: jest.fn(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PixPaymentsService,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: CreditCardPaymentsService,
          useValue: creditCardPaymentsService,
        },
        {
          provide: PagBankRecurringProvisioningService,
          useValue: recurringProvisioning,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();

    controller = module.get(PaymentsController);
    jest.clearAllMocks();
    creditCardPaymentsService.getPublicKey.mockReturnValue('public-key-value');
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      phone: '+5511999999999',
    });
    recurringProvisioning.createSubscription.mockResolvedValue({
      id: 'subscription-id',
      status: 'PENDING_PAYMENT',
      provider: 'PAGBANK',
      externalSubscriptionId: 'SUBS_TEST',
      billingCycles: 1,
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the PagBank public key without exposing the provider token', () => {
    expect(controller.getCreditCardPublicKey()).toEqual({
      publicKey: 'public-key-value',
    });
    expect(creditCardPaymentsService.getPublicKey).toHaveBeenCalled();
  });

  it('delegates recurring provisioning with the authenticated user id only', async () => {
    await expect(
      controller.createRecurringCreditCard(authenticatedUser, {
        ...recurringBody,
        userId: 'forged-user-id',
      } as never),
    ).resolves.toEqual({
      subscriptionId: 'subscription-id',
      status: 'PENDING_PAYMENT',
      provider: 'PAGBANK',
      externalSubscriptionId: 'SUBS_TEST',
      billingCycles: 1,
    });
    expect(recurringProvisioning.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'authenticated-user-id',
        subscriptionId: recurringBody.subscriptionId,
        planId: recurringBody.planId,
        billingCycles: 1,
        card: expect.objectContaining({
          encryptedCard,
          email: 'user@example.com',
          phone: {
            country: '55',
            area: '11',
            number: '999999999',
            type: 'MOBILE',
          },
        }),
      }),
    );
  });

  it.each([1, 3, 6, 12] as const)(
    'accepts billingCycles=%s',
    async (billingCycles) => {
      await controller.createRecurringCreditCard(authenticatedUser, {
        ...recurringBody,
        billingCycles,
      });
      expect(recurringProvisioning.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ billingCycles }),
      );
    },
  );

  it.each([0, 2, 4, 5, 13, 1.5, '3'])(
    'rejects invalid billingCycles=%s',
    async (billingCycles) => {
      const dto = Object.assign(
        new CreateRecurringCreditCardSubscriptionDto(),
        {
          ...recurringBody,
          billingCycles,
        },
      );
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it.each([
    [
      'ACTIVE subscription',
      new Error('Assinatura não disponível para cobrança recorrente'),
    ],
    ['another user subscription', new Error('Assinatura local não encontrada')],
    ['mismatched plan', new Error('Assinatura local não encontrada')],
  ])(
    'does not bypass the provisioning fence for %s',
    async (_scenario, error) => {
      recurringProvisioning.createSubscription.mockRejectedValueOnce(error);
      await expect(
        controller.createRecurringCreditCard(authenticatedUser, recurringBody),
      ).rejects.toThrow(error.message);
    },
  );

  it('does not expose encrypted card data in the recurring response', async () => {
    const response = await controller.createRecurringCreditCard(
      authenticatedUser,
      recurringBody,
    );
    expect(response).not.toHaveProperty('encryptedCard');
    expect(JSON.stringify(response)).not.toContain(encryptedCard);
  });

  it('does not define PAN or CVV fields in the recurring request DTO', () => {
    const dto = new CreateRecurringCreditCardSubscriptionDto();
    expect(dto).not.toHaveProperty('cardNumber');
    expect(dto).not.toHaveProperty('pan');
    expect(dto).not.toHaveProperty('cvv');
    expect(dto).not.toHaveProperty('securityCode');
  });

  it('propagates provisioning failures without returning success', async () => {
    recurringProvisioning.createSubscription.mockRejectedValueOnce(
      new Error('PagBank indisponível'),
    );
    await expect(
      controller.createRecurringCreditCard(authenticatedUser, recurringBody),
    ).rejects.toThrow('PagBank indisponível');
  });
});
