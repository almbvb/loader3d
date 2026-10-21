import { useState, type FormEvent } from 'react';
import { Box, Camera, Container, FileDown, FileText, ListOrdered, RectangleHorizontal, RectangleVertical, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { LoadDirection } from '../core/loadingOrder';
import type { PdfMode, PdfOptions } from '../pdf/exportPdf';
import type { PdfOrientation } from '../pdf/document';
import type { Projection } from '../pdf/snapshot';
import { exportPlan, useStore } from '../store/useStore';
import { useUi } from '../store/useUi';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { usePlanSync } from './planSync';

const ORIENTATIONS: Array<{ value: PdfOrientation; label: string; icon: typeof RectangleHorizontal }> = [
  { value: 'landscape', label: 'Альбомная', icon: RectangleHorizontal },
  { value: 'portrait', label: 'Книжная', icon: RectangleVertical },
];

const MODES: Array<{ value: PdfMode; label: string; hint: string }> = [
  { value: 'overview', label: 'Общий обзор', hint: 'Виды сверху и сбоку, список мест, итог и развесовка.' },
  { value: 'steps', label: 'Пошаговая инструкция', hint: 'То же, и порядок загрузки: картинка на каждый шаг.' },
];

const DIRECTIONS: Array<{ value: LoadDirection; label: string }> = [
  { value: 'rear', label: 'Сзади' },
  { value: 'right', label: 'Сбоку справа' },
  { value: 'left', label: 'Сбоку слева' },
  { value: 'top', label: 'Сверху' },
];

const PROJECTIONS: Array<{ value: Projection; label: string; hint: string }> = [
  { value: 'orthographic', label: 'Ортографическая', hint: 'Как чертёж: без искажений, с линейками.' },
  { value: 'perspective', label: 'Перспективная', hint: 'Объёмно, как на сцене.' },
];

/** File → «Экспорт в PDF…»: report options, then the PDF is built in the browser and downloaded. */
export function PdfExportDialog() {
  const open = useUi((s) => s.pdfOpen);
  const setOpen = useUi((s) => s.setPdfOpen);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" showCloseButton={!busy}>
        {open && <PdfForm busy={busy} setBusy={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}

function PdfForm({ busy, setBusy }: { busy: boolean; setBusy(busy: boolean): void }) {
  const setOpen = useUi((s) => s.setPdfOpen);
  const saved = useUi((s) => s.pdfOptions);
  const setSaved = useUi((s) => s.setPdfOptions);
  const [fileName, setFileName] = useState(() => usePlanSync.getState().name);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const vehicles = useStore((s) => s.vehicles);
  /** A vehicle id, or 'all'. */
  const [scope, setScope] = useState(() => useStore.getState().activeVehicleId);
  const { orientation, mode, direction, projection } = saved;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const options: PdfOptions = { ...saved, fileName: fileName.trim() };
    setBusy(true);
    setProgress(null);
    try {
      const { exportPdf } = await import('../pdf/exportPdf');
      const state = useStore.getState();
      await exportPdf(
        {
          name: usePlanSync.getState().name,
          plan: exportPlan(state),
          vehicleIds: scope === 'all' ? state.vehicles.map((v) => v.id) : [scope],
          units: state.settings.units,
          highlightOverflow: state.settings.highlightOverflow,
        },
        options,
        (done, total) => setProgress({ done, total }),
      );
      setOpen(false);
      toast.success('PDF готов', { description: 'Файл сохранён в загрузки' });
    } catch (error) {
      console.error(error);
      toast.error('Не удалось создать PDF', {
        description: error instanceof Error && /webgl/i.test(error.message) ? 'Браузер не дал нарисовать 3D-виды (WebGL)' : 'Попробуйте ещё раз',
      });
    } finally {
      setBusy(false);
    }
  };

  const label = (Icon: typeof FileText, text: string, htmlFor: string) => (
    <FieldLabel htmlFor={htmlFor} className="items-center">
      <Icon className="size-4 text-muted-foreground" />
      {text}
    </FieldLabel>
  );

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Экспорт в PDF</DialogTitle>
        <DialogDescription>План загрузки для водителя и склада: виды, список мест и итоги.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field>
          {label(FileText, 'Имя файла', 'pdf-name')}
          <InputGroup>
            <InputGroupInput
              id="pdf-name"
              value={fileName}
              maxLength={200}
              disabled={busy}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setFileName(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>.pdf</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Field>

        {vehicles.length > 1 && (
          <Field>
            {label(Container, 'Машина', 'pdf-vehicle')}
            <Select value={scope} disabled={busy} onValueChange={setScope}>
              <SelectTrigger id="pdf-vehicle" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
                <SelectItem value="all">Все машины — каждая с новой страницы</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field>
          {label(orientation === 'landscape' ? RectangleHorizontal : RectangleVertical, 'Ориентация', 'pdf-orientation')}
          <Select value={orientation} disabled={busy} onValueChange={(v) => setSaved({ orientation: v as PdfOrientation })}>
            <SelectTrigger id="pdf-orientation" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORIENTATIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <o.icon className="text-muted-foreground" />
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            {label(ListOrdered, 'Режим экспорта', 'pdf-mode')}
            <Select value={mode} disabled={busy} onValueChange={(v) => setSaved({ mode: v as PdfMode })}>
              <SelectTrigger id="pdf-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field data-disabled={mode !== 'steps' || undefined}>
            {label(Truck, 'Направление загрузки', 'pdf-direction')}
            <Select
              value={direction}
              disabled={busy || mode !== 'steps'}
              onValueChange={(v) => setSaved({ direction: v as LoadDirection })}
            >
              <SelectTrigger id="pdf-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FieldDescription className="-mt-2 sm:col-span-2">{MODES.find((m) => m.value === mode)?.hint}</FieldDescription>
        </div>

        <Field>
          {label(projection === 'orthographic' ? Box : Camera, 'Тип камеры', 'pdf-camera')}
          <Select value={projection} disabled={busy} onValueChange={(v) => setSaved({ projection: v as Projection })}>
            <SelectTrigger id="pdf-camera" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{PROJECTIONS.find((p) => p.value === projection)?.hint}</FieldDescription>
        </Field>
      </FieldGroup>

      {busy && (
        <div className="space-y-1.5" aria-live="polite">
          <Progress value={progress ? (progress.done / progress.total) * 100 : 0} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {!progress
              ? 'Готовим…'
              : progress.done < progress.total
                ? `Рисуем виды: ${progress.done} из ${progress.total}`
                : 'Собираем PDF…'}
          </p>
        </div>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Отмена
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : <FileDown />}
          Создать PDF
        </Button>
      </DialogFooter>
    </form>
  );
}
