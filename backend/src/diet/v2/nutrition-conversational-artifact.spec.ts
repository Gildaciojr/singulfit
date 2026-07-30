import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { NutritionConversationalArtifactParser } from './nutrition-conversational-artifact.parser';
import { NutritionConversationalArtifactValidator } from './nutrition-conversational-artifact.validator';

describe('NutritionConversationalArtifactV1', () => {
  const parser = new NutritionConversationalArtifactParser();
  const validator = new NutritionConversationalArtifactValidator();
  it('parses strict guidance and rejects incompatible plan fields', () => {
    const valid = {
      artifactType: 'POINT_GUIDANCE',
      title: 'Orientação',
      summary: 'Resumo',
      guidance: {
        answer: 'Resposta',
        rationale: [],
        actionableSteps: ['Ação'],
        cautions: [],
      },
    };
    expect(parser.parse(JSON.stringify(valid), 'POINT_GUIDANCE')).toEqual(
      valid,
    );
    expect(() =>
      parser.parse(JSON.stringify({ ...valid, days: [] }), 'POINT_GUIDANCE'),
    ).toThrow(BadGatewayException);
    expect(() =>
      parser.parse(
        JSON.stringify({
          ...valid,
          guidance: { ...valid.guidance, actionableSteps: [] },
        }),
        'POINT_GUIDANCE',
      ),
    ).toThrow(BadGatewayException);
  });
  it('parses meal suggestion and rejects negative estimates', () => {
    const valid = {
      artifactType: 'MEAL_SUGGESTION',
      title: 'Refeição',
      summary: 'Resumo',
      meal: {
        name: 'Almoço',
        mealType: 'LUNCH',
        description: 'Prato',
        items: [
          { name: 'Arroz', quantity: 100, unit: 'g', preparationNotes: null },
        ],
        estimatedNutrition: {
          caloriesKcal: 400,
          proteinGrams: 20,
          carbohydrateGrams: 50,
          fatGrams: 10,
        },
        alternatives: [],
      },
    };
    expect(parser.parse(JSON.stringify(valid), 'MEAL_SUGGESTION')).toEqual(
      valid,
    );
    expect(() =>
      parser.parse(
        JSON.stringify({
          ...valid,
          meal: {
            ...valid.meal,
            estimatedNutrition: {
              ...valid.meal.estimatedNutrition,
              caloriesKcal: -1,
            },
          },
        }),
        'MEAL_SUGGESTION',
      ),
    ).toThrow(BadGatewayException);
  });
  it('parses review without accepting an AI-provided plan id', () => {
    const valid = {
      artifactType: 'PLAN_REVIEW',
      title: 'Revisão',
      summary: 'Resumo',
      review: {
        overallAssessment: 'Adequado',
        strengths: ['Variedade'],
        concerns: [],
        recommendations: [],
      },
    };
    expect(parser.parse(JSON.stringify(valid), 'PLAN_REVIEW')).toEqual(valid);
    expect(() =>
      parser.parse(
        JSON.stringify({ ...valid, reviewedPlanId: 'invented' }),
        'PLAN_REVIEW',
      ),
    ).toThrow(BadGatewayException);
  });
  it('validates materialized canonical documents', () => {
    expect(() =>
      validator.validate({
        schemaVersion: '1.0',
        artifactType: 'PLAN_REVIEW',
        title: 'Revisão',
        summary: 'Resumo',
        generatedAt: '2026-07-29T12:00:00.000Z',
        reviewedPlanId: '',
        review: {
          overallAssessment: 'Ok',
          strengths: ['S'],
          concerns: [],
          recommendations: [],
        },
      }),
    ).toThrow(BadRequestException);
  });
});
