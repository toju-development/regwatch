-- Migration #15: add Settings.scanDayOfMonth
-- MVP-12 (scheduler-per-org): day-of-month (1-28) for monthly cadence.
-- Additive: nullable with DEFAULT 1 — no backfill needed.
-- Semantics: `scanDay` retains day-of-week; this column is month-day only.

ALTER TABLE "Settings" ADD COLUMN "scanDayOfMonth" INTEGER DEFAULT 1;
