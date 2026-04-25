/**
 * NextAuth route handler — `/api/auth/*`.
 *
 * Spec: auth-foundation § auth (all sign-in / sign-out flows route through here).
 * Design §2 file-layout row.
 */
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
