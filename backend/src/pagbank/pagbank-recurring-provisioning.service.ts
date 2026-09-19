import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentProvider,
  PlanType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BillingCycles,
  PagBankRecurringGateway,
  RecurringCustomerInput,
} from './pagbank-recurring.gateway';

const BILLING_CYCLES: readonly BillingCycles[] = [1, 3, 6, 12];

@Injectable()
export class PagBankRecurringProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PagBankRecurringGateway,
  ) {}

  async provisionPlan(planId: string, billingCycles: BillingCycles) {
    this.assertCycles(billingCycles);
    const existing = await this.prisma.providerPlanMapping.findUnique({
      where: {
        planId_provider_billingCycles: {
          planId,
          provider: PaymentProvider.PAGBANK,
          billingCycles,
        },
      },
    });
    if (existing) return existing;
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive)
      throw new NotFoundException('Plano ativo não encontrado');
    if (plan.type !== PlanType.BASIC && plan.type !== PlanType.PREMIUM)
      throw new BadRequestException('Plano comercial inválido');
    const referenceId = `singulfit${plan.type.toLowerCase()}${billingCycles}`;
    const providerPlanId = await this.gateway.createPlan({
      referenceId,
      name: `SingulFit ${plan.name} ${billingCycles} meses`,
      description: `SingulFit ${plan.type}, ${billingCycles} ciclos mensais`,
      amount: plan.price.mul(100).toNumber(),
      billingCycles,
    });
    try {
      return await this.prisma.providerPlanMapping.create({
        data: {
          planId,
          provider: PaymentProvider.PAGBANK,
          billingCycles,
          providerPlanId,
          referenceId,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.providerPlanMapping.findUnique({
          where: {
            planId_provider_billingCycles: {
              planId,
              provider: PaymentProvider.PAGBANK,
              billingCycles,
            },
          },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async provisionCustomer(
    userId: string,
    card: Omit<RecurringCustomerInput, 'referenceId'>,
  ) {
    const existing = await this.prisma.providerCustomer.findUnique({
      where: { userId_provider: { userId, provider: PaymentProvider.PAGBANK } },
    });
    if (existing) return existing;
    const providerCustomerId = await this.gateway.createCustomer({
      ...card,
      referenceId: `singulfituser${userId.replace(/-/g, '')}`,
    });
    try {
      return await this.prisma.providerCustomer.create({
        data: { userId, provider: PaymentProvider.PAGBANK, providerCustomerId },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.providerCustomer.findUnique({
          where: {
            userId_provider: { userId, provider: PaymentProvider.PAGBANK },
          },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async createSubscription(input: {
    subscriptionId: string;
    userId: string;
    planId: string;
    billingCycles: BillingCycles;
    card: Omit<RecurringCustomerInput, 'referenceId'>;
  }) {
    this.assertCycles(input.billingCycles);
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
    });
    if (
      !subscription ||
      subscription.userId !== input.userId ||
      subscription.planId !== input.planId
    )
      throw new NotFoundException('Assinatura local não encontrada');
    if (subscription.externalSubscriptionId) return subscription;
    if (subscription.status !== SubscriptionStatus.PENDING_PAYMENT)
      throw new BadRequestException(
        'Assinatura não disponível para cobrança recorrente',
      );
    const [plan, customer] = await Promise.all([
      this.provisionPlan(input.planId, input.billingCycles),
      this.provisionCustomer(input.userId, input.card),
    ]);
    const externalSubscriptionId = await this.gateway.createSubscription({
      referenceId: `singulfitsub${input.subscriptionId.replace(/-/g, '')}`,
      planId: plan.providerPlanId,
      customerId: customer.providerCustomerId,
      encryptedCard: input.card.encryptedCard,
    });
    const updated = await this.prisma.subscription.updateMany({
      where: { id: input.subscriptionId, externalSubscriptionId: null },
      data: {
        externalSubscriptionId,
        billingCycles: input.billingCycles,
        provider: PaymentProvider.PAGBANK,
      },
    });
    if (updated.count === 1)
      return this.prisma.subscription.findUniqueOrThrow({
        where: { id: input.subscriptionId },
      });
    return this.prisma.subscription.findUniqueOrThrow({
      where: { id: input.subscriptionId },
    });
  }

  private assertCycles(value: number): asserts value is BillingCycles {
    if (!BILLING_CYCLES.includes(value as BillingCycles))
      throw new BadRequestException('Quantidade de ciclos inválida');
  }
}
