/**
 * Sign-in page — `/login`.
 *
 * Spec: auth-foundation § auth (R "Google OAuth Sign-in", "Magic Link Sign-in",
 *   S "Provider error returns to /login").
 * Design §2 file-layout row.
 *
 * RSC shell con dos Server Action forms:
 *   1. Google button → `signIn('google')`.
 *   2. Magic Link form → `signIn('resend', { email })`.
 *
 * NO `pnpm build` después de cambios (regla del proyecto).
 */
import { signIn } from '@/lib/auth';
import { env } from '@/env';
import { Button } from '@/components/ui/button';
import { prisma } from '@regwatch/db';
import { redirect } from 'next/navigation';
import { LoginCard } from '@/components/auth/login-buttons';

interface LoginPageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

async function googleSignInAction(): Promise<void> {
  'use server';
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

  // Block if user already registered via OAuth (has Account rows)
  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: { accounts: { select: { provider: true }, take: 1 } },
  });
  if (existingUser && existingUser.accounts.length > 0) {
    redirect('/login?error=ProviderMismatch');
  }

  await signIn('resend', { email, redirectTo: '/' });
}

function errorMessage(error: string): string {
  if (error === 'AccessDenied')
    return 'Tu cuenta no tiene acceso a RegWatch. Contactá al administrador.';
  if (error === 'ProviderMismatch')
    return 'Ya tenés una cuenta con ese email usando Google. Ingresá con Google.';
  if (error === 'OAuthAccountNotLinked')
    return 'Ya tenés una cuenta con ese email pero usando otro método. Usá el mismo método con el que te registraste.';
  if (error === 'OAuthSignin' || error === 'OAuthCallback')
    return 'Error al conectar con Google. Intentá de nuevo.';
  return 'Error al iniciar sesión. Intentá de nuevo.';
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const fakeGoogleEnabled = env.AUTH_FAKE_GOOGLE;

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo + nombre en línea */}
        <div className="flex items-center justify-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">RegWatch</h1>
          <svg
            width="56"
            height="56"
            viewBox="0 0 44 44"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            {/* Ojo: dos arcos simétricos */}
            <path
              d="M3 22 C 9 11, 35 11, 41 22"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M3 22 C 9 33, 35 33, 41 22"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              fill="none"
            />
            {/* Iris */}
            <circle cx="22" cy="22" r="6" stroke="currentColor" strokeWidth="2.25" fill="none" />
            {/* Pupila */}
            <circle cx="22" cy="22" r="2.25" fill="currentColor" />
            {/* Línea de medición / pulso atravesando — asimétrico, tipo ECG real */}
            <path
              d="M0 22 L11 22 L13 20 L15 24 L17 22 L19 12 L21 30 L23 22 L26 22 L28 19 L30 22 L44 22"
              stroke="#10b981"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>
        <p className="text-muted-foreground -mt-9 text-center text-sm">
          Monitoreo regulatorio inteligente
        </p>

        {/* Error */}
        {error ? (
          <p
            role="alert"
            data-testid="login-error"
            className="text-center text-sm text-red-600 dark:text-red-400"
          >
            {errorMessage(error)}
          </p>
        ) : null}

        {/* Card de login */}
        <LoginCard googleAction={googleSignInAction} magicLinkAction={magicLinkSignInAction} />

        {/* Dev: fake google — solo visible en dev */}
        {fakeGoogleEnabled ? (
          <div className="border-border rounded-lg border border-dashed p-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
              Dev — fake Google
            </p>
            <form action={fakeGoogleSignInAction} className="flex gap-2">
              <input
                id="fakeEmail"
                name="fakeEmail"
                type="email"
                required
                placeholder="dev@regwatch.local"
                data-testid="fake-google-email"
                className="border-input bg-background focus-visible:ring-ring h-9 flex-1 rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
              />
              <Button type="submit" variant="ghost" size="sm" data-testid="fake-google-signin">
                Entrar
              </Button>
            </form>
          </div>
        ) : null}

        <p className="text-muted-foreground text-center text-xs">
          Al continuar aceptás los términos de uso y la política de privacidad.
        </p>
      </div>
    </main>
  );
}
