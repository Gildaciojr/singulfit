\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT p.id, p.type, p."contractVersion", p."isCurrentOffer", p."isActive",
       p.price, p.currency, p."billingInterval", p."billingIntervalCount",
       p."imageLimit", p."imageUnlimited", e.code, pe.value, pe.unlimited
FROM plans p LEFT JOIN plan_entitlements pe ON pe."planId"=p.id
LEFT JOIN entitlement_definitions e ON e.id=pe."entitlementId"
ORDER BY p.type,p."contractVersion",e.code;
-- No names, phones, emails, CPF, payment payloads or credentials.
SELECT s."planId",s.status,s.amount,count(*) AS contracts
FROM subscriptions s GROUP BY s."planId",s.status,s.amount
ORDER BY s."planId",s.status,s.amount;
SELECT "entitlementCode",sum(used) AS used,sum(reserved) AS reserved,count(*) AS buckets
FROM usage_buckets GROUP BY "entitlementCode" ORDER BY "entitlementCode";
SELECT migration_name,checksum,finished_at,rolled_back_at
FROM _prisma_migrations ORDER BY migration_name;
ROLLBACK;
