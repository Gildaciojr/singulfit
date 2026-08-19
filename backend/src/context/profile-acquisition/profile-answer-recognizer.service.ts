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
    specification: ProfileQuestionSpecification,
    rawAnswer: string,
  ): RecognizedProfileAnswer {
    const answer = rawAnswer.trim();
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

    const value = this.value(specification.field, normalized, answer);
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
    const normalized = this.normalize(rawAnswer.trim());

    if (!normalized) {
      return this.confirmation('INVALID', 'EMPTY_CONFIRMATION');
    }
    if (
      /^(sim(?:,? (?:pode salvar|pode registrar))?|confirmo|confirmado|pode salvar|pode registrar|esta certo|correto)$/u.test(
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

  private value(
    field: CoachProfileAcquisitionField,
    normalized: string,
    original: string,
  ): RecognizedProfileValue | undefined {
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
        if (this.explicitNone(normalized)) return Object.freeze([]);
        return this.textList(original);
      case CoachProfileAcquisitionField.WEEKLY_FREQUENCY:
      case CoachProfileAcquisitionField.DESIRED_MEAL_COUNT:
        return this.integer(normalized);
      case CoachProfileAcquisitionField.SESSION_DURATION_MINUTES:
        return this.duration(normalized);
      case CoachProfileAcquisitionField.TRAINING_ENVIRONMENT:
        return this.first(normalized, [
          ['CROSSFIT_BOX', /box|crossfit/],
          ['FULL_GYM', /academia completa/],
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
        if (this.explicitNone(normalized)) return Object.freeze([]);
        if (/lactose/.test(normalized)) return Object.freeze(['LACTOSE']);
        if (/gluten/.test(normalized)) return Object.freeze(['GLUTEN']);
        return this.textList(original);
      case CoachProfileAcquisitionField.ALLERGIES:
        if (this.explicitNone(normalized)) return Object.freeze([]);
        return this.textList(original);
      case CoachProfileAcquisitionField.MEDICAL_CONDITIONS:
        if (this.explicitNone(normalized)) return Object.freeze([]);
        return this.textList(original);
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
    }
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
    specification: ProfileQuestionSpecification,
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

  private integer(value: string): number | undefined {
    const words: Readonly<Record<string, number>> = Object.freeze({
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
    });
    const digit = value.match(/\b(\d{1,3})\b/u);
    if (digit) return Number(digit[1]);
    return Object.entries(words).find(([word]) =>
      new RegExp(`\\b${word}\\b`, 'u').test(value),
    )?.[1];
  }

  private duration(value: string): number | undefined {
    const hours = value.match(/(\d+(?:[.,]\d+)?)\s*(?:hora|horas|h)\b/u);
    if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60);
    return this.integer(value);
  }

  private boolean(value: string): boolean | undefined {
    if (/^(sim|consigo|tenho|estou|com certeza)/u.test(value)) return true;
    if (/^(nao|não)|nao consigo|nao estou/u.test(value)) return false;
    return undefined;
  }

  private equipment(value: string): readonly string[] | undefined {
    if (
      /nao tenho equipamento|sem equipamento|nenhum equipamento/u.test(value)
    ) {
      return Object.freeze(['BODYWEIGHT']);
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
