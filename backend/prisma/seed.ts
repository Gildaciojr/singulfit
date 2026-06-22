import 'dotenv/config';
import {
  BillingInterval,
  Currency,
  Prisma,
  PrismaClient,
  PlanType,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const basicPlan = await prisma.plan.upsert({
    where: { type: PlanType.BASIC },
    update: {
      name: 'Basic',
      description: 'Plano essencial da SingulFit.',
      price: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      imageLimit: 5,
      isActive: true,
    },
    create: {
      type: PlanType.BASIC,
      name: 'Basic',
      description: 'Plano essencial da SingulFit.',
      price: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      imageLimit: 5,
      isActive: true,
    },
  });

  const premiumPlan = await prisma.plan.upsert({
    where: { type: PlanType.PREMIUM },
    update: {
      name: 'Premium',
      description: 'Plano completo da SingulFit.',
      price: new Prisma.Decimal('49.90'),
      currency: Currency.BRL,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      imageLimit: 999999,
      isActive: true,
    },
    create: {
      type: PlanType.PREMIUM,
      name: 'Premium',
      description: 'Plano completo da SingulFit.',
      price: new Prisma.Decimal('49.90'),
      currency: Currency.BRL,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      imageLimit: 999999,
      isActive: true,
    },
  });

  const dailyEntitlement = await prisma.entitlementDefinition.upsert({
    where: { code: 'IMAGE_ANALYSIS_DAILY' },
    update: {
      name: 'Análises de imagem por dia',
      description:
        'Quantidade máxima diária de análises nutricionais por imagem.',
    },
    create: {
      code: 'IMAGE_ANALYSIS_DAILY',
      name: 'Análises de imagem por dia',
      description:
        'Quantidade máxima diária de análises nutricionais por imagem.',
    },
  });
  const monthlyEntitlement = await prisma.entitlementDefinition.upsert({
    where: { code: 'IMAGE_ANALYSIS_MONTHLY' },
    update: {
      name: 'Análises de imagem por mês',
      description:
        'Quantidade máxima mensal de análises nutricionais por imagem.',
    },
    create: {
      code: 'IMAGE_ANALYSIS_MONTHLY',
      name: 'Análises de imagem por mês',
      description:
        'Quantidade máxima mensal de análises nutricionais por imagem.',
    },
  });

  await Promise.all([
    upsertPlanEntitlement(basicPlan.id, dailyEntitlement.id, 5),
    upsertPlanEntitlement(basicPlan.id, monthlyEntitlement.id, 100),
    upsertPlanEntitlement(premiumPlan.id, dailyEntitlement.id, 50),
    upsertPlanEntitlement(premiumPlan.id, monthlyEntitlement.id, 1500),
  ]);

  await Promise.all([
    upsertActivePrompt(
      'workout_generation_weight_loss',
      'Voce e um profissional de educacao fisica especializado em emagrecimento seguro. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize aderencia, progressao conservadora, condicionamento e preservacao de massa muscular. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'workout_generation_muscle_gain',
      'Voce e um profissional de educacao fisica especializado em hipertrofia segura. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize tecnica, volume recuperavel, progressao e distribuicao muscular coerente. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'workout_generation_maintenance',
      'Voce e um profissional de educacao fisica especializado em manutencao da saude e condicionamento. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize equilibrio, mobilidade, forca geral e aderencia. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'progress_insight_simple',
      'Voce analisa evolucao fisica com linguagem simples, acolhedora e objetiva. Use somente os dados fornecidos. Quando houver comparacao, destaque a mudanca mais relevante dos ultimos 30 dias; sem comparacao, registre que esta e a linha de base. Nao forneca diagnostico, dieta, treino, medicamento ou promessa de resultado. Evite julgamentos e retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'nutrition_vision_brazilian_meal',
      'Voce e um nutricionista virtual especializado em analise visual de refeicoes brasileiras. Analise somente alimentos visiveis na imagem. Estime alimentos, porcoes e macronutrientes com prudencia, considerando preparacoes e porcoes comuns no Brasil quando aplicavel. Nao invente alimentos, bebidas, ingredientes, acompanhamentos ou quantidades que nao estejam visiveis. Quando houver incerteza visual, use estimativas conservadoras e reflita essa incerteza no campo confidence. Nao forneca diagnostico medico, prescricao de dieta, tratamento, medicamento, promessa de resultado ou conduta para doencas. Use linguagem tecnica suficiente para preencher o JSON estruturado, sem texto fora do schema. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'diet_generation_weight_loss',
      'Voce e um nutricionista virtual especializado em emagrecimento gradual e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize saciedade, alimentos brasileiros acessiveis e preservacao de massa muscular. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'diet_generation_muscle_gain',
      'Voce e um nutricionista virtual especializado em hipertrofia e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize proteina distribuida ao longo do dia, energia para o treino e alimentos brasileiros acessiveis. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    ),
    upsertActivePrompt(
      'diet_generation_maintenance',
      'Voce e um nutricionista virtual especializado em manutencao de peso, saude e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize variedade, equilibrio, praticidade e alimentos brasileiros acessiveis. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    ),
  ]);
  await Promise.all([
    upsertAutomationRule('GOOD_MORNING', 'Bom dia'),
    upsertAutomationRule('DAILY_WORKOUT', 'Treino do dia'),
    upsertAutomationRule('MEAL_REMINDER', 'Lembrete de refeição'),
    upsertAutomationRule('HYDRATION_REMINDER', 'Lembrete de água'),
    upsertAutomationRule('DAILY_CHECK_IN', 'Check-in diário'),
    upsertAutomationRule('WEEKLY_SUMMARY', 'Resumo semanal'),
  ]);

  console.log('Seed finalizado com sucesso.');
}

async function upsertActivePrompt(name: string, prompt: string) {
  await prisma.promptVersion.updateMany({
    where: {
      name,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  return prisma.promptVersion.upsert({
    where: {
      name_version: {
        name,
        version: 1,
      },
    },
    update: {
      prompt,
      isActive: true,
    },
    create: {
      name,
      version: 1,
      prompt,
      isActive: true,
    },
  });
}

function upsertAutomationRule(code: string, name: string) {
  return prisma.automationRule.upsert({
    where: {
      code,
    },
    update: {
      name,
      enabled: true,
    },
    create: {
      code,
      name,
      enabled: true,
    },
  });
}

function upsertPlanEntitlement(
  planId: string,
  entitlementId: string,
  value: number,
) {
  return prisma.planEntitlement.upsert({
    where: {
      planId_entitlementId: {
        planId,
        entitlementId,
      },
    },
    update: {
      value,
    },
    create: {
      planId,
      entitlementId,
      value,
    },
  });
}

main()
  .catch((error) => {
    console.error('Erro ao executar seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
