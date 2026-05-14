/**
 * Verify-request page — `/verify-request`.
 *
 * Pantalla que NextAuth muestra después de enviar el magic link.
 * Reemplaza la pantalla nativa de NextAuth (`/api/auth/verify-request`).
 * Spec: auth-foundation § auth (R "Magic Link Sign-in").
 */
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function VerifyRequestPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo + nombre */}
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
            <circle cx="22" cy="22" r="6" stroke="currentColor" strokeWidth="2.25" fill="none" />
            <circle cx="22" cy="22" r="2.25" fill="currentColor" />
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

        {/* Card */}
        <div className="border-border bg-card space-y-5 rounded-xl border p-6 text-center shadow-sm">
          {/* Ícono de email */}
          <div className="flex justify-center">
            <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Revisá tu email</h2>
            <p className="text-muted-foreground text-sm">
              Te enviamos un link de acceso. Hacé click en él para ingresar.
            </p>
            <p className="text-muted-foreground text-xs">
              El link expira en 24 horas. Si no lo ves, revisá la carpeta de spam.
            </p>
          </div>
        </div>

        <div className="text-center">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Volver al inicio de sesión</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
