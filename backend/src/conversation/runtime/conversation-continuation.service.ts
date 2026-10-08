import { ConversationContinuationStore } from './conversation-continuation.store';
import { explicitContinuationDomain } from '../understanding/explicit-continuation-domain.policy';
import { selfContainedNutritionRequest } from '../understanding/nutrition-request.policy';
import {
  effectiveNutritionRequest,
  readOnlyFollowUp,
  referentCompatibility,
} from './conversation-read-only-referent.policy';
import {
  dailyQuery,
  isDailyMealRequest,
} from '../understanding/daily-query.policy';
import { Injectable } from '@nestjs/common';
import { MessageType, ScheduledMessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import { isWorkoutCurrentPlanRead } from '../../workout/v2/workout-current-plan-read.policy';
import { ConversationCurrentNutritionContextService } from './conversation-current-nutrition-context.service';
import { ConversationContinuationSemanticsService } from './conversation-continuation-semantics.service';
import type { ContinuationInterpretation } from './conversation-continuation-semantics.service';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { evaluateConversationSafety } from '../routing/conversation-safety-routing.policy';
import { ConversationQAFollowUpContextService } from './conversation-qa-follow-up-context.service';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import {
  continuation,
  parseContinuation,
  record,
  type PendingContinuation,
  type ContinuationReply,
  type ContinuationMeal,
} from './conversation-continuation.contract';

const DAY_REQUEST: Readonly<Record<string, string>> = {
  TODAY: 'hoje',
  TOMORROW: 'amanhã',
  MONDAY: 'segunda-feira',
  TUESDAY: 'terça-feira',
  WEDNESDAY: 'quarta-feira',
  THURSDAY: 'quinta-feira',
  FRIDAY: 'sexta-feira',
  SATURDAY: 'sábado',
  SUNDAY: 'domingo',
  NEXT: 'qual meu próximo treino',
  WHOLE_PLAN: 'meu treino',
};
const SAFE_CONTEXT =
  'Pode me dizer a que mensagem você está respondendo? Ainda não tenho contexto suficiente para confirmar isso.';
@Injectable()
export class ConversationContinuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly semantics: ConversationContinuationSemanticsService,
    private readonly workout: CurrentWorkoutPlanReaderService,
    private readonly nutrition: ConversationCurrentNutritionContextService,
    private readonly boundary: ConversationPublicAnswerBoundaryService,
    private readonly safety: ConversationSafetyDetectorService,
    private readonly normalizer: ConversationMessageNormalizerService,
    private readonly qaFollowUp: ConversationQAFollowUpContextService,
    private readonly store: ConversationContinuationStore,
  ) {}
  enabled(userId: string) {
    return this.store.enabled(userId);
  }
  source(userId: string, messageId: string, type: MessageType) {
    return this.store.source(userId, messageId, type);
  }
  pending(
    userId: string,
    message: {
      conversationId: string;
      timestamp: Date;
      replyToExternalMessageId: string | null;
    },
  ) {
    return this.store.pending(userId, message);
  }
  claim(
    transaction: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
    messageId: string,
    reply: ContinuationReply,
    at: Date,
  ) {
    return this.store.claim(
      transaction,
      userId,
      conversationId,
      messageId,
      reply,
      at,
    );
  }
  bindMedia(userId: string, messageId: string) {
    return this.store.bindMedia(userId, messageId);
  }
  releaseMedia(userId: string, messageId: string) {
    return this.store.releaseMedia(userId, messageId);
  }
  completeMedia(
    transaction: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
    messageId: string,
    reply: ContinuationReply,
  ) {
    return this.store.completeMedia(
      transaction,
      userId,
      conversationId,
      messageId,
      reply,
    );
  }
  async resolve(
    userId: string,
    messageId: string,
  ): Promise<ContinuationReply | null> {
    const fallback = this.publicReply({
      content: SAFE_CONTEXT,
      domain: 'GENERAL',
      pending: null,
      next: null,
      outcome: 'UNKNOWN',
      evidence: {},
    });
    const result = await this.store.resolveOnce(
      userId,
      messageId,
      MessageType.TEXT,
      () => this.resolveUncached(userId, messageId),
      fallback,
    );
    return result ? this.publicReply(result) : null;
  }
  publicText(content: string, structured = false): string {
    const projected = structured
      ? this.boundary.projectStructuredText(content)
      : this.boundary.projectText(content);
    return projected ?? this.boundary.projectText(SAFE_CONTEXT)!;
  }
  private publicReply(reply: ContinuationReply): ContinuationReply {
    const content =
      reply.domain === 'WORKOUT'
        ? this.boundary.projectStructuredText(reply.content)
        : this.boundary.projectText(reply.content);
    if (!content)
      if (
        reply.evidence.workoutEffect === 'GENERATE' ||
        reply.evidence.workoutEffect === 'UPDATE'
      )
        return { ...reply, content: '' };
    if (!content)
      return {
        content: this.publicText(SAFE_CONTEXT),
        domain: 'GENERAL',
        next: null,
        pending: null,
        outcome: 'UNKNOWN',
        evidence: {},
      };
    return { ...reply, content };
  }
  private async resolveUncached(
    userId: string,
    messageId: string,
  ): Promise<ContinuationReply | null> {
    if (!this.enabled(userId)) return null;
    const message = await this.source(userId, messageId, MessageType.TEXT);
    if (!message) return null;
    const safety = evaluateConversationSafety(
      this.safety.detect(this.normalizer.normalize(message.content)).safety,
    );
    if (safety.routeRequired)
      return {
        content:
          safety.action === 'URGENT_GUIDANCE'
            ? 'Interrompa a atividade e procure atendimento médico urgente. Se houver risco imediato, peça ajuda agora.'
            : 'Respeite o desconforto e procure orientação profissional antes de continuar. Não force a atividade.',
        domain: 'GENERAL',
        pending: null,
        next: null,
        outcome: 'UNKNOWN',
        evidence: { safetyAction: safety.action },
      };
    // Explicit daily reads belong to their canonical reader, not reminder replies.
    if (isDailyMealRequest(message.content) || dailyQuery(message.content))
      return null;
    if (selfContainedNutritionRequest(message.content)) return null;
    const followUp = readOnlyFollowUp(message.content);
    if (followUp) {
      const lookup = {
        userId,
        conversationId: message.conversationId,
        messageId,
      };
      if (await this.qaFollowUp.hasBlockingLifecycle(lookup, message.timestamp))
        return null;
      if (
        followUp.currentTurn.domain === 'WORKOUT' ||
        followUp.currentTurn.domain === 'COMBINED'
      )
        return null;
      const referent = await this.qaFollowUp.findReferent(lookup);
      if (
        referent &&
        referentCompatibility(followUp.currentTurn, referent) !== 'COMPATIBLE'
      )
        return null;
      if (referent && effectiveNutritionRequest(followUp, referent))
        return {
          content: SAFE_CONTEXT,
          domain: 'GENERAL',
          pending: null,
          next: null,
          outcome: 'UNKNOWN',
          evidence: { delegateRuntime: true },
        };
    }
    const explicitDomain = explicitContinuationDomain(message.content);
    let pending = await this.pending(userId, message);
    if (
      pending &&
      explicitDomain &&
      explicitDomain !== pending.continuation.domain &&
      !message.replyToExternalMessageId
    ) {
      // Workout reads use this service's owned reader, but never the old pending.
      if (
        explicitDomain !== 'WORKOUT' ||
        !isWorkoutCurrentPlanRead(message.content)
      )
        return null;
      pending = null;
    }
    const interpreted = await this.semantics.interpret(
      message.content,
      pending,
    );
    const safe = (): ContinuationReply => ({
      content: SAFE_CONTEXT,
      domain: 'GENERAL',
      next: null,
      pending: null,
      outcome: 'UNKNOWN',
      evidence: {},
    });
    // A canonical turn never re-enters the proactive regex classifier on uncertainty.
    if (
      !message.replyToExternalMessageId &&
      interpreted?.action !== 'WORKOUT_QUERY'
    ) {
      const profile = await this.prisma.coachProfileAcquisitionCycle.findFirst({
        where: {
          userId,
          active: true,
          askedAt: { not: null },
          expiresAt: { gt: message.timestamp },
          status: { in: ['ASKED', 'CONFIRMATION_PENDING'] },
        },
        select: { id: true },
      });
      if (profile) return null;
    }
    if (
      !pending &&
      (!interpreted || interpreted.action === 'UNRESOLVED') &&
      (await this.qaFollowUp.findPending({
        userId,
        conversationId: message.conversationId,
        messageId,
      }))
    )
      return { ...safe(), evidence: { delegateRuntime: true } };
    if (!interpreted) return safe();
    if (interpreted.workoutEffect && interpreted.workoutEffect !== 'NONE') {
      return {
        ...safe(),
        content: interpreted.response ?? '',
        pending:
          (interpreted.action === 'HYDRATION_REPLY' &&
            pending?.continuation.domain === 'HYDRATION') ||
          (interpreted.action === 'WORKOUT_REPLY' &&
            pending?.continuation.domain === 'WORKOUT')
            ? pending
            : null,
        outcome:
          interpreted.consumption === 'CONFIRMED' ? 'COMPLETED' : 'UNKNOWN',
        evidence: {
          workoutEffect: interpreted.workoutEffect,
          workoutRequestQuote: interpreted.workoutRequestQuote ?? null,
          consumption: interpreted.consumption,
        },
      };
    }
    // Interpretation selects a capability; it cannot answer independent guidance
    // with only text/pending. Keep genuinely referential reminder replies below.
    if (
      interpreted.workoutEffect === 'NONE' &&
      (interpreted.action === 'INDEPENDENT' ||
        ((interpreted.reference !== 'PENDING' || !pending) &&
          this.normalizer.normalize(message.content).question &&
          (interpreted.action === 'HYDRATION_REPLY' ||
            interpreted.action === 'WORKOUT_REPLY')))
    )
      return {
        ...safe(),
        evidence: { delegateRuntime: true, workoutEffect: 'NONE' },
      };
    if (
      interpreted.workoutEffect === 'NONE' &&
      interpreted.response &&
      (interpreted.action === 'HYDRATION_REPLY' ||
        interpreted.action === 'WORKOUT_REPLY')
    ) {
      const domain = pending?.continuation.domain ?? 'GENERAL';
      return {
        content: interpreted.response,
        domain,
        pending,
        next: null,
        outcome:
          interpreted.consumption === 'CONFIRMED' ? 'COMPLETED' : 'UNKNOWN',
        evidence: {
          workoutEffect: 'NONE',
          consumption: interpreted.consumption,
          hydrationGoal: false,
        },
      };
    }
    if (interpreted.action === 'DECLINE')
      return {
        ...safe(),
        content: 'Tudo bem, podemos deixar esse assunto de lado.',
        pending,
        evidence: { declined: true },
      };
    if (interpreted.action === 'INDEPENDENT')
      return interpreted.workoutEffect === 'NONE'
        ? {
            ...safe(),
            evidence: { delegateRuntime: true, workoutEffect: 'NONE' },
          }
        : isWorkoutCurrentPlanRead(message.content)
          ? safe()
          : null;
    if (interpreted.action === 'UNRESOLVED') return safe();
    if (
      interpreted.reference === 'UNRESOLVED' ||
      (interpreted.reference === 'PENDING' && !pending)
    )
      return safe();
    if (interpreted.action === 'WORKOUT_QUERY') {
      if (
        interpreted.reference === 'PENDING' &&
        pending?.continuation.kind !== 'WORKOUT_DAY_QUERY'
      )
        return safe();
      const request = DAY_REQUEST[interpreted.day];
      if (!request) return safe();
      const presentation = await this.workout.presentCanonicalDay(
        userId,
        request,
        message.timestamp,
        interpreted.day === 'NEXT' && interpreted.reference === 'PENDING'
          ? pending?.continuation.resolvedLocalDate
          : undefined,
      );
      return {
        content: presentation.content,
        domain: 'WORKOUT',
        next: continuation(
          'WORKOUT_DAY_QUERY',
          message.timestamp,
          'UNKNOWN',
          'USER_QUERY',
          presentation.resolvedLocalDate,
        ),
        pending:
          pending?.continuation.kind === 'WORKOUT_DAY_QUERY' ? pending : null,
        outcome: 'UNKNOWN',
        evidence: { day: interpreted.day },
      };
    }
    const domain =
      interpreted.action === 'WORKOUT_REPLY'
        ? 'WORKOUT'
        : interpreted.action === 'HYDRATION_REPLY'
          ? 'HYDRATION'
          : 'NUTRITION';
    if (
      !pending &&
      interpreted.reference === 'EXPLICIT' &&
      domain === 'NUTRITION' &&
      interpreted.description
    )
      return this.mealReply(
        userId,
        interpreted.description,
        interpreted.meal,
        message.timestamp,
        null,
        false,
        message.conversation.user?.preferences?.timezone,
        interpreted.consumption,
      );
    if (
      (!pending &&
        !(
          domain === 'WORKOUT' &&
          interpreted.reference === 'EXPLICIT' &&
          interpreted.consumption === 'CONFIRMED'
        )) ||
      (pending && pending.continuation.domain !== domain)
    )
      return safe();
    if (pending?.continuation.kind === 'WORKOUT_FEEDBACK')
      return { ...safe(), pending, evidence: { delegateRuntime: true } };
    if (
      domain === 'WORKOUT' &&
      pending &&
      pending.continuation.kind !== 'WORKOUT_COMPLETION_CHECK'
    )
      return safe();
    const meal =
      !pending || pending.continuation.meal === 'UNKNOWN'
        ? interpreted.meal
        : pending.continuation.meal;
    if (domain === 'NUTRITION') {
      if (interpreted.description)
        return this.mealReply(
          userId,
          [pending?.reportedContent, interpreted.description]
            .filter(Boolean)
            .join('; '),
          meal,
          message.timestamp,
          pending,
          pending?.reportedContentEstimated === true,
          message.conversation.user?.preferences?.timezone,
          interpreted.consumption,
        );
      const content =
        interpreted.consumption === 'NOT_YET'
          ? 'Tudo bem. Quando fizer a refeição, me conte o que comeu.'
          : interpreted.consumption === 'PLANNED'
            ? 'Combinado. Quando comer, me conte o que teve na refeição.'
            : `O que você comeu${meal === 'LUNCH' ? ' no almoço' : meal === 'DINNER' ? ' no jantar' : ''}?`;
      return {
        content,
        domain,
        next: continuation('MEAL_CONTENT_REQUEST', message.timestamp, meal),
        pending,
        outcome:
          interpreted.consumption === 'CONFIRMED' ? 'COMPLETED' : 'UNKNOWN',
        evidence: {
          consumption: interpreted.consumption,
          contentKnown: false,
          adherence: 'INSUFFICIENT_INFORMATION',
        },
      };
    }
    const outcome =
      interpreted.consumption === 'CONFIRMED'
        ? 'COMPLETED'
        : interpreted.consumption === 'NOT_YET'
          ? 'SKIPPED'
          : interpreted.consumption === 'PLANNED'
            ? 'DEFERRED'
            : 'UNKNOWN';
    const content =
      domain === 'HYDRATION'
        ? interpreted.hydrationGoal && outcome === 'COMPLETED'
          ? 'Boa! Você confirmou sua meta de hidratação. Continue distribuindo a água ao longo do dia 💧'
          : outcome === 'COMPLETED'
            ? 'Boa! Continue bebendo água aos poucos ao longo do dia 💧'
            : 'Quando puder, retome a hidratação aos poucos, sem tentar compensar tudo de uma vez.'
        : outcome === 'COMPLETED'
          ? 'Boa! Como ficou sua energia depois do treino?'
          : outcome === 'DEFERRED'
            ? 'Combinado. Quando terminar o treino, me conte como foi.'
            : outcome === 'SKIPPED'
              ? 'Tudo bem. Retome quando couber na sua rotina, sem tentar compensar.'
              : 'Como ficou seu treino?';
    return {
      content,
      domain,
      pending,
      next:
        domain === 'WORKOUT'
          ? continuation(
              outcome === 'COMPLETED'
                ? 'WORKOUT_FEEDBACK'
                : 'WORKOUT_COMPLETION_CHECK',
              message.timestamp,
            )
          : null,
      outcome,
      evidence: {
        consumption: interpreted.consumption,
        hydrationGoal:
          domain === 'HYDRATION' &&
          interpreted.hydrationGoal &&
          outcome === 'COMPLETED',
      },
    };
  }
  private async mealReply(
    userId: string,
    description: string,
    meal: ContinuationMeal,
    at: Date,
    pending: PendingContinuation | null,
    estimated: boolean,
    timezoneValue?: string | null,
    consumption: ContinuationInterpretation['consumption'] = 'UNKNOWN',
  ): Promise<ContinuationReply> {
    if (!estimated && consumption !== 'CONFIRMED')
      return {
        content:
          consumption === 'PLANNED'
            ? 'Entendi o que você pretende comer. Quando fizer a refeição, me conte como foi.'
            : 'Esses são os alimentos que você já comeu ou está pensando em comer?',
        domain: 'NUTRITION',
        pending,
        next: continuation('MEAL_CONTENT_REQUEST', at, meal),
        outcome: consumption === 'PLANNED' ? 'DEFERRED' : 'UNKNOWN',
        evidence: {
          consumption,
          contentKnown: true,
          estimated,
          adherence: 'INSUFFICIENT_INFORMATION',
          reportedContent: description,
        },
      };
    const current = await this.nutrition.read(userId);
    const clock = new CoachProactiveSchedulePolicy();
    const timezone = clock.timezone(timezoneValue);
    const local = clock.parts(at, timezone);
    const result =
      current.status === 'AVAILABLE'
        ? await this.semantics.evaluate(
            description,
            meal,
            {
              localDate: { ...local },
              weekday: new Intl.DateTimeFormat('pt-BR', {
                weekday: 'long',
                timeZone: timezone,
              }).format(at),
              days: current.plan.days.map((day) => ({
                label: day.label ?? null,
                meals: day.meals.map((m) => ({
                  name: m.name,
                  time: m.time ?? null,
                  items: m.items.map((item) => ({ ...item })),
                })),
              })),
              substitutions: current.plan.substitutions.map((s) => ({ ...s })),
            },
            estimated,
          )
        : null;
    const content =
      result?.content ??
      (current.status === 'AVAILABLE'
        ? 'Recebi seu relato, mas não consegui comparar a refeição com o plano agora. Não precisa reenviar os alimentos ou as quantidades.'
        : 'Não encontrei um plano alimentar ativo disponível para comparar essa refeição. Não vou presumir o que ele contém.');
    const adherence = result?.adherence ?? 'INSUFFICIENT_INFORMATION';
    return {
      content: this.boundary.projectText(content) ?? SAFE_CONTEXT,
      domain: 'NUTRITION',
      pending,
      next:
        current.status === 'AVAILABLE' &&
        result?.report?.status === 'MISSING_QUANTITIES'
          ? continuation('MEAL_CONTENT_REQUEST', at, meal)
          : null,
      outcome: consumption === 'CONFIRMED' ? 'COMPLETED' : 'UNKNOWN',
      evidence: {
        consumption,
        contentKnown: true,
        estimated,
        adherence,
        mealReportStatus: result?.report?.status ?? 'UNKNOWN',
        mealComparisonStatus:
          result?.comparison ??
          (current.status === 'AVAILABLE'
            ? 'TECHNICAL_FAILURE'
            : 'PLAN_UNAVAILABLE'),
        missingQuantityFoods: result?.report?.missingQuantityFoods
          ? [...result.report.missingQuantityFoods]
          : [],
        reportedContent: description,
      },
    };
  }
  async mediaReply(
    userId: string,
    messageId: string,
    description: string,
  ): Promise<ContinuationReply | null> {
    const fallback = this.publicReply({
      content:
        'Não consegui comparar essa imagem com segurança. Pode me contar o que teve na refeição?',
      domain: 'NUTRITION',
      next: null,
      pending: null,
      outcome: 'UNKNOWN',
      evidence: { estimated: true, consumption: 'UNKNOWN' },
    });
    const result = await this.store.resolveOnce(
      userId,
      messageId,
      MessageType.IMAGE,
      () => this.mediaReplyUncached(userId, messageId, description),
      fallback,
    );
    return result ? this.publicReply(result) : null;
  }
  private async mediaReplyUncached(
    userId: string,
    messageId: string,
    description: string,
  ): Promise<ContinuationReply | null> {
    if (!this.enabled(userId)) return null;
    const message = await this.source(userId, messageId, MessageType.IMAGE);
    if (!message) return null;
    const source = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId,
        conversationId: message.conversationId,
        responseMessageId: messageId,
        status: ScheduledMessageStatus.SENT,
      },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        context: true,
        content: true,
      },
    });
    if (
      !source ||
      source.userId !== userId ||
      source.conversationId !== message.conversationId ||
      !record(source.context)
    )
      return null;
    if (
      (source.context.mediaReceiptState !== 'BOUND' &&
        source.context.mediaReceiptState !== 'COMPLETE') ||
      source.context.mediaReceiptMessageId !== messageId
    )
      return null;
    const parsed = parseContinuation(
      source.context.mediaContinuation,
      message.timestamp,
    );
    if (!parsed || parsed.domain !== 'NUTRITION') return null;
    const cached = source.context.mediaReply;
    if (
      record(cached) &&
      typeof cached.content === 'string' &&
      record(cached.evidence)
    ) {
      const content = this.boundary.projectText(cached.content);
      if (content)
        return {
          content,
          domain: 'NUTRITION',
          next: parseContinuation(cached.next, message.timestamp),
          pending: {
            scheduledMessageId: source.id,
            question: source.content,
            continuation: parsed,
          },
          outcome: 'UNKNOWN',
          evidence: cached.evidence as Prisma.InputJsonObject,
        };
    }
    return this.mealReply(
      userId,
      description,
      parsed.meal,
      message.timestamp,
      {
        scheduledMessageId: source.id,
        question: source.content,
        continuation: parsed,
      },
      true,
      message.conversation.user?.preferences?.timezone,
    );
  }
}
