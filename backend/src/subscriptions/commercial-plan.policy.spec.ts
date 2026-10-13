import { BillingInterval, Currency, PlanType, Prisma } from '@prisma/client';
import {
  assertCurrentCommercialOffer,
  BASIC_V2_GRANTS,
  CommercialOffer,
} from './commercial-plan.policy';

function offer(): CommercialOffer {
  const now = new Date('2026-10-12T12:00:00Z');
  return {
    id: 'basic-v2',
    type: PlanType.BASIC,
    contractVersion: 'basic-v2',
    isCurrentOffer: true,
    name: 'Basic',
    description: null,
    price: new Prisma.Decimal('29.90'),
    currency: Currency.BRL,
    billingInterval: BillingInterval.MONTH,
    billingIntervalCount: 1,
    imageLimit: 30,
    imageUnlimited: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    entitlements: Object.entries(BASIC_V2_GRANTS).map(([code, value]) => ({
      id: code,
      planId: 'basic-v2',
      entitlementId: code,
      value,
      unlimited: false,
      createdAt: now,
      updatedAt: now,
      entitlement: {
        id: code,
        code,
        name: code,
        description: null,
        createdAt: now,
      },
    })),
  };
}

describe('commercial current-offer boundary', () => {
  it('accepts the fully provisioned BASIC V2 contract', () => {
    expect(() => assertCurrentCommercialOffer(offer())).not.toThrow();
  });
  it.each(Object.keys(BASIC_V2_GRANTS))(
    'rejects a missing %s grant',
    (code) => {
      const plan = offer();
      plan.entitlements = plan.entitlements.filter(
        (grant) => grant.entitlement.code !== code,
      );
      expect(() => assertCurrentCommercialOffer(plan)).toThrow();
    },
  );
  it('rejects unlimited metadata conflicting with the canonical image grant', () => {
    expect(() =>
      assertCurrentCommercialOffer({ ...offer(), imageUnlimited: true }),
    ).toThrow();
  });
  it('rejects an inactive or unselected offer', () => {
    expect(() =>
      assertCurrentCommercialOffer({ ...offer(), isCurrentOffer: false }),
    ).toThrow();
    expect(() =>
      assertCurrentCommercialOffer({ ...offer(), isActive: false }),
    ).toThrow();
  });
  it('does not reinterpret historical rights as BASIC V2', () => {
    const plan = {
      ...offer(),
      contractVersion: 'legacy-v1',
      entitlements: [],
      imageLimit: 3,
    };
    expect(() => assertCurrentCommercialOffer(plan)).not.toThrow();
    expect(plan.imageLimit).toBe(3);
    expect(plan.entitlements).toEqual([]);
  });
});
