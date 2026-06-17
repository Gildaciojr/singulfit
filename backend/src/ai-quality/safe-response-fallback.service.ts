import { Injectable } from '@nestjs/common';

@Injectable()
export class SafeResponseFallbackService {
  build(): string {
    return 'Posso te ajudar com orientações gerais de alimentação e hábitos, mas esse tema precisa de acompanhamento profissional. Se quiser, posso sugerir uma alternativa alimentar mais segura para o seu objetivo.';
  }
}
