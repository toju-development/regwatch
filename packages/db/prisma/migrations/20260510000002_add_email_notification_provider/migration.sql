-- Migration: add_email_notification_provider
-- sdd/notify-email-resend (POST-2): adds EMAIL to the NotificationProvider PG enum.
-- Additive-only — safe to deploy before application code ships.
-- Constraint: ALTER TYPE ... ADD VALUE IF NOT EXISTS (from project rules).

ALTER TYPE "NotificationProvider" ADD VALUE IF NOT EXISTS 'EMAIL';
