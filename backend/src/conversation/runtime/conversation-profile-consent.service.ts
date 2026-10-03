import { Injectable, Optional } from '@nestjs/common';
import { ProfileAcquisitionAuthorizationService } from '../../context/profile-acquisition/profile-acquisition-authorization.service';
import { PROFILE_ACQUISITION_MODE } from '../../context/profile-acquisition/profile-acquisition.contract';
import {
  CoachProfileAcquisitionField as Field,
  CoachProfileValueSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProfileAcquisitionField } from '../../context/coach-adaptive-profile-collector.contract';
import { CoachProfileFieldRegistryService } from '../../context/profile-acquisition/coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from '../../context/profile-acquisition/profile-answer-recognizer.service';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from '../../context/profile-acquisition/coach-profile-mutation.service';
import { ProfileAcquisitionOperationalConfigService } from '../../context/profile-acquisition/profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalEligibilityService } from '../../context/profile-acquisition/profile-acquisition-internal-eligibility.service';
import { ProfileAcquisitionInternalRolloutService } from '../../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import {
  ConversationPlanReferenceService,
  type ConversationPlanReferenceInput,
} from '../understanding/conversation-plan-reference.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';

type Declaration = Readonly<{
  field: Field & ProfileAcquisitionField;
  value: string;
  casual: boolean;
}>;
export const FOOD_PREFERENCE_CONFIRMATION =
  'Você quer registrar essa preferência para os próximos planos ou usá-la apenas nesta conversa?';
const OLD_CONFIRMATION =
  'Você quer trocar esse alimento em uma refeição do plano ou registrar essa preferência para os próximos planos?';
const PROFILE_CONFIRMATION =
  'Essa informação precisa de confirmação específica no perfil. Você quer seguir por esse fluxo?';
const CLARIFY =
  'Qual preferência pessoal você quer registrar? Diga a informação e confirme que deseja mantê-la no perfil.';

/** Resolves consent to a supported profile update; all writes remain in the canonical writer. */
@Injectable()
export class ConversationProfileConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CoachProfileFieldRegistryService,
    private readonly recognizer: ProfileAnswerRecognizerService,
    private readonly factory: CoachProfileMutationCommandFactoryService,
    private readonly writer: CoachProfileMutationService,
    private readonly config: ProfileAcquisitionOperationalConfigService,
    private readonly eligibility: ProfileAcquisitionInternalEligibilityService,
    private readonly rollout: ProfileAcquisitionInternalRolloutService,
    private readonly references: ConversationPlanReferenceService,
    @Optional()
    private readonly authorization?: ProfileAcquisitionAuthorizationService,
  ) {}

  accepts(text: string): boolean {
    return this.consent(text) !== null || this.declaration(text) !== null;
  }

  async process(input: ConversationPlanReferenceInput): Promise<string | null> {
    try {
      return await this.resolve(input);
    } catch {
      return 'Não consegui confirmar o registro dessa informação com segurança. Tente novamente em instantes.';
    }
  }

  private async resolve(
    input: ConversationPlanReferenceInput,
  ): Promise<string | null> {
    const inbound = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: 'INBOUND',
        type: 'TEXT',
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
        conversation: { select: { id: true, userId: true } },
      },
    });
    if (
      !inbound ||
      inbound.id !== input.messageId ||
      inbound.conversation.userId !== input.userId ||
      inbound.conversation.id !== input.conversationId ||
      inbound.timestamp > input.referenceDate
    )
      return 'Não consegui identificar esse pedido com segurança.';
    const consent = this.consent(inbound.content);
    let declaration = this.declaration(inbound.content);
    if (
      this.config.get().mode === PROFILE_ACQUISITION_MODE.PRODUCTIVE &&
      (consent !== null || declaration !== null) &&
      !(await this.authorization?.isAllowed(input.userId))
    )
      return 'Não posso registrar essa informação no perfil pelo fluxo disponível agora.';
    if (consent === null)
      return declaration
        ? declaration.casual
          ? FOOD_PREFERENCE_CONFIRMATION
          : PROFILE_CONFIRMATION
        : null;
    if (consent !== '') declaration = this.declaration(consent);
    else {
      if (inbound.replyToExternalMessageId) return CLARIFY;
      const previous = await this.prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
          conversation: { userId: input.userId },
          direction: 'INBOUND',
          timestamp: { lt: inbound.timestamp },
        },
        select: {
          id: true,
          content: true,
          timestamp: true,
          conversation: { select: { id: true, userId: true } },
        },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: 2,
      });
      if (
        previous.some(
          (row) =>
            row.conversation.userId !== input.userId ||
            row.conversation.id !== input.conversationId ||
            row.timestamp >= inbound.timestamp ||
            row.id === input.messageId,
        )
      )
        return 'Não consegui identificar o referente com segurança.';
      const first = previous[0];
      if (
        !first ||
        inbound.timestamp.getTime() - first.timestamp.getTime() > 24 * 3600000
      )
        return CLARIFY;
      declaration = this.declaration(first.content);
      const older = previous[1] ? this.declaration(previous[1].content) : null;
      if (
        older &&
        declaration &&
        (older.field !== declaration.field || older.value !== declaration.value)
      )
        return CLARIFY;
      const assistant = await this.references.recentAssistant({
        ...input,
        referenceDate: inbound.timestamp,
        afterDate: first.timestamp,
      });
      if (
        assistant !== null &&
        ![
          FOOD_PREFERENCE_CONFIRMATION,
          OLD_CONFIRMATION,
          PROFILE_CONFIRMATION,
        ].includes(assistant)
      )
        return CLARIFY;
    }
    if (!declaration) return CLARIFY;
    const mode = this.config.get().mode;
    const allowed =
      mode === PROFILE_ACQUISITION_MODE.PRODUCTIVE
        ? !!(await this.authorization?.isAllowed(input.userId))
        : mode === PROFILE_ACQUISITION_MODE.INTERNAL &&
          (await this.eligibility.evaluate(input.userId)).eligible;
    if (!allowed)
      return 'Não posso registrar essa informação no perfil pelo fluxo disponível agora.';
    if (!declaration.casual) {
      const result = await this.rollout.requestProductiveClarification({
        userId: input.userId,
        sourceMessageId: input.messageId,
        referenceDate: inbound.timestamp,
        intent:
          declaration.field === Field.TRAINING_ENVIRONMENT ||
          declaration.field === Field.PHYSICAL_LIMITATIONS
            ? 'WORKOUT'
            : 'DIET',
        preselectedQuestion: {
          selectedProfileField: declaration.field,
          logicalTurn: 1,
        },
      });
      return result.questionCreated
        ? 'Essa informação será tratada pelo fluxo de confirmação específico do perfil.'
        : 'Essa informação precisa do fluxo de confirmação específico do perfil; não a registrei como preferência alimentar.';
    }
    const definition = this.registry.get(declaration.field);
    const answer = this.recognizer.recognize(
      {
        field: declaration.field,
        confirmationPolicy: definition.confirmationPolicy,
        reasonCode: 'MISSING_CONTEXTUAL_FIELD',
      },
      declaration.value,
    );
    if (answer.disposition !== 'RECOGNIZED') return CLARIFY;
    const command = this.factory.create({
      userId: input.userId,
      answer: { ...answer, confirmationRequired: false },
      source: CoachProfileValueSource.USER_CONFIRMED,
      referenceDate: inbound.timestamp.toISOString(),
      sourceOperationKey: `conversation-profile-consent:${input.userId}:${input.conversationId}:${input.messageId}`,
      reason: 'PROFILE_UPDATE',
    });
    if (!command) return CLARIFY;
    const result = await this.writer.execute(command);
    if (
      ['CREATED', 'UPDATED', 'UNCHANGED', 'DUPLICATE'].includes(result.status)
    )
      return declaration.field === Field.DECLARED_FOOD_REJECTIONS
        ? `Registrei no seu perfil que você não gosta de ${declaration.value}. Vou considerar isso nos próximos planos.`
        : `Registrei no seu perfil que você gosta de ${declaration.value}. Vou considerar isso nos próximos planos.`;
    if (result.status === 'CONFLICT')
      return 'Essa informação conflita com uma preferência já registrada. Qual delas está correta agora?';
    return 'Não consegui confirmar o registro dessa preferência; seu perfil não foi atualizado por este pedido.';
  }

  private fold(text: string): string {
    return new ConversationMessageNormalizerService().normalize(text).folded;
  }

  /** Only explicit permanent consent. A question about memory is not consent. */
  private consent(text: string): string | null {
    if (text.includes('?')) return null;
    const folded = this.fold(text);
    if (
      /^(?:quero que (?:voce )?lembre disso|quero que (?:voce )?lembre|pode guardar isso|salva isso no meu perfil|sim quero que (?:voce )?lembre|considere isso daqui pra frente|lembre disso)$/u.test(
        folded,
      )
    )
      return '';
    return (
      /^(?:e )?(?:quero que (?:voce )?lembre que|lembre que|salve no meu perfil que) (.+)$/u.exec(
        folded,
      )?.[1] ?? null
    );
  }

  private declaration(text: string): Declaration | null {
    if (text.includes('?')) return null;
    const folded = this.fold(text);
    if (
      /\b(?:hoje|amanha|temporariamente|talvez|acho|nao sei|essa semana|esta semana|agora|por enquanto)\b/u.test(
        folded,
      )
    )
      return null;
    const rejection =
      /^(?:eu )?nao (?:gosto de|curto) ([a-z][a-z0-9 -]{0,79})$/u.exec(folded);
    const preference =
      /^(?:eu )?gosto (?:muito )?de ([a-z][a-z0-9 -]{0,79})$/u.exec(folded);
    const candidate = rejection ?? preference;
    if (
      candidate &&
      !/\b(?:e|sou|tenho|gosto|amigo|esposa|irmao|alergia|alergico|alergica|intolerancia|medica|limitacao)\b/u.test(
        candidate[1],
      )
    )
      return Object.freeze({
        field: rejection
          ? Field.DECLARED_FOOD_REJECTIONS
          : Field.DECLARED_FOOD_PREFERENCES,
        value: candidate[1],
        casual: true,
      });
    if (/^(?:eu )?sou alergic[oa] a .+$/u.test(folded))
      return { field: Field.ALLERGIES, value: folded, casual: false };
    if (/^(?:eu )?tenho intolerancia a .+$/u.test(folded))
      return { field: Field.FOOD_INTOLERANCES, value: folded, casual: false };
    if (
      /^(?:eu )?(?:tenho uma condicao medica|tenho (?:uma )?limitacao(?: fisica)?|tenho hipertensao)\b/u.test(
        folded,
      )
    )
      return {
        field: folded.includes('limitacao')
          ? Field.PHYSICAL_LIMITATIONS
          : Field.MEDICAL_CONDITIONS,
        value: folded,
        casual: false,
      };
    if (/^(?:eu )?treino em casa$/u.test(folded))
      return {
        field: Field.TRAINING_ENVIRONMENT,
        value: 'HOME',
        casual: false,
      };
    return null;
  }
}
