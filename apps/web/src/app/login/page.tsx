/**
 * Sign-in page — `/login`.
 *
 * Spec: auth-foundation § auth (R "Google OAuth Sign-in", "Magic Link Sign-in",
 *   S "Provider error returns to /login").
 * Design §2 file-layout row.
 *
 * RSC shell with two Server Action forms:
 *   1. Google button → `signIn('google')`. When `AUTH_FAKE_GOOGLE=1` the
 *      fake-google credentials provider is mounted in `auth.ts` — operators
 *      use that instead of the real Google flow in dev/CI.
 *   2. Magic Link form → `signIn('resend', { email })`. The `'resend'`
 *      provider id is overridden in dev/CI by the in-memory transport
 *      (see `auth-email/memory-transport.ts`); the UI is invariant.
 */
import { signIn } from '@/lib/auth';
import { env } from '@/env';
import { Button } from '@/components/ui/button';

interface LoginPageProps {
  // Next.js 15: searchParams is a Promise.
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

async function googleSignInAction(): Promise<void> {
  'use server';
  // When AUTH_FAKE_GOOGLE=1 the fake provider intercepts; otherwise this hits
  // real Google (which fails without secrets — expected per operator decision).
  await signIn('google', { redirectTo: '/' });
}

async function fakeGoogleSignInAction(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('fakeEmail') ?? '');
  if (!email) return;
  await signIn('google-fake', { email, redirectTo: '/' });
}

async function magicLinkSignInAction(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') ?? '');
  if (!email) return;
  await signIn('resend', { email, redirectTo: '/' });
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const fakeGoogleEnabled = env.AUTH_FAKE_GOOGLE;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 p-8">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Sign in to RegWatch</h1>
        <p className="text-muted-foreground text-sm">
          Choose Google or receive a magic link by email.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          data-testid="login-error"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          Sign-in failed: {error}
        </p>
      ) : null}

      <form action={googleSignInAction} className="flex flex-col gap-2">
        <Button type="submit" variant="outline" data-testid="google-signin">
          Sign in with Google
        </Button>
      </form>

      {fakeGoogleEnabled ? (
        <form action={fakeGoogleSignInAction} className="flex flex-col gap-2">
          <label htmlFor="fakeEmail" className="text-muted-foreground text-xs">
            Dev: fake-google sign-in
          </label>
          <input
            id="fakeEmail"
            name="fakeEmail"
            type="email"
            required
            placeholder="dev@regwatch.local"
            data-testid="fake-google-email"
            className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
          />
          <Button type="submit" variant="ghost" data-testid="fake-google-signin">
            Sign in (fake Google)
          </Button>
        </form>
      ) : null}

      <form action={magicLinkSignInAction} className="flex flex-col gap-2">
        <label htmlFor="email" className="text-muted-foreground text-xs">
          Magic link
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          data-testid="magic-link-email"
          className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
        />
        <Button type="submit" data-testid="magic-link-submit">
          Email me a link
        </Button>
      </form>
    </main>
  );
}
