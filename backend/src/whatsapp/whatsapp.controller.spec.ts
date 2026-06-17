import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { WhatsAppController } from './whatsapp.controller';

describe('WhatsAppController', () => {
  let controller: WhatsAppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        {
          provide: ConversationsService,
          useValue: {
            getActiveByUserId: jest.fn(),
          },
        },
        {
          provide: MessagesService,
          useValue: {
            createInternal: jest.fn(),
            list: jest.fn(),
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

    controller = module.get(WhatsAppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
