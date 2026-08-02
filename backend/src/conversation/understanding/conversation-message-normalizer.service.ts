import { Injectable } from '@nestjs/common';
import type { NormalizedConversationMessage } from '../contracts/conversation-understanding-pipeline.contract';

@Injectable()
export class ConversationMessageNormalizerService {
  normalize(text: string): NormalizedConversationMessage {
    const original = text.normalize('NFKC');
    const canonical = original
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/gu, ' ')
      .trim();
    const folded = canonical
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return Object.freeze({
      original,
      canonical,
      folded,
      hasLexicalContent: /[\p{L}\p{N}]/u.test(folded),
      question:
        original.includes('?') ||
        /^(como|qual|quais|quando|onde|por que|porque|posso|devo|tem|o que)\b/u.test(
          folded,
        ),
    });
  }
}
