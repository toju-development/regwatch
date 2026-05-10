-- MVP-13: add AlertSource enum values for BR, CO, PE, CL jurisdictions
-- ALTER TYPE ... ADD VALUE is append-only and non-transactional in Postgres.
-- Safe for zero-downtime deploy; existing rows are untouched.
-- IF NOT EXISTS: idempotent re-runs (e.g. after a failed migration reset).

ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'BCB_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'BCB_RESOLUCOES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'CVM_RESOLUCOES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'SFC_CIRCULARES_EXTERNAS';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'SBS_RESOLUCIONES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'SBS_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'CMF_NORMAS';
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'CMF_RESOLUCIONES';
