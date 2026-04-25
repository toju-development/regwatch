/**
 * Test-only inbox endpoint for in-memory Magic Link transport.
 *
 * Spec: auth-foundation § auth (R "Magic Link Sign-in", S "Request → click →
 * accept" — used by Playwright fixtures in B6 to retrieve the magic URL).
 * Design §6 (Q11).
 *
 * SECURITY: DOUBLE-GUARDED. Returns 404 unless BOTH conditions hold:
 *   1. process.env.NODE_ENV !== 'production'
 *   2. process.env.EMAIL_TRANSPORT === 'memory'
 *
 * If you ever bind real Resend in prod and somehow ship this file, the
 * guards still make the route invisible (404). Do NOT remove or weaken
 * either guard. If you need to lift the prod guard for a smoke test,
 * delete the file instead — DO NOT add bypass envs.
 */
import { NextResponse } from 'next/server';
import { readInbox } from '@/lib/auth-email/memory-transport';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  // Guard 1: never expose in production builds.
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  // Guard 2: only when the in-memory transport is actually wired.
  if (process.env.EMAIL_TRANSPORT !== 'memory') {
    return new NextResponse(null, { status: 404 });
  }

  const { email } = await params;
  const decoded = decodeURIComponent(email);
  const records = readInbox(decoded);
  const latest = records.at(-1) ?? null;

  return NextResponse.json({
    email: decoded,
    count: records.length,
    latest,
    all: records,
  });
}
