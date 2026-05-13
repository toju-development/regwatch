/**
 * `<LogoutButton>` — affordance de cierre de sesión con confirmación.
 *
 * Muestra un botón "Cerrar sesión" en el header. Al hacer clic abre un
 * `<Dialog>` de confirmación en español antes de llamar a `signOut()` de
 * NextAuth. Esto reemplaza la pantalla de confirmación nativa de NextAuth
 * (`/api/auth/signout`) que no está localizada ni alineada con el diseño
 * de RegWatch.
 *
 * Patrón de diseño:
 *   - `<Dialog>` (no `AlertDialog` — no está instalado en components/ui/).
 *   - Botón de confirmación destructivo, igual que `<LeaveOrgButton>`.
 *   - Estado de carga en el botón de confirmación mientras `signOut` procesa.
 *
 * `signOut` de NextAuth redirige a `/login` por defecto (callbackUrl=/login).
 * Pasamos `redirectTo: '/login'` explícitamente para garantizar el destino.
 *
 * NO `pnpm build` después de cambios (regla del proyecto).
 */
'use client';

import { useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function LogoutButton(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm(): void {
    startTransition(async () => {
      await signOut({ redirectTo: '/login' });
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="logout-button"
        className="text-muted-foreground hover:text-foreground gap-1.5"
      >
        <LogOut className="size-4" aria-hidden />
        <span className="hidden sm:inline">Cerrar sesión</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="logout-dialog">
          <DialogHeader>
            <DialogTitle>¿Cerrar sesión?</DialogTitle>
            <DialogDescription>
              Tu sesión se cerrará y serás redirigido a la pantalla de inicio de sesión.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
              data-testid="logout-dialog-cancel"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={handleConfirm}
              data-testid="logout-dialog-confirm"
            >
              {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
