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
  readonly selectionLatencyMs?: number;
  readonly selectionStatus?: string;
  readonly selectedSource?: string;
  readonly selectionReason?: string;
  readonly candidateAvailable?: boolean;
  readonly candidateValid?: boolean;
  readonly comparisonScore?: number;
  readonly formatterVersion?: string;
  readonly promptVersionId?: string | null;
  readonly candidateJobId?: string | null;
  readonly selectionAuditPersisted?: boolean;
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
