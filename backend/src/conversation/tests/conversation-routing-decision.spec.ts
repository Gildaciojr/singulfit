import { ConversationGoalPlannerService } from '../../context/conversation-goal-planner.service';
import { ConversationUnderstandingToGoalPlannerAdapter } from '../adapters/conversation-understanding-to-goal-planner.adapter';
import { ConversationExecutionRouterService } from '../routing/conversation-execution-router.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { ConversationGoalPreparationService } from '../understanding/conversation-goal-preparation.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import {
  goalPreparationInput,
  understanding,
} from './conversation-routing.fixtures';

describe('ConversationRoutingDecisionService', () => {
  const validator = new ConversationUnderstandingValidator();
  const preparation = new ConversationGoalPreparationService(
    validator,
    new ConversationUnderstandingToGoalPlannerAdapter(),
  );
  const planner = new ConversationGoalPlannerService();
  const router = new ConversationExecutionRouterService(validator);
  const service = new ConversationRoutingDecisionService(
    preparation,
    planner,
    router,
  );

  it('prepares, plans and routes one immutable decision bundle', () => {
    const order: string[] = [];
    const preparationSpy = jest
      .spyOn(preparation, 'prepare')
      .mockImplementationOnce((input) => {
        order.push('prepare');
        return new ConversationUnderstandingToGoalPlannerAdapter().adapt({
          preparation: input,
          targetPlan: 'DIET',
        });
      });
    const plannerSpy = jest
      .spyOn(planner, 'plan')
      .mockImplementationOnce((input) => {
        order.push('plan');
        return new ConversationGoalPlannerService().plan(input);
      });
    const routerSpy = jest
      .spyOn(router, 'route')
      .mockImplementationOnce((input) => {
        order.push('route');
        return new ConversationExecutionRouterService(validator).route(input);
      });

    const result = service.decide(
      goalPreparationInput(
        understanding('DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION'),
      ),
    );

    expect(order).toEqual(['prepare', 'plan', 'route']);
    expect(preparationSpy).toHaveBeenCalledTimes(1);
    expect(plannerSpy).toHaveBeenCalledTimes(1);
    expect(routerSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      decisionVersion: 'conversation-routing-decision:v1',
      plannerSummary: { targetPlan: 'DIET' },
      goalDecision: { goal: 'GENERATE_DIET_PLAN' },
      executionRoute: { kind: 'NUTRITION_PLAN_GENERATION' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.versions)).toBe(true);
  });

  it('does not call Planner or Router when preparation rejects input', () => {
    jest.restoreAllMocks();
    const plannerSpy = jest.spyOn(planner, 'plan');
    const routerSpy = jest.spyOn(router, 'route');

    expect(() =>
      service.decide(
        goalPreparationInput(
          understanding(
            'CURRENT_PLAN_REQUEST',
            'PRESENT_CURRENT_PLAN',
            'GENERAL',
          ),
        ),
      ),
    ).toThrow('Apresentação do plano atual exige target resolvido');
    expect(plannerSpy).not.toHaveBeenCalled();
    expect(routerSpy).not.toHaveBeenCalled();
  });
});
