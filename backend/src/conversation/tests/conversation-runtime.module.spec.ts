import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConversationRuntimeIntegrationService } from '../runtime/conversation-runtime-integration.service';
import { ConversationRuntimeModule } from '../runtime/conversation-runtime.module';

describe('ConversationRuntimeModule', () => {
  it('compiles as the isolated production integration boundary', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ConversationRuntimeModule,
      ],
    }).compile();

    expect(module.get(ConversationRuntimeIntegrationService)).toBeDefined();
    await module.close();
  });
});
