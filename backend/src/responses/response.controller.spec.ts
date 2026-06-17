import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ResponseBuilderService } from './response-builder.service';
import { ResponseController } from './response.controller';

describe('ResponseController', () => {
  it('is created with the administrative response service', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResponseController],
      providers: [
        {
          provide: ResponseBuilderService,
          useValue: {
            listByConversation: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();

    expect(module.get(ResponseController)).toBeDefined();
  });
});
