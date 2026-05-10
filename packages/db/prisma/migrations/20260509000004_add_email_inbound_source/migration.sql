-- MVP-15: Add EMAIL_INBOUND to AlertSource enum (sdd/email-inbound spec REQ-4)
-- Postgres enum extensions are append-only — no rollback path (by design, ADR-17).
ALTER TYPE "AlertSource" ADD VALUE 'EMAIL_INBOUND';
