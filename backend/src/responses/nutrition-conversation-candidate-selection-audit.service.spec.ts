import type { AuditService } from '../observability/audit.service';
import {
  CANDIDATE_SELECTION_REASON,
  CANDIDATE_SELECTION_STATUS,
  CONVERSATION_SELECTED_SOURCE,
  CONVERSATION_SELECTION_ROLLOUT_MODE,
  SelectedCandidateDecision,
} from './conversation-candidate-selection.contract';
import { NutritionConversationCandidateSelectionAuditService } from './nutrition-conversation-candidate-selection-audit.service';

const decision: SelectedCandidateDecision = Object.freeze({
  selectedSource: CONVERSATION_SELECTED_SOURCE.FORMATTER,
  reason: CANDIDATE_SELECTION_REASON.ROLLOUT_MODE_OFF,
  comparisonScore: 94,
  promptVersionId: 'prompt-version-id',
  candidateJobId: 'candidate-job-id',
  formatterVersion: 'nutrition-response-formatter:v1',
  selectionStatus: CANDIDATE_SELECTION_STATUS.FUTURE_ROLLOUT_DISABLED,
  rolloutMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
  candidateAvailable: true,
  candidateValid: true,
  timestamp: '2026-07-15T12:00:00.000Z',
  metrics: Object.freeze({
    formatterLength: 100,
    candidateLength: 90,
    candidateUnitCount: 3,
    disclaimerPresent: true,
    requiredFactsPresent: true,
    structureValid: true,
    humanizerScore: 100,
    validatorScore: 95,
  }),
});

describe('NutritionConversationCandidateSelectionAuditService', () => {
  it('persists metadata only through the existing AuditService', async () => {
    const auditService = {
      record: jest.fn().mockResolvedValue({ id: 'audit' }),
    };
    const service = new NutritionConversationCandidateSelectionAuditService(
      auditService as unknown as AuditService,
    );
    await service.record({
      userId: 'user-id',
      decisionReference: 'candidate-job-id',
      decision,
      selectionLatencyMs: 1.25,
    });
    expect(auditService.record).toHaveBeenCalledWith({
      userId: 'user-id',
      action: 'CONVERSATION_CANDIDATE_SELECTION_DECIDED',
      entityType: 'CONVERSATION_CANDIDATE_SELECTION',
      entityId: 'candidate-job-id',
      metadata: expect.objectContaining({
        selectionStatus: 'FUTURE_ROLLOUT_DISABLED',
        selectedSource: 'FORMATTER',
        candidateAvailable: true,
        candidateValid: true,
        formatterVersion: 'nutrition-response-formatter:v1',
        promptVersionId: 'prompt-version-id',
        candidateJobId: 'candidate-job-id',
        comparisonScore: 94,
        timestamp: '2026-07-15T12:00:00.000Z',
        selectionLatencyMs: 1.25,
        humanizerScore: 100,
        validatorScore: 95,
      }),
    });
    const serialized = JSON.stringify(auditService.record.mock.calls[0]);
    expect(serialized).not.toContain('officialResponse');
    expect(serialized).not.toContain('candidateText');
    expect(serialized).not.toContain('outbound');
  });
});
