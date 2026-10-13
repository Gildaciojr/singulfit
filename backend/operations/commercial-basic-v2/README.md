# Commercial BASIC V2: controlled operations

The structural migration does not provision BASIC V2 or alter any subscription.
Existing plans retain their IDs, prices, grants and `legacy-v1` identity. The former
active offers remain current until separately authorized provisioning.

Rights, invoices and usage follow the contracted `Subscription.planId`; public
offer selection is exclusively for a new contract. Existing pending/expired
contracts retain their original IDs and subscription amounts. An active contract
does not acquire a new initial invoice. An implicit upgrade/downgrade is rejected.

`Plan.id`, `type` and `contractVersion` are immutable. PostgreSQL's partial unique
index `plans_current_offer_type_key` enforces at most one current offer per type.
Prisma 5 does not represent that partial index or the deferred integrity triggers;
do not remove them with schema synchronization. Never use `db push` in production.
The composite unique key `(type, contractVersion)` replaces uniqueness by type.

## Provisioning

Use psql against an explicitly selected database with credentials supplied through
the approved environment. Never place a connection secret in the script or receipt.
The release has 67 migrations: 61 historical, five frozen, one commercial.

```
psql -X -v mode=PREVIEW -f backend/operations/commercial-basic-v2/provision.sql
psql -X -v mode=SIMULATE -v legacy_plan_id=REVIEWED_LEGACY_UUID -v new_plan_id=REVIEWED_NEW_UUID -v expected_fingerprint=REVIEWED_SHA256 -v authorization=BASIC_V2_CREATE_AND_ACTIVATE -f backend/operations/commercial-basic-v2/provision.sql
psql -X -v mode=APPLY -v legacy_plan_id=REVIEWED_LEGACY_UUID -v new_plan_id=REVIEWED_NEW_UUID -v expected_fingerprint=REVIEWED_SHA256 -v authorization=BASIC_V2_CREATE_AND_ACTIVATE -f backend/operations/commercial-basic-v2/provision.sql
```

PREVIEW is read-only. SIMULATE performs the real transaction and rolls it back.
APPLY requires separate operational authorization. Substitute reviewed identifiers
and the exact current fingerprint, not placeholders. Retain the non-secret receipt
outside the application commit. Stale fingerprints, conflicting versions or
incomplete grants abort the transaction. There is no generic seed execution.

The provisioned offer is BASIC/BRL 29.90/MONTH 1, with AUDIO_TRANSCRIPTION=30,
IMAGE_ANALYSIS=30, NUTRITION_PLAN_GENERATION=2 and WORKOUT_PLAN_GENERATION=2.
Legacy image daily/monthly grants are not attached to V2. The previous BASIC and
all of its grants remain unchanged; only public-current flags change atomically.
Premium provisioning is not part of this script and remains separately authorized.

## Public-offer rollback

Capture fresh fingerprints for both IDs with PREVIEW. Run `rollback-offer.sql`
with `legacy_plan_id`, `new_plan_id`, `expected_legacy_fingerprint`,
`expected_v2_fingerprint` and authorization `BASIC_V2_PUBLIC_OFFER_ROLLBACK`.
Omit `apply` or use `-v apply=false` for simulation; `-v apply=true` commits only
after operational approval. This changes public flags, never contracts, grants,
usage, invoices or schema. New V2 subscribers retain V2 rights after this rollback.

## Runtime rollback

Use only the commercially updated bridge image, never the earlier 66-migration
bridge or original runtime. Both runtimes recognize all 67 migrations; migrate
deploy must be NO-OP after the complete schema has been applied. Audio and weekly
remain OFF. Do not drop expanded tables/columns, reassign plan IDs, clear counters,
release uncertain paid reservations, or replay acknowledged deliveries.

Generic seeds are explicitly restricted to an empty disposable database with
`SINGULFIT_SEED_DISPOSABLE_DATABASE_AUTHORIZED=true`. They refuse existing plans or
subscriptions and cannot serve as an upgrade mechanism.
