import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import { PaymentsController } from './payments.controller';
import { PixPaymentsService } from './pix-payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  const creditCardPaymentsService = {
    create: jest.fn(),
    getPublicKey: jest.fn().mockReturnValue('public-key-value'),
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
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();

    controller = module.get(PaymentsController);
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
});
