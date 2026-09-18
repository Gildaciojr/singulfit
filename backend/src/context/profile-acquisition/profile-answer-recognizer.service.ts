import { isWorkoutCurrentPlanRead } from '../../workout/v2/workout-current-plan-read.policy';
import { isNutritionCurrentPlanRead } from '../../diet/nutrition-current-plan-read.policy';
import { isFullPlanReplacementRequest } from '../../conversation/understanding/full-plan-replacement.policy';
import type { ContextualProfileConfirmation } from './profile-acquisition.contract';
import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileValueType,
} from '@prisma/client';
import {
  ProfileQuestionSpecification,
  RecognizedProfileAnswer,
  RecognizedProfileConfirmation,
  RecognizedProfileValue,
} from './profile-acquisition.contract';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';

@Injectable()
export class ProfileAnswerRecognizerService {
  constructor(private readonly registry: CoachProfileFieldRegistryService) {}

  recognize(
    specification: Pick<
      ProfileQuestionSpecification,
      'field' | 'confirmationPolicy' | 'reasonCode'
    >,
    rawAnswer: string,
  ): RecognizedProfileAnswer {
    const answer = rawAnswer
      .trim()
      .replace(/[.!?]+$/u, '')
      .trim();
    const normalized = this.normalize(answer);
    const definition = this.registry.get(specification.field);

    if (!answer) return this.result(specification, 'INVALID', 'EMPTY_ANSWER');
    if (
      /^(nao quero responder|prefiro nao dizer|nao quero dizer|passo)$/u.test(
        normalized,
      )
    ) {
      return this.result(specification, 'DECLINED', 'USER_DECLINED');
    }
    if (/^(depois|mais tarde|depois vejo|agora nao)$/u.test(normalized)) {
      return this.result(specification, 'DEFERRED', 'USER_DEFERRED');
    }
    if (/^(nao sei|nao tenho certeza|nao lembro)$/u.test(normalized)) {
      return this.result(specification, 'UNKNOWN', 'USER_DOES_NOT_KNOW');
    }

    if (this.isIndependentCommand(answer))
      return this.result(specification, 'UNRELATED', 'NOT_APPLICABLE');
    if (this.ambiguous(normalized))
      return this.result(specification, 'UNKNOWN', 'AMBIGUOUS_ANSWER');
    const correction = this.correctionBody(answer);
    const value = this.value(
      specification.field,
      this.normalize(correction ?? answer),
      correction ?? answer,
    );
    if (value === undefined) {
      return this.result(specification, 'UNRELATED', 'NO_DETERMINISTIC_MATCH');
    }
    if (!this.valid(value, definition.valueType, definition.allowedOptions)) {
      return this.result(specification, 'INVALID', 'VALUE_OUTSIDE_REGISTRY');
    }
    if (
      typeof value === 'number' &&
      ((definition.minimum !== undefined && value < definition.minimum) ||
        (definition.maximum !== undefined && value > definition.maximum))
    ) {
      return this.result(specification, 'INVALID', 'VALUE_OUT_OF_RANGE');
    }

    return Object.freeze({
      field: specification.field,
      disposition: 'RECOGNIZED',
      valueType: definition.valueType,
      value: Array.isArray(value) ? Object.freeze([...value]) : value,
      confidence: 'DETERMINISTIC',
      reasonCode: 'DETERMINISTIC_MATCH',
      confirmationRequired:
        specification.confirmationPolicy === 'EXPLICIT' ||
        specification.confirmationPolicy === 'ALWAYS_EXPLICIT' ||
        specification.reasonCode === 'CONFIRMATION_REQUIRED' ||
        specification.reasonCode === 'CONFLICT_RESOLUTION',
    });
  }

  recognizeConfirmation(rawAnswer: string): RecognizedProfileConfirmation {
    const normalized = this.normalize(rawAnswer.trim())
      .replace(/[.!?]+$/u, '')
      .trim();

    if (!normalized) {
      return this.confirmation('INVALID', 'EMPTY_CONFIRMATION');
    }
    if (
      /^(sim(?:,? (?:pode salvar|pode registrar))?|confirmo|confirmado|pode(?: salvar(?: assim)?| registrar| confirmar)?|esta certo|correto|isso(?: mesmo)?|exato|e isso)$/u.test(
        normalized,
      )
    ) {
      return this.confirmation('CONFIRMED', 'USER_CONFIRMED_VALUE');
    }
    if (
      /^(nao|nao confirmo|esta errado|incorreto|quero corrigir|corrigir)$/u.test(
        normalized,
      )
    ) {
      return this.confirmation('REJECTED', 'USER_REJECTED_VALUE');
    }
    if (/^(depois|mais tarde|agora nao)$/u.test(normalized)) {
      return this.confirmation('DEFERRED', 'USER_DEFERRED_CONFIRMATION');
    }

    return this.confirmation('UNRELATED', 'NO_DETERMINISTIC_CONFIRMATION');
  }

  recognizeContextualConfirmation(
    field: CoachProfileAcquisitionField,
    rawAnswer: string,
  ): ContextualProfileConfirmation {
    if (this.isIndependentCommand(rawAnswer)) {
      return Object.freeze({ disposition: 'NOT_APPLICABLE' });
    }
    const simple = this.recognizeConfirmation(rawAnswer);
    if (simple.disposition !== 'UNRELATED') return simple;
    const text = rawAnswer
      .trim()
      .replace(/[.!?]+$/u, '')
      .trim();
    if (this.ambiguous(this.normalize(text))) return simple;
    const correction = this.correctionBody(text);
    const positive =
      /^(?:sim|pode(?: salvar(?: assim)?| registrar| confirmar)?|isso mesmo|correto|confirmo)[,.:!\s]+(.+)$/iu.exec(
        text,
      );
    const declaration = correction ?? positive?.[1] ?? text;
    if (
      !correction &&
      !this.sensitiveDeclaration(field, this.normalize(declaration))
    )
      return simple;
    const definition = this.registry.get(field);
    const answer = this.recognize(
      {
        field,
        confirmationPolicy: definition.confirmationPolicy,
        reasonCode: 'MISSING_CONTEXTUAL_FIELD',
      },
      declaration,
    );
    if (answer.disposition !== 'RECOGNIZED' || answer.value === undefined)
      return simple;
    return Object.freeze({
      disposition:
        positive && !correction ? 'CONFIRMED_VALUE' : 'CORRECTED_VALUE',
      value: answer.value,
    });
  }

  isIndependentCommand(text: string): boolean {
    return (
      isWorkoutCurrentPlanRead(text) ||
      isNutritionCurrentPlanRead(text) ||
      isFullPlanReplacementRequest(this.normalize(text))
    );
  }

  private ambiguous(text: string): boolean {
    return /\b(?:talvez|acho|nao sei|nao tenho certeza|provavelmente|pode ser)\b/u.test(
      text,
    );
  }

  private correctionBody(text: string): string | undefined {
    return /^(?:n[aã]o(?:[,.:!]\s*(?:na verdade\s+)?|\s+na verdade\s+)|na verdade[,:\s]+|corrigindo[,:\s]+)(.+)$/iu
      .exec(text)?.[1]
      ?.trim();
  }

  private sensitiveNoun(
    field: CoachProfileAcquisitionField,
  ): string | undefined {
    switch (field) {
      case CoachProfileAcquisitionField.ALLERGIES:
        return 'alergias?(?: alimentares?| alimentar)?';
      case CoachProfileAcquisitionField.FOOD_INTOLERANCES:
        return 'intolerancias?(?: alimentares?| alimentar)?';
      case CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS:
        return '(?:limitacoes(?: fisicas)?|limitacao(?: fisica)?|lesoes|lesao|problema(?: fisico)?)';
      case CoachProfileAcquisitionField.MEDICAL_CONDITIONS:
        return '(?:condicoes(?: medicas| de saude)?|condicao(?: medica| de saude)?|doencas?)';
      default:
        return undefined;
    }
  }

  private sensitiveDeclaration(
    field: CoachProfileAcquisitionField,
    normalized: string,
  ): boolean {
    const noun = this.sensitiveNoun(field);
    return (
      noun !== undefined &&
      new RegExp(
        '^(?:eu )?(?:(?:nao (?:tenho|possuo)(?: nenhuma?)?|tenho|possuo) )?(?:' +
          noun +
          ')\\b',
        'u',
      ).test(normalized)
    );
  }

  private sensitiveList(
    field: CoachProfileAcquisitionField,
    original: string,
  ): readonly string[] | undefined {
    const text = original
      .trim()
      .replace(/[.!?]+$/u, '')
      .trim();
    const normalized = this.normalize(text);
    const noun = this.sensitiveNoun(field);
    if (!noun) return undefined;
    const absence = new RegExp(
      '^(?:eu )?(?:nao|nada|nenhuma?|nao (?:tenho|possuo)(?: nenhuma?)?)(?: ' +
        noun +
        ')?$',
      'u',
    );
    if (absence.test(normalized)) return Object.freeze([]);
    if (
      this.registry
        .all()
        .some(
          (definition) =>
            definition.field !== field &&
            this.sensitiveDeclaration(definition.field, normalized),
        )
    )
      return undefined;
    if (
      /^(?:eu )?nao\b/u.test(normalized) ||
      this.ambiguous(normalized) ||
      /^(?:sim|tenho|possuo|claro|correto)$/u.test(normalized)
    )
      return undefined;
    let names = text.replace(/^(?:eu\s+)?(?:tenho|possuo)\s+/iu, '');
    if (field === CoachProfileAcquisitionField.ALLERGIES)
      names = names.replace(
        /^alergias?(?:\s+alimentar(?:es)?)?\s+(?:a|ao|aos|à)\s+/iu,
        '',
      );
    if (field === CoachProfileAcquisitionField.FOOD_INTOLERANCES) {
      names = names.replace(
        /^(?:(?:eu\s+)?(?:tenho|possuo)\s+)?intoler[aâ]ncia(?:s)?(?:\s+alimentar(?:es)?)?\s+(?:a|ao|aos|à)\s+/iu,
        '',
      );
      return this.textList(names)?.map((item) => {
        const normalizedItem = this.normalize(item);
        return normalizedItem === 'lactose'
          ? 'LACTOSE'
          : normalizedItem === 'gluten'
            ? 'GLUTEN'
            : item;
      });
    }
    return this.textList(names);
  }

  private value(
    field: CoachProfileAcquisitionField,
    normalized: string,
    original: string,
  ): RecognizedProfileValue | undefined {
    const definition = this.registry.get(field);
    if (
      definition.valueType === CoachProfileValueType.TEXT &&
      definition.allowedOptions.includes(original.toUpperCase())
    )
      return original.toUpperCase();
    if (
      definition.valueType === CoachProfileValueType.TEXT_LIST &&
      definition.allowedOptions.length > 0
    ) {
      const codes = original
        .split(/[,;]|\s+e\s+/iu)
        .map((item) => item.trim().toUpperCase());
      if (codes.every((code) => definition.allowedOptions.includes(code)))
        return Object.freeze([...new Set(codes)]);
    }
    switch (field) {
      case CoachProfileAcquisitionField.TRAINING_MODALITY:
        return this.first(normalized, [
          ['GYM_STRENGTH', /academia|musculacao/],
          ['HOME_WORKOUT', /casa|home/],
          ['RUNNING', /corrida|correr/],
          ['CYCLING', /bike|bicicleta|ciclismo/],
          ['CROSSFIT', /crossfit|box/],
          ['WALKING', /caminhada|caminhar/],
          ['GENERAL_FITNESS', /funcional|condicionamento geral/],
        ]);
      case CoachProfileAcquisitionField.TRAINING_EXPERIENCE:
        return this.first(normalized, [
          ['BEGINNER', /iniciante|comecando|nunca treinei/],
          ['INTERMEDIATE', /intermediari/],
          ['ADVANCED', /avancad/],
        ]);
      case CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS:
        return this.sensitiveList(field, original);
      case CoachProfileAcquisitionField.WEEKLY_FREQUENCY:
        return this.integer(
          normalized,
          '(?:vezes?|dias?)(?: (?:por|na|pela) semana)?',
        );
      case CoachProfileAcquisitionField.DESIRED_MEAL_COUNT:
        return this.integer(normalized, 'refeicoes?(?: (?:por|ao) dia)?');
      case CoachProfileAcquisitionField.SESSION_DURATION_MINUTES:
        return this.duration(normalized);
      case CoachProfileAcquisitionField.TRAINING_ENVIRONMENT:
        return this.first(normalized, [
          ['CROSSFIT_BOX', /box|crossfit/],
          ['FULL_GYM', /academia (?:comum|completa)/],
          ['LIMITED_GYM', /academia pequena|academia limitada/],
          ['HOME', /casa|home/],
          ['TRACK', /pista/],
          ['TRAIL', /trilha/],
          ['ROAD', /estrada|rua/],
          ['OUTDOOR', /ar livre|parque/],
          ['INDOOR', /indoor|fechado/],
        ]);
      case CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT:
        return this.equipment(normalized);
      case CoachProfileAcquisitionField.PERCEIVED_CONDITIONING:
        return this.first(normalized, [
          ['LOW', /baixo|ruim|fraco/],
          ['MODERATE', /moderado|medio|razoavel/],
          ['HIGH', /alto|bom|otimo/],
        ]);
      case CoachProfileAcquisitionField.PREFERRED_INTENSITY:
        return this.first(normalized, [
          ['LIGHT', /leve/],
          ['MODERATE', /moderad/],
          ['HIGH', /intens|alta|forte/],
        ]);
      case CoachProfileAcquisitionField.CARDIO_AVAILABILITY:
      case CoachProfileAcquisitionField.RETURNING_AFTER_BREAK:
        return this.boolean(normalized);
      case CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE:
        return this.first(normalized, [
          ['INDIVIDUAL', /sozinh|individual/],
          ['GROUP', /grupo|coletiv/],
          ['FLEXIBLE', /tanto faz|flexivel|qualquer/],
        ]);
      case CoachProfileAcquisitionField.EATING_PATTERN:
        return this.first(normalized, [
          ['VEGAN', /vegan/],
          ['VEGETARIAN', /vegetarian/],
          ['PESCATARIAN', /pescetarian|pescatarian/],
          ['FLEXITARIAN', /flexitarian/],
          ['OMNIVORE', /onivor|como de tudo/],
        ]);
      case CoachProfileAcquisitionField.FOOD_INTOLERANCES:
      case CoachProfileAcquisitionField.ALLERGIES:
      case CoachProfileAcquisitionField.MEDICAL_CONDITIONS:
        return this.sensitiveList(field, original);
      case CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES:
      case CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS:
        return this.textList(original);
      case CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL:
        return this.first(normalized, [
          ['LOW', /baixo|econom|barat/],
          ['MODERATE', /moderad|medio/],
          ['FLEXIBLE', /flexivel|sem limite|tranquilo/],
          ['NOT_INFORMED', /nao informar|prefiro nao/],
        ]);
      case CoachProfileAcquisitionField.COOKING_AVAILABILITY:
        return this.first(normalized, [
          ['NONE', /nenhum|nao cozinho|sem tempo/],
          ['LOW', /pouco|baixa/],
          ['MODERATE', /moderad|medio/],
          ['HIGH', /bastante|alta|cozinho todo dia/],
        ]);
      case CoachProfileAcquisitionField.EATING_OUT_FREQUENCY:
        return this.first(normalized, [
          ['RARELY', /raramente|quase nunca/],
          ['SOMETIMES', /as vezes|algumas vezes/],
          ['FREQUENTLY', /frequentemente|muitas vezes/],
          ['MOST_MEALS', /maioria|quase todas|todo dia/],
        ]);
      case CoachProfileAcquisitionField.REPORTED_HYDRATION:
        return this.first(normalized, [
          ['LOW', /baixa|pouca|bebo pouco/],
          ['ADEQUATE', /adequada|boa|suficiente/],
          ['HIGH', /alta|muita|bebo bastante/],
          ['NOT_INFORMED', /nao informar/],
        ]);
      case CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION:
        if (this.explicitNone(normalized)) return Object.freeze([]);
        return this.textList(original);
      case CoachProfileAcquisitionField.MEAL_TIMES:
        return this.times(normalized);
      case CoachProfileAcquisitionField.TRAINING_TIME:
        return this.times(normalized)[0];
      case CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS:
        return this.weekdays(normalized);
      case CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS:
        return this.textList(original);
      case CoachProfileAcquisitionField.TARGET_DISTANCE:
      case CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE:
        return this.distanceMeters(normalized);
    }
  }

  private distanceMeters(value: string): number | undefined {
    const match = value.match(
      /(?:^|\s)(\d+(?:[,.]\d+)?)\s*(km|quilometros?|kilometros?|m|metros?)(?:\s|$)/u,
    );
    if (!match) return undefined;
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const meters =
      match[2] === 'km' ||
      match[2].startsWith('kilo') ||
      match[2].startsWith('quilo')
        ? amount * 1000
        : amount;
    return Number.isInteger(meters) ? meters : undefined;
  }

  private valid(
    value: RecognizedProfileValue,
    valueType: CoachProfileValueType,
    options: readonly string[],
  ): boolean {
    if (valueType === CoachProfileValueType.INTEGER) {
      return typeof value === 'number' && Number.isInteger(value);
    }
    if (valueType === CoachProfileValueType.BOOLEAN) {
      return typeof value === 'boolean';
    }
    if (valueType === CoachProfileValueType.TEXT_LIST) {
      return (
        Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === 'string' &&
            item.length > 0 &&
            (options.length === 0 || options.includes(item)),
        )
      );
    }
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      (options.length === 0 || options.includes(value))
    );
  }

  private result(
    specification: Pick<
      ProfileQuestionSpecification,
      'field' | 'confirmationPolicy' | 'reasonCode'
    >,
    disposition: RecognizedProfileAnswer['disposition'],
    reasonCode: string,
  ): RecognizedProfileAnswer {
    return Object.freeze({
      field: specification.field,
      disposition,
      valueType: this.registry.get(specification.field).valueType,
      confidence: 'DETERMINISTIC',
      reasonCode,
      confirmationRequired: false,
    });
  }

  private confirmation(
    disposition: RecognizedProfileConfirmation['disposition'],
    reasonCode: string,
  ): RecognizedProfileConfirmation {
    return Object.freeze({
      disposition,
      confidence: 'DETERMINISTIC',
      reasonCode,
    });
  }

  private first(
    value: string,
    options: readonly (readonly [string, RegExp])[],
  ): string | undefined {
    return options.find((option) => option[1].test(value))?.[0];
  }

  private integer(value: string, unit = 'minutos?'): number | undefined {
    const words: Readonly<Record<string, number>> = {
      uma: 1,
      um: 1,
      duas: 2,
      dois: 2,
      tres: 3,
      quatro: 4,
      cinco: 5,
      seis: 6,
      sete: 7,
      oito: 8,
    };
    const pattern = new RegExp(
      '^(?:(?:eu )?(?:treino|consigo treinar|sao|faco|como) )?(-?\\d+|uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito)(?: ' +
        unit +
        ')?$',
      'u',
    );
    const match = pattern.exec(value);
    if (!match) return undefined;
    return words[match[1]] ?? Number(match[1]);
  }

  private duration(value: string): number | undefined {
    const hours =
      /^(?:(?:sao|tenho) )?(\d+(?:[.,]\d+)?|uma|um)\s*(?:hora|horas|h)$/u.exec(
        value,
      );
    if (hours)
      return Math.round(
        (hours[1] === 'uma' || hours[1] === 'um'
          ? 1
          : Number(hours[1].replace(',', '.'))) * 60,
      );
    return this.integer(
      value.replace(/^(?:uns|cerca de|aproximadamente) /u, ''),
    );
  }

  private boolean(value: string): boolean | undefined {
    if (
      /^(?:sim|consigo|tenho(?: sim)?|possuo|claro|correto|estou|com certeza)$/u.test(
        value,
      )
    )
      return true;
    if (/^(?:nao(?: tenho| possuo| consigo| estou)?|nenhuma?)$/u.test(value))
      return false;
    return undefined;
  }

  private equipment(value: string): readonly string[] | undefined {
    if (
      /nao tenho equipamento|sem equipamento|nenhum equipamento/u.test(value)
    ) {
      return Object.freeze(['BODYWEIGHT']);
    }
    if (
      /(?:todos os equipamentos|todos os aparelhos|todos) (?:de|da|em) uma academia(?: comum| completa)?|academia completa/u.test(
        value,
      )
    ) {
      return Object.freeze([
        'BARBELL',
        'BENCH',
        'CABLE',
        'DUMBBELL',
        'MACHINE',
        'PULL_UP_BAR',
        'TREADMILL',
      ]);
    }
    const matches: string[] = [];
    const options: readonly (readonly [string, RegExp])[] = [
      ['DUMBBELL', /halter/],
      ['RESISTANCE_BAND', /elastic|faixa/],
      ['BARBELL', /barra/],
      ['KETTLEBELL', /kettlebell/],
      ['MACHINE', /maquina/],
      ['CABLE', /cabo|polia/],
      ['BENCH', /banco/],
      ['PULL_UP_BAR', /barra fixa/],
      ['BIKE', /bike|bicicleta/],
      ['TREADMILL', /esteira/],
      ['ROW_ERGOMETER', /remo/],
      ['BODYWEIGHT', /peso do corpo/],
    ];
    for (const [code, pattern] of options) {
      if (pattern.test(value)) matches.push(code);
    }
    return matches.length > 0
      ? Object.freeze([...new Set(matches)].sort())
      : undefined;
  }

  private weekdays(value: string): readonly string[] | undefined {
    const matches: string[] = [];
    const options: readonly (readonly [string, RegExp])[] = [
      ['MONDAY', /segunda/],
      ['TUESDAY', /terca/],
      ['WEDNESDAY', /quarta/],
      ['THURSDAY', /quinta/],
      ['FRIDAY', /sexta/],
      ['SATURDAY', /sabado/],
      ['SUNDAY', /domingo/],
    ];
    for (const [code, pattern] of options) {
      if (pattern.test(value)) matches.push(code);
    }
    return matches.length > 0 ? Object.freeze(matches) : undefined;
  }

  private times(value: string): readonly string[] {
    const times = [
      ...value.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\b/gu),
    ].map((match) => `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`);
    return Object.freeze([...new Set(times)]);
  }

  private textList(value: string): readonly string[] | undefined {
    const normalized = value
      .split(/,|;|\s+e\s+/iu)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => item.slice(0, 120));
    return normalized.length > 0
      ? Object.freeze([...new Set(normalized)])
      : undefined;
  }

  private explicitNone(value: string): boolean {
    return /^(?:nao|nada|nenhum(?:a)?(?: alergia(?: alimentar)?s?| intolerancia(?: alimentar)?s?)?|nao tenho(?: nenhum(?:a)?| alergia(?: alimentar)?s?| intolerancia(?: alimentar)?s?)?|nao uso(?: suplementos?)?)$/u.test(
      value,
    );
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
