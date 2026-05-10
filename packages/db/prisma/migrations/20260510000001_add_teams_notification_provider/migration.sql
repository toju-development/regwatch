-- POST-1 (sdd/notify-teams): Add TEAMS value to NotificationProvider enum.
-- Append-only — existing SLACK rows are not affected.
-- Rollback is safe as long as zero TEAMS rows exist in NotificationChannel.
ALTER TYPE "NotificationProvider" ADD VALUE IF NOT EXISTS 'TEAMS';
