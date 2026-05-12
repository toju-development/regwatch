-- POST-10: add AlertSource enum values for MX (Mexico) and UY (Uruguay) jurisdictions
-- ALTER TYPE ... ADD VALUE is append-only and non-transactional in Postgres.
-- Safe for zero-downtime deploy; existing rows are untouched.
-- IF NOT EXISTS: idempotent re-runs (e.g. after a failed migration reset).

-- MX — Mexico (CNBV + BANXICO)
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'CNBV_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'CNBV_RESOLUCIONES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'BANXICO_CIRCULARES';

-- UY — Uruguay (BCU)
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'BCU_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'BCU_COMUNICACIONES';
