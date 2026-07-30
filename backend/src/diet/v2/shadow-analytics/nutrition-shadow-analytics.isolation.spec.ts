import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Nutrition Shadow Analytics static isolation', () => {
  const directory = __dirname;

  it('contains only read queries and has no runtime or write dependency', () => {
    const gateway = readFileSync(
      join(directory, 'prisma-nutrition-shadow-analytics.gateway.ts'),
      'utf8',
    );
    const service = readFileSync(
      join(directory, 'nutrition-shadow-analytics.service.ts'),
      'utf8',
    );
    const combined = `${gateway}\n${service}`;

    expect(gateway).toContain('$queryRaw');
    expect(combined).not.toMatch(
      /\$executeRaw|\.create\(|\.update\(|\.delete\(|NutritionShadowRunnerService|NutritionShadowComparatorService|NutritionShadowRuntimeOrchestratorService|NutritionPlanningEngineV2Service|AIService|Dispatcher/,
    );
  });

  it('is not connected to AppModule and declares no controller', () => {
    const appModule = readFileSync(
      join(directory, '..', '..', '..', 'app.module.ts'),
      'utf8',
    );
    const module = readFileSync(
      join(directory, 'nutrition-shadow-analytics.module.ts'),
      'utf8',
    );

    expect(appModule).not.toContain('NutritionShadowAnalyticsModule');
    expect(module).not.toContain('controllers:');
  });
});
