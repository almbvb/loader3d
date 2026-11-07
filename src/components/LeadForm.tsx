import { useState, type FormEvent } from 'react';
import { CircleCheck } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { leadApi } from '@/api/endpoints';
import type { TierId } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface LeadFormProps {
  tier?: TierId;
  /** Prefilled for a logged-in user. */
  defaults?: { name?: string; email?: string };
  messagePlaceholder?: string;
  submitLabel?: string;
  onSent?(): void;
  className?: string;
}

/**
 * A request to the team (admin panel → «Заявки»): the «Индивидуальный» tier, connecting «Профи»,
 * a demo. Plain state, no React Query: the landing page renders it on the server too.
 */
export function LeadForm({
  tier,
  defaults,
  messagePlaceholder = 'Сколько машин в день, какие грузы, что важно',
  submitLabel = 'Отправить заявку',
  onSent,
  className,
}: LeadFormProps) {
  const [name, setName] = useState(defaults?.name ?? '');
  const [email, setEmail] = useState(defaults?.email ?? '');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await leadApi.create({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        message: message.trim() || undefined,
        tier,
        website: website || undefined,
      });
      setSent(true);
      onSent?.();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
        const { '': general, ...fields } = err.fieldErrors;
        setFieldErrors(fields);
        if (general) setError(general);
      } else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <div className={cn('flex flex-col items-center gap-3 py-6 text-center', className)}>
        <CircleCheck className="size-10 text-success" />
        <p className="text-base font-semibold">Заявка отправлена</p>
        <p className="max-w-xs text-sm text-muted-foreground">Мы свяжемся с вами в течение рабочего дня.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={className} noValidate>
      <FieldGroup className="gap-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field data-invalid={!!fieldErrors.name}>
            <FieldLabel htmlFor="lead-name">Имя</FieldLabel>
            <Input id="lead-name" autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-company">Компания</FieldLabel>
            <Input id="lead-company" autoComplete="organization" value={company} maxLength={200} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field data-invalid={!!fieldErrors.email}>
            <FieldLabel htmlFor="lead-email">Email</FieldLabel>
            <Input id="lead-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
          </Field>
          <Field data-invalid={!!fieldErrors.phone}>
            <FieldLabel htmlFor="lead-phone">Телефон</FieldLabel>
            <Input id="lead-phone" type="tel" autoComplete="tel" placeholder="+7" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {fieldErrors.phone && <FieldError>{fieldErrors.phone}</FieldError>}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="lead-message">Задача</FieldLabel>
          <Textarea
            id="lead-message"
            rows={3}
            maxLength={2000}
            placeholder={messagePlaceholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {/* Honeypot: invisible to people, bots fill it in. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] size-px opacity-0"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={pending || !name.trim() || (!email.trim() && !phone.trim())}>
          {pending && <Spinner />}
          {submitLabel}
        </Button>
        <p className="text-xs text-muted-foreground">Ответим по email или телефону — что удобнее. Нужен хотя бы один контакт.</p>
      </FieldGroup>
    </form>
  );
}
