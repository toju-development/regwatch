-- POST-10b: Add AlertSource values for Ecuador (SB_EC) and Panama (SBP).
-- ⚠️  PostgreSQL enum values are permanent once added. Rollback requires dump/restore
--     or ALTER TYPE ... RENAME VALUE (pg 14+). Do NOT revert without a migration plan.
--
-- Idempotent: uses IF NOT EXISTS guard so re-running on an already-migrated DB is safe.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SB_EC_RESOLUCIONES'
      AND enumtypid = 'public."AlertSource"'::regtype
  ) THEN
    ALTER TYPE "AlertSource" ADD VALUE 'SB_EC_RESOLUCIONES';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SB_EC_CIRCULARES'
      AND enumtypid = 'public."AlertSource"'::regtype
  ) THEN
    ALTER TYPE "AlertSource" ADD VALUE 'SB_EC_CIRCULARES';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SBP_ACUERDOS'
      AND enumtypid = 'public."AlertSource"'::regtype
  ) THEN
    ALTER TYPE "AlertSource" ADD VALUE 'SBP_ACUERDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SBP_RESOLUCIONES'
      AND enumtypid = 'public."AlertSource"'::regtype
  ) THEN
    ALTER TYPE "AlertSource" ADD VALUE 'SBP_RESOLUCIONES';
  END IF;
END $$;
