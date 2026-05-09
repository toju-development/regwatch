-- MVP-13: add AlertSource enum values for BR, CO, PE, CL jurisdictions
-- ALTER TYPE ... ADD VALUE is append-only and non-transactional in Postgres.
-- Safe for zero-downtime deploy; existing rows are untouched.

ALTER TYPE "AlertSource" ADD VALUE 'BCB_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE 'BCB_RESOLUCOES';
ALTER TYPE "AlertSource" ADD VALUE 'CVM_RESOLUCOES';
ALTER TYPE "AlertSource" ADD VALUE 'SFC_CIRCULARES_EXTERNAS';
ALTER TYPE "AlertSource" ADD VALUE 'SBS_RESOLUCIONES';
ALTER TYPE "AlertSource" ADD VALUE 'SBS_CIRCULARES';
ALTER TYPE "AlertSource" ADD VALUE 'CMF_NORMAS';
ALTER TYPE "AlertSource" ADD VALUE 'CMF_RESOLUCIONES';
