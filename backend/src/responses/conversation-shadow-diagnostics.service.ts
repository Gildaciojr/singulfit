import { Injectable, Logger } from '@nestjs/common';

export type ConversationShadowDiagnosticEvent =
  | 'STARTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'SKIPPED_CONCURRENCY';

export interface ConversationShadowDiagnostic {
  readonly event: ConversationShadowDiagnosticEvent;
  readonly component?: string;
  readonly realizerStatus?: string;
  readonly candidateEligible?: boolean;
  readonly rejectionCode?: string;
  readonly latencyMs?: number;
  readonly legacyCharacters?: number;
  readonly candidateCharacters?: number;
  readonly candidateQuestions?: number;
  readonly candidateEmojis?: number;
  readonly fallback?: boolean;
}

@Injectable()
export class ConversationShadowDiagnosticsService {
  private readonly logger = new Logger(
    ConversationShadowDiagnosticsService.name,
  );

  record(diagnostic: ConversationShadowDiagnostic): void {
    try {
      this.logger.log(
        `Conversation shadow diagnostic: ${JSON.stringify(diagnostic)}`,
      );
    } catch {
      // Observability is deliberately best-effort and cannot affect production.
    }
  }
}
