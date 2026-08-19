import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileValueType,
} from '@prisma/client';
import type {
  ProfileAcquisitionDecision,
  ProfileAcquisitionField,
} from '../coach-adaptive-profile-collector.contract';
import {
  ProfileQuestionKind,
  ProfileQuestionReason,
  ProfileQuestionSpecification,
  ProfileResponseType,
  RealizedProfileQuestion,
  RecognizedProfileValue,
} from './profile-acquisition.contract';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';

const FIELD_BRIDGE: Readonly<
  Partial<
    Record<
      NonNullable<ProfileAcquisitionDecision['selectedCandidate']>['field'],
      CoachProfileAcquisitionField
    >
  >
> = Object.freeze({
  TRAINING_MODALITY: CoachProfileAcquisitionField.TRAINING_MODALITY,
  TRAINING_EXPERIENCE: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
  PHYSICAL_LIMITATIONS: CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
  TRAINING_FREQUENCY: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
  SESSION_DURATION: CoachProfileAcquisitionField.SESSION_DURATION_MINUTES,
  TRAINING_ENVIRONMENT: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
  TRAINING_EQUIPMENT: CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
  PERCEIVED_CONDITIONING: CoachProfileAcquisitionField.PERCEIVED_CONDITIONING,
  INTENSITY_PREFERENCE: CoachProfileAcquisitionField.PREFERRED_INTENSITY,
  CARDIO_AVAILABILITY: CoachProfileAcquisitionField.CARDIO_AVAILABILITY,
  TRAINING_FORMAT_PREFERENCE:
    CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE,
  MEAL_COUNT: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
  FOOD_INTOLERANCES: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
  ALLERGIES: CoachProfileAcquisitionField.ALLERGIES,
  MEDICAL_CONDITIONS: CoachProfileAcquisitionField.MEDICAL_CONDITIONS,
  DECLARED_FOOD_PREFERENCES:
    CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES,
  DECLARED_FOOD_REJECTIONS:
    CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS,
  DIETARY_PATTERN: CoachProfileAcquisitionField.EATING_PATTERN,
  COOKING_AVAILABILITY: CoachProfileAcquisitionField.COOKING_AVAILABILITY,
  MEALS_AWAY_FROM_HOME: CoachProfileAcquisitionField.EATING_OUT_FREQUENCY,
  EATING_OUT_FREQUENCY: CoachProfileAcquisitionField.EATING_OUT_FREQUENCY,
  FOOD_BUDGET: CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL,
  SUPPLEMENTATION: CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION,
  HYDRATION: CoachProfileAcquisitionField.REPORTED_HYDRATION,
  MEAL_TIMES: CoachProfileAcquisitionField.MEAL_TIMES,
  TRAINING_TIME: CoachProfileAcquisitionField.TRAINING_TIME,
  RETURNING_AFTER_BREAK: CoachProfileAcquisitionField.RETURNING_AFTER_BREAK,
  AVAILABLE_TRAINING_DAYS: CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS,
  DAILY_TRAINING_WINDOWS: CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS,
});

const REVERSE_FIELD_BRIDGE: Readonly<
  Partial<Record<CoachProfileAcquisitionField, ProfileAcquisitionField>>
> = Object.freeze({
  TRAINING_MODALITY: 'TRAINING_MODALITY',
  TRAINING_EXPERIENCE: 'TRAINING_EXPERIENCE',
  PHYSICAL_LIMITATIONS: 'PHYSICAL_LIMITATIONS',
  WEEKLY_FREQUENCY: 'TRAINING_FREQUENCY',
  SESSION_DURATION_MINUTES: 'SESSION_DURATION',
  TRAINING_ENVIRONMENT: 'TRAINING_ENVIRONMENT',
  AVAILABLE_EQUIPMENT: 'TRAINING_EQUIPMENT',
  PERCEIVED_CONDITIONING: 'PERCEIVED_CONDITIONING',
  PREFERRED_INTENSITY: 'INTENSITY_PREFERENCE',
  CARDIO_AVAILABILITY: 'CARDIO_AVAILABILITY',
  TRAINING_FORMAT_PREFERENCE: 'TRAINING_FORMAT_PREFERENCE',
  RETURNING_AFTER_BREAK: 'RETURNING_AFTER_BREAK',
  DESIRED_MEAL_COUNT: 'MEAL_COUNT',
  EATING_PATTERN: 'DIETARY_PATTERN',
  FOOD_INTOLERANCES: 'FOOD_INTOLERANCES',
  ALLERGIES: 'ALLERGIES',
  MEDICAL_CONDITIONS: 'MEDICAL_CONDITIONS',
  DECLARED_FOOD_PREFERENCES: 'DECLARED_FOOD_PREFERENCES',
  DECLARED_FOOD_REJECTIONS: 'DECLARED_FOOD_REJECTIONS',
  FOOD_BUDGET_LEVEL: 'FOOD_BUDGET',
  COOKING_AVAILABILITY: 'COOKING_AVAILABILITY',
  EATING_OUT_FREQUENCY: 'EATING_OUT_FREQUENCY',
  REPORTED_HYDRATION: 'HYDRATION',
  REPORTED_SUPPLEMENTATION: 'SUPPLEMENTATION',
  MEAL_TIMES: 'MEAL_TIMES',
  TRAINING_TIME: 'TRAINING_TIME',
  AVAILABLE_TRAINING_DAYS: 'AVAILABLE_TRAINING_DAYS',
  DAILY_TRAINING_WINDOWS: 'DAILY_TRAINING_WINDOWS',
});

const TEMPLATE: Readonly<Record<CoachProfileAcquisitionField, string>> =
  Object.freeze({
    TRAINING_MODALITY:
      'Onde ou como você pretende treinar: academia, em casa, corrida, bike, CrossFit ou outro formato?',
    TRAINING_EXPERIENCE:
      'Como você descreve sua experiência nessa modalidade: iniciante, intermediária ou avançada?',
    PHYSICAL_LIMITATIONS:
      'Você tem alguma limitação física, lesão ou movimento que eu precise considerar? Se não tiver, pode dizer que não.',
    WEEKLY_FREQUENCY:
      'Em quantos dias da semana você realmente consegue treinar?',
    SESSION_DURATION_MINUTES:
      'Quanto tempo você costuma conseguir reservar para cada treino?',
    TRAINING_ENVIRONMENT:
      'Em qual ambiente esses treinos vão acontecer na maior parte das vezes?',
    AVAILABLE_EQUIPMENT:
      'Quais equipamentos você terá disponíveis para treinar?',
    PERCEIVED_CONDITIONING:
      'Hoje, como você percebe seu condicionamento: baixo, moderado ou alto?',
    PREFERRED_INTENSITY:
      'Você prefere treinos leves, moderados ou mais intensos?',
    CARDIO_AVAILABILITY:
      'Você consegue incluir alguma atividade de cardio na sua rotina?',
    TRAINING_FORMAT_PREFERENCE:
      'Você prefere treinar individualmente, em grupo ou é flexível quanto a isso?',
    RETURNING_AFTER_BREAK:
      'Você está voltando aos treinos depois de uma pausa mais longa?',
    DESIRED_MEAL_COUNT:
      'Quantas refeições costumam funcionar bem na sua rotina diária?',
    EATING_PATTERN:
      'Seu padrão alimentar é onívoro, vegetariano, vegano, pescetariano, flexitariano ou outro?',
    FOOD_INTOLERANCES:
      'Existe alguma intolerância alimentar que você queira registrar? Se não houver, pode dizer que não.',
    ALLERGIES:
      'Você possui alguma alergia alimentar? Se não possuir, pode dizer que não.',
    MEDICAL_CONDITIONS:
      'Você possui alguma condição de saúde ou condição médica relevante que eu deva considerar? Se não possuir, pode dizer que não.',
    DECLARED_FOOD_PREFERENCES:
      'Quais alimentos você gostaria que aparecessem com mais frequência no seu plano?',
    DECLARED_FOOD_REJECTIONS:
      'Há algum alimento que você não gosta e prefere evitar?',
    FOOD_BUDGET_LEVEL:
      'Para a alimentação, você prefere opções mais econômicas, moderadas ou tem orçamento flexível?',
    COOKING_AVAILABILITY:
      'Quanto espaço você tem na rotina para cozinhar: nenhum, pouco, moderado ou bastante?',
    EATING_OUT_FREQUENCY:
      'Com que frequência você costuma fazer refeições fora de casa?',
    REPORTED_HYDRATION:
      'Como você avalia sua hidratação hoje: baixa, adequada ou alta?',
    REPORTED_SUPPLEMENTATION:
      'Você usa algum suplemento atualmente? Se não usa, pode dizer que não.',
    MEAL_TIMES: 'Quais horários de refeição costumam funcionar para você?',
    TRAINING_TIME: 'Qual horário costuma funcionar melhor para seus treinos?',
    AVAILABLE_TRAINING_DAYS:
      'Quais dias da semana costumam estar disponíveis para treino?',
    DAILY_TRAINING_WINDOWS:
      'Em quais janelas de horário você consegue treinar nesses dias?',
  });

@Injectable()
export class ProfileQuestionSpecificationService {
  constructor(private readonly registry: CoachProfileFieldRegistryService) {}

  fromDecision(
    decision: ProfileAcquisitionDecision,
  ): ProfileQuestionSpecification | null {
    const candidate = decision.selectedCandidate;
    if (!decision.shouldAsk || !candidate) return null;
    const field = FIELD_BRIDGE[candidate.field];
    if (!field) return null;
    const reason: ProfileQuestionReason =
      candidate.state === 'WAITING_CONFIRMATION'
        ? 'CONFIRMATION_REQUIRED'
        : 'MISSING_CONTEXTUAL_FIELD';
    return this.forField(field, reason);
  }

  forField(
    field: CoachProfileAcquisitionField,
    reasonCode: ProfileQuestionReason,
  ): ProfileQuestionSpecification {
    const definition = this.registry.get(field);
    const shape = this.shape(definition.valueType, field);
    return Object.freeze({
      field,
      questionKind: shape.questionKind,
      responseType: shape.responseType,
      allowedOptions: Object.freeze(
        definition.allowedOptions.map((value) =>
          Object.freeze({ value, label: this.label(value) }),
        ),
      ),
      allowsFreeText:
        definition.allowedOptions.length === 0 ||
        field === CoachProfileAcquisitionField.TRAINING_MODALITY,
      confirmationPolicy: definition.confirmationPolicy,
      reasonCode,
      version: definition.definitionVersion,
      templateCode: `PROFILE_QUESTION_${field}_V${definition.definitionVersion}`,
    });
  }

  toCollectorField(
    field: CoachProfileAcquisitionField,
  ): ProfileAcquisitionField | null {
    return REVERSE_FIELD_BRIDGE[field] ?? null;
  }

  private shape(
    valueType: CoachProfileValueType,
    field: CoachProfileAcquisitionField,
  ): {
    readonly questionKind: ProfileQuestionKind;
    readonly responseType: ProfileResponseType;
  } {
    if (field === CoachProfileAcquisitionField.TRAINING_TIME) {
      return { questionKind: 'TIME', responseType: 'TIME' };
    }
    if (field === CoachProfileAcquisitionField.MEAL_TIMES) {
      return { questionKind: 'TIME_LIST', responseType: 'TIME_LIST' };
    }
    if (valueType === CoachProfileValueType.INTEGER) {
      return { questionKind: 'INTEGER', responseType: 'INTEGER' };
    }
    if (valueType === CoachProfileValueType.BOOLEAN) {
      return { questionKind: 'BOOLEAN', responseType: 'BOOLEAN' };
    }
    if (valueType === CoachProfileValueType.TEXT_LIST) {
      return {
        questionKind:
          field === CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT ||
          field === CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS
            ? 'MULTIPLE_CHOICE'
            : 'SHORT_TEXT_LIST',
        responseType:
          field === CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT ||
          field === CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS
            ? 'OPTION_LIST'
            : 'TEXT_LIST',
      };
    }
    return { questionKind: 'SINGLE_CHOICE', responseType: 'OPTION' };
  }

  private label(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}

@Injectable()
export class ProfileQuestionRealizerService {
  realize(
    specification: ProfileQuestionSpecification,
  ): RealizedProfileQuestion {
    return Object.freeze({
      field: specification.field,
      templateCode: specification.templateCode,
      templateVersion: specification.version,
      text: TEMPLATE[specification.field],
    });
  }

  realizeConfirmation(
    specification: ProfileQuestionSpecification,
    value: RecognizedProfileValue,
  ): RealizedProfileQuestion {
    const displayValue = this.displayValue(value);

    return Object.freeze({
      field: specification.field,
      templateCode: specification.templateCode + '_CONFIRMATION',
      templateVersion: specification.version,
      text: `Só para confirmar: ${displayValue}. Posso salvar assim?`,
    });
  }

  private displayValue(value: RecognizedProfileValue): string {
    if (Array.isArray(value)) {
      return value.length === 0
        ? 'você não tem nada a registrar'
        : value.join(', ').slice(0, 400);
    }
    if (typeof value === 'boolean') {
      return value ? 'sim' : 'não';
    }
    return String(value).slice(0, 400);
  }
}
