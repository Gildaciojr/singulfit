import { createHash } from 'node:crypto';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

export class SanitizedConversationPayloadReferenceBuilder {
  build(payload: SanitizedConversationPayload): string {
    const digest = createHash('sha256')
      .update(this.canonicalStringify(payload))
      .digest('hex');
    return `sanitized-payload:${digest}`;
  }

  private canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalStringify(item)).join(',')}]`;
    }
    if (this.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonicalStringify(value[key])}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
