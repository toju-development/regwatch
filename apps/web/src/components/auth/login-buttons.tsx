'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoginCardProps {
  googleAction: () => Promise<void>;
  magicLinkAction: (formData: FormData) => Promise<void>;
}

export function LoginCard({ googleAction, magicLinkAction }: LoginCardProps) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="border-border bg-card space-y-5 rounded-xl border p-6 shadow-sm">
      {/* Google */}
      <form
        action={() => {
          startTransition(() => googleAction());
        }}
      >
        <Button
          type="submit"
          variant="outline"
          className="w-full gap-3"
          disabled={pending}
          data-testid="google-signin"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"
                fill="#EA4335"
              />
            </svg>
          )}
          {pending ? 'Redirigiendo...' : 'Continuar con Google'}
        </Button>
      </form>

      {/* Separador */}
      <div className="flex items-center gap-3">
        <span className="border-border h-px flex-1 border-t" />
        <span className="text-muted-foreground whitespace-nowrap text-xs">o ingresá con email</span>
        <span className="border-border h-px flex-1 border-t" />
      </div>

      {/* Magic Link */}
      <form
        action={(formData) => {
          startTransition(() => magicLinkAction(formData));
        }}
        className="space-y-3"
      >
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="tu@email.com"
          data-testid="magic-link-email"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
        />
        <Button
          type="submit"
          className="w-full gap-2"
          disabled={pending}
          data-testid="magic-link-submit"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? 'Enviando...' : 'Enviarme un enlace'}
        </Button>
      </form>
    </div>
  );
}
