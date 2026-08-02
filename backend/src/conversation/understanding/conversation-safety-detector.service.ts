import { Injectable } from '@nestjs/common';
import type {
  ConversationSafety,
  ConversationSafetySignal,
} from '../contracts/conversation-understanding.contract';
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
import type {
  ConversationSafetyDetection,
  NormalizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

@Injectable()
export class ConversationSafetyDetectorService {
  detect(message: NormalizedConversationMessage): ConversationSafetyDetection {
    const signals: ConversationSafetySignal[] = [];
    const entities: ConversationEntity[] = [];
    const text = message.folded;

    if (/\bdor no peito\b/u.test(text)) {
      this.add(signals, entities, 'PAIN', 'HIGH', 'PAIN', 'peito');
    } else if (/\bdor(es)?\b/u.test(text)) {
      this.add(
        signals,
        entities,
        'PAIN',
        'MEDIUM',
        'PAIN',
        this.bodyArea(text),
      );
    }
    if (/\b(desmaio|desmaiei|inconsciente|perdi a consciencia)\b/u.test(text)) {
      this.add(signals, entities, 'INCAPACITY', 'HIGH', 'INCAPACITY', null);
    }
    if (/\b(fratura|fraturei|osso quebrado)\b/u.test(text)) {
      this.add(
        signals,
        entities,
        'INJURY',
        'HIGH',
        'INJURY',
        this.bodyArea(text),
      );
    } else if (/\b(lesao|lesionei|machuquei)\b/u.test(text)) {
      this.add(
        signals,
        entities,
        'INJURY',
        'MEDIUM',
        'INJURY',
        this.bodyArea(text),
      );
    }
    if (
      /\b(desidratacao grave|muito desidratado|muito desidratada)\b/u.test(text)
    ) {
      this.add(signals, entities, 'MEDICAL', 'HIGH', 'MALAISE', null);
    }
    if (
      /\b(pressao alta|pressao baixa|hipertensao|hipoglicemia|gestante|gestacao|gravida|medicamento|medicamentos|remedio|remedios|restricao medica|condicao medica)\b/u.test(
        text,
      )
    ) {
      this.add(
        signals,
        entities,
        'MEDICAL',
        'MEDIUM',
        'MEDICAL_CONDITION',
        null,
      );
    }

    const safety: ConversationSafety = Object.freeze({
      signals: Object.freeze(signals),
      requiresSafeResponse: signals.length > 0,
      requiresProfessionalGuidance: signals.length > 0,
      medicalAdviceProhibited: true,
    });
    return Object.freeze({ safety, entities: Object.freeze(entities) });
  }

  private add(
    signals: ConversationSafetySignal[],
    entities: ConversationEntity[],
    category: ConversationSafetySignal['category'],
    severity: ConversationSafetySignal['severity'],
    signal: Extract<ConversationEntity, { kind: 'SAFETY_REPORT' }>['signal'],
    bodyArea: string | null,
  ): void {
    if (
      signals.some(
        (entry) => entry.category === category && entry.severity === severity,
      )
    ) {
      return;
    }
    signals.push(Object.freeze({ category, severity }));
    entities.push(
      Object.freeze({ kind: 'SAFETY_REPORT', signal, bodyArea, severity }),
    );
  }

  private bodyArea(text: string): string | null {
    return (
      ['joelho', 'ombro', 'costas', 'peito', 'tornozelo', 'quadril'].find(
        (area) => text.includes(area),
      ) ?? null
    );
  }
}
