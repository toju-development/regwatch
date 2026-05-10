-- MVP-15: Add EMAIL_INBOUND to AlertSource enum (sdd/email-inbound spec REQ-4)
-- Postgres enum extensions are append-only — no rollback path (by design, ADR-17).
-- IF NOT EXISTS: idempotent re-runs (e.g. after a failed migration reset).
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'EMAIL_INBOUND';
