import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  CircleHelp,
  CloudCheck,
  CloudOff,
  Download,
  Ellipsis,
  Eye,
  FileText,
  FileUp,
  FolderOpen,
  Package,
  Pencil,
  Redo2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Units } from '../core/units';
import { createDemoPlan, exportPlan, useStore } from '../store/useStore';
import { useUi } from '../store/useUi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { timeAgo } from '@/lib/format';
import { downloadPlan, readPlanFile } from '@/lib/planFiles';
import { cn } from '@/lib/utils';
import { useMediaQuery, usePlacements } from './hooks';
import { flush, renamePlan, usePlanSync } from './planSync';

export function EditorHeader() {
  const navigate = useNavigate();
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const itemCount = useStore((s) => s.items.length);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const panelHidden = useUi((s) => s.panelHidden);
  const setPanelHidden = useUi((s) => s.setPanelHidden);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const desktop = useMediaQuery('(min-width: 768px)');
  const replace = useReplaceFromFile();
  const panelShown = desktop && !panelHidden;

  const leave = async () => {
    await flush();
    const { status, error } = usePlanSync.getState();
    if (status === 'saved') navigate('/');
    else toast.error('Изменения ещё не сохранены', { description: error ?? 'Попробуйте ещё раз через пару секунд' });
  };

  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-1 border-b bg-card px-1.5">
      <IconTip label="Все схемы">
        <Button variant="ghost" size="icon-lg" onClick={() => void leave()} aria-label="Все схемы">
          <ArrowLeft className={ICON} />
        </Button>
      </IconTip>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <PlanName />
        <SaveIndicator />
      </div>

      <div className="flex shrink-0 items-center gap-px">
        <IconTip label="Отменить" keys="Ctrl+Z">
          <Button variant="ghost" size="icon-lg" disabled={!canUndo} onClick={undo} aria-label="Отменить">
            <Undo2 className={ICON} />
          </Button>
        </IconTip>
        <IconTip label="Повторить" keys="Ctrl+Y">
          <Button variant="ghost" size="icon-lg" disabled={!canRedo} onClick={redo} aria-label="Повторить">
            <Redo2 className={ICON} />
          </Button>
        </IconTip>
        <div className="hidden items-center gap-px sm:flex">
          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
          <DisplayMenu />
          <FileMenu onReplace={replace.open} />
          <IconTip label="Управление и клавиши">
            <Button variant="ghost" size="icon-lg" onClick={() => setHelpOpen(true)} aria-label="Справка">
              <CircleHelp className={ICON} />
            </Button>
          </IconTip>
        </div>
        <div className="sm:hidden">
          <MoreMenu onReplace={replace.open} onHelp={() => setHelpOpen(true)} />
        </div>
        {replace.input}
        <Button
          variant={panelShown ? 'secondary' : 'outline'}
          className="ml-1 h-9 gap-1.5 px-2.5"
          onClick={() => (desktop ? setPanelHidden(!panelHidden) : setDrawerOpen(true))}
          aria-pressed={desktop ? panelShown : undefined}
          aria-label="Панель грузов"
        >
          <Package className={ICON} />
          <span className="hidden sm:inline">Грузы</span>
          <Badge variant="outline" className="h-5 min-w-5 bg-background px-1.5 tabular-nums">
            {itemCount}
          </Badge>
        </Button>
      </div>
    </header>
  );
}

/** Header icons are a bit larger than the default 16 px. */
const ICON = 'size-[18px]';

function IconTip({ label, keys, children }: { label: string; keys?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function PlanName() {
  const name = usePlanSync((s) => s.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim().slice(0, 200);
    if (trimmed && trimmed !== name) renamePlan(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="h-9 w-full max-w-xs min-w-0 rounded-md border border-ring bg-background px-2 text-[15px] font-semibold ring-3 ring-ring/30 outline-none"
        value={draft}
        maxLength={200}
        aria-label="Название схемы"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="group/name flex h-9 min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[15px] font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      title="Переименовать"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
    >
      <span className="truncate">{name}</span>
      <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
    </button>
  );
}

function SaveIndicator() {
  const status = usePlanSync((s) => s.status);
  const savedAt = usePlanSync((s) => s.savedAt);
  const error = usePlanSync((s) => s.error);

  const view = {
    saved: { icon: <CloudCheck />, text: 'Сохранено', tip: savedAt ? `Сохранено ${timeAgo(savedAt)}` : 'Сохранено', tone: '' },
    pending: { icon: <CloudCheck className="opacity-50" />, text: 'Изменено', tip: 'Сохранится через секунду', tone: '' },
    saving: { icon: <Spinner />, text: 'Сохранение…', tip: 'Сохраняем изменения', tone: '' },
    error: { icon: <CloudOff />, text: 'Не сохранено', tip: error ?? 'Ошибка сохранения', tone: 'text-destructive' },
    conflict: { icon: <TriangleAlert />, text: 'Конфликт версий', tip: 'Схему изменили в другом месте', tone: 'text-warning' },
  }[status];

  return (
    <div className={cn('flex shrink-0 items-center gap-1 text-xs text-muted-foreground', view.tone)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 rounded-md px-1.5 py-1 [&_svg]:size-4" tabIndex={0} aria-live="polite">
            {view.icon}
            <span className="hidden md:inline">{view.text}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{view.tip}</TooltipContent>
      </Tooltip>
      {status === 'error' && (
        <Button variant="ghost" size="xs" onClick={() => void flush()} className="text-destructive">
          <RefreshCw /> Повторить
        </Button>
      )}
    </div>
  );
}

const UNITS: Array<{ value: Units; label: string }> = [
  { value: 'mm', label: 'Миллиметры' },
  { value: 'cm', label: 'Сантиметры' },
  { value: 'm', label: 'Метры' },
];

type Toggle = 'showDimensions' | 'showLabels' | 'highlightOverflow' | 'snapping' | 'resizeHandles';

const keepOpen = (e: Event) => e.preventDefault();

function useOverflowCount(): number {
  const placements = usePlacements();
  return [...placements.values()].filter((p) => p.status === 'overflow').length;
}

/** Display toggles and units: the "Вид" menu on desktop, a submenu of "⋯" on phones. */
function DisplayItems() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const overflow = useOverflowCount();

  const toggle = (key: Toggle, label: string, extra?: React.ReactNode) => (
    <DropdownMenuCheckboxItem checked={settings[key]} onSelect={keepOpen} onCheckedChange={(v) => setSetting(key, v)}>
      {label}
      {extra}
    </DropdownMenuCheckboxItem>
  );

  return (
    <>
      <DropdownMenuLabel>Отображение</DropdownMenuLabel>
      {toggle('showDimensions', 'Размерные линии')}
      {toggle('showLabels', 'Номера на грузах')}
      {toggle(
        'highlightOverflow',
        'Подсвечивать выходы за грани',
        overflow > 0 && (
          <Badge variant="destructive" className="ml-auto h-5 px-1.5 tabular-nums">
            {overflow}
          </Badge>
        ),
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Перемещение</DropdownMenuLabel>
      {toggle('snapping', 'Магнитная привязка')}
      {toggle('resizeHandles', 'Ручки изменения размера')}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Единицы</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={settings.units} onValueChange={(v) => setSetting('units', v as Units)}>
        {UNITS.map((u) => (
          <DropdownMenuRadioItem key={u.value} value={u.value} onSelect={keepOpen}>
            {u.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function OverflowDot() {
  const overflow = useOverflowCount();
  const highlight = useStore((s) => s.settings.highlightOverflow);
  if (overflow === 0 || !highlight) return null;
  return <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-card" />;
}

function DisplayMenu() {
  return (
    <DropdownMenu>
      <IconTip label="Вид и привязка">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label="Вид и привязка" className="relative">
            <Eye className={ICON} />
            <OverflowDot />
          </Button>
        </DropdownMenuTrigger>
      </IconTip>
      <DropdownMenuContent align="end" className="w-64">
        <DisplayItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileItems({ onReplace }: { onReplace(): void }) {
  const loadPlan = useStore((s) => s.loadPlan);
  const setPdfOpen = useUi((s) => s.setPdfOpen);
  return (
    <>
      <DropdownMenuItem onSelect={() => setPdfOpen(true)}>
        <FileText /> Экспорт в PDF…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => downloadPlan(usePlanSync.getState().name, exportPlan(useStore.getState()))}>
        <Download /> Скачать JSON
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onReplace}>
        <FileUp /> Заменить из JSON…
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          loadPlan(createDemoPlan());
          toast('Загружен пример', { description: 'Отменить — Ctrl+Z' });
        }}
      >
        <Sparkles /> Загрузить пример
      </DropdownMenuItem>
    </>
  );
}

function FileMenu({ onReplace }: { onReplace(): void }) {
  return (
    <DropdownMenu>
      <IconTip label="Файл">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label="Файл">
            <FolderOpen className={ICON} />
          </Button>
        </DropdownMenuTrigger>
      </IconTip>
      <DropdownMenuContent align="end" className="w-60">
        <FileItems onReplace={onReplace} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones: "Вид", "Файл" and help in one menu, so the plan name keeps its room. */
function MoreMenu({ onReplace, onHelp }: { onReplace(): void; onHelp(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label="Ещё" className="relative">
          <Ellipsis className={ICON} />
          <OverflowDot />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Eye /> Вид и привязка
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DisplayItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <FileItems onReplace={onReplace} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onHelp}>
          <CircleHelp /> Управление
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hidden file input for "Заменить из JSON…": replaces the plan as one undoable step. */
function useReplaceFromFile() {
  const loadPlan = useStore((s) => s.loadPlan);
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="application/json,.json"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          loadPlan((await readPlanFile(file)).plan);
          toast.success('План загружен из файла', { description: 'Отменить — Ctrl+Z' });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Не удалось прочитать файл');
        }
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}
