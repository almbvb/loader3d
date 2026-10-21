import { ScanEye } from 'lucide-react';
import { XRAY_OPACITY_RANGE, useStore, type XrayMode } from '../store/useStore';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const XRAY_MODES: Array<{ value: XrayMode; label: string; hint: string }> = [
  { value: 'selection', label: 'Перед выбранным', hint: 'Грузы, которые закрывают выбранный, становятся прозрачными' },
  { value: 'auto', label: 'Все загораживающие', hint: 'Прозрачно всё, за чем спрятаны другие грузы' },
  { value: 'all', label: 'Все грузы', hint: 'Прозрачны все грузы, кроме выбранного' },
  { value: 'off', label: 'Выключена', hint: 'Все грузы непрозрачные' },
];

/** Camera toolbar button: see-through cargo mode and how faint it gets. */
export function XrayControl() {
  const mode = useStore((s) => s.settings.xray);
  const opacity = useStore((s) => s.settings.xrayOpacity);
  const setSetting = useStore((s) => s.setSetting);
  const [min, max] = XRAY_OPACITY_RANGE;
  const on = mode !== 'off';

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Прозрачность грузов"
              className={cn(on && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
            >
              <ScanEye />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Прозрачность грузов: {XRAY_MODES.find((m) => m.value === mode)?.label.toLowerCase()}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Прозрачность грузов</PopoverTitle>
          <PopoverDescription>Грузы, которые закрывают обзор, видно насквозь.</PopoverDescription>
        </PopoverHeader>
        <div className="-mx-1 flex flex-col gap-0.5" role="radiogroup" aria-label="Режим прозрачности">
          {XRAY_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setSetting('xray', m.value)}
              className={cn(
                'flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                mode === m.value && 'bg-primary/10 hover:bg-primary/10',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                  mode === m.value ? 'border-primary' : 'border-input',
                )}
              >
                {mode === m.value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={cn('space-y-2', !on && 'opacity-50')}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-muted-foreground">Плотность прозрачных</span>
            <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
          </div>
          <Slider
            min={min}
            max={max}
            step={0.01}
            value={[opacity]}
            disabled={!on}
            onValueChange={([v]) => setSetting('xrayOpacity', v)}
            aria-label="Плотность прозрачных грузов"
          />
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          Нажатие на прозрачный груз берёт тот, что виден за ним. С несколькими машинами грузы соседних машин, закрывающие
          выбранную, тоже становятся прозрачными.
        </p>
      </PopoverContent>
    </Popover>
  );
}
