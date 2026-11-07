import { useState } from 'react';
import { create } from 'zustand';
import { Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { userApi } from '@/api/endpoints';
import type { TierId } from '@/api/types';
import { LeadForm } from '@/components/LeadForm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { TRIAL_DAYS, tierInfo } from '@/lib/tiers';
import { useAuth } from '@/store/useAuth';

interface UpgradeState {
  open: boolean;
  /** Why it opened: «Автозагрузка доступна на тарифе «Профи»». */
  reason: string | null;
  /** Straight to the request form for this tier. */
  requestTier: TierId | null;
  show(reason?: string, requestTier?: TierId): void;
  close(): void;
}

export const useUpgrade = create<UpgradeState>()((set) => ({
  open: false,
  reason: null,
  requestTier: null,
  show: (reason, requestTier) => set({ open: true, reason: reason ?? null, requestTier: requestTier ?? null }),
  close: () => set({ open: false }),
}));

/** Feature or limit of «Профи» behind a paywall: start the trial or ask the team to connect it. */
export function UpgradeDialog() {
  const { open, reason, requestTier, close } = useUpgrade();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [requesting, setRequesting] = useState<TierId | null>(null);
  const [pending, setPending] = useState(false);
  const sub = user?.subscription;
  const pro = tierInfo('pro');
  const form = requesting ?? requestTier;

  const startTrial = async () => {
    setPending(true);
    try {
      setUser(await userApi.startTrial());
      toast.success(`«Профи» подключён на ${TRIAL_DAYS} дней`);
      close();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          close();
          setRequesting(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            {form === 'custom' ? 'Индивидуальные условия' : `Тариф «${pro.name}»`}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {form
              ? 'Оставьте контакты — подключим тариф и ответим на вопросы.'
              : (reason ?? 'Снимите ограничения тарифа «Старт».')}
          </DialogDescription>
        </DialogHeader>

        {form ? (
          <LeadForm
            tier={form}
            defaults={{ name: user?.displayName, email: user?.email }}
            submitLabel="Отправить заявку"
            messagePlaceholder={form === 'custom' ? 'Объёмы, сколько пользователей, сроки' : 'Удобный способ оплаты, вопросы'}
          />
        ) : (
          <>
            <ul className="grid gap-2 rounded-xl bg-muted/60 p-4 text-sm">
              {pro.features.slice(0, 5).map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              {sub?.trialAvailable ? (
                <Button size="lg" className="sm:flex-1" onClick={() => void startTrial()} disabled={pending}>
                  {pending && <Spinner />}
                  Попробовать {TRIAL_DAYS} дней бесплатно
                </Button>
              ) : (
                <Button size="lg" className="sm:flex-1" onClick={() => setRequesting('pro')}>
                  Подключить «{pro.name}»
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={() => setRequesting('custom')}>
                Индивидуальные условия
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Marks a feature of «Профи» on tiers without it. */
export function ProBadge() {
  return (
    <span className="ml-auto inline-flex h-4.5 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
      Профи
    </span>
  );
}
