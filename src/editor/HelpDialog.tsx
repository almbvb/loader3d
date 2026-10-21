import { Hand, Keyboard, MousePointer2 } from 'lucide-react';
import { useUi } from '../store/useUi';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

type Row = [keys: string, action: string];

const SECTIONS: Array<{ title: string; icon: typeof Hand; rows: Row[]; kbd?: boolean }> = [
  {
    title: 'Мышь',
    icon: MousePointer2,
    rows: [
      ['Тянуть по пустому месту', 'Вращение сцены'],
      ['Тянуть по грузу', 'Перемещение груза вместе со стопкой на нём'],
      ['Alt + тянуть по грузу', 'Взять только этот груз'],
      ['Shift при перетаскивании', 'Временно без магнитов'],
      ['Правая кнопка / колесо', 'Панорама / масштаб'],
      ['Двойной клик по грузу', 'Приблизить камеру к грузу'],
      ['Стрелки на гранях груза', 'Изменить размер (тянуть)'],
      ['Табличка над кабиной', 'Перейти к этой машине (когда машин несколько)'],
    ],
  },
  {
    title: 'Планшет',
    icon: Hand,
    rows: [
      ['Один палец по фону', 'Вращение сцены'],
      ['Палец на грузе', 'Перемещение груза'],
      ['Два пальца', 'Масштаб и панорама'],
      ['Двойной тап по грузу', 'Приблизить камеру'],
    ],
  },
  {
    title: 'Клавиатура (выбран груз)',
    icon: Keyboard,
    kbd: true,
    rows: [
      ['R', 'Повернуть на 90° вокруг вертикали'],
      ['X / Y / Z', 'Повернуть вокруг оси X / Y / Z (с включённым «Кантованием»)'],
      ['Del', 'Удалить'],
      ['Ctrl+D', 'Дублировать'],
      ['← ↑ → ↓', 'Сдвиг на 1 см (с Shift — 10 см) относительно камеры'],
      ['F', 'Показать груз'],
      ['Ctrl+Z', 'Отменить'],
      ['Ctrl+Y', 'Повторить'],
      ['Esc', 'Отменить перетаскивание или снять выделение'],
    ],
  },
];

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Управление</DialogTitle>
          <DialogDescription className="text-pretty">
            Режимы не переключаются: нажали на пустое место — вращаете сцену, нажали на груз — двигаете груз. Грузы не
            висят в воздухе и не пересекаются: при перетаскивании они встают на пол или сверху на другие грузы и
            притягиваются к граням соседей и стенкам кузова. Грузы, которые закрывают обзор, можно сделать прозрачными —
            кнопка с глазом над сценой; нажатие на прозрачный груз берёт тот, что виден за ним.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          {SECTIONS.map(({ title, icon: Icon, rows, kbd }) => (
            <section key={title} className={kbd ? 'md:col-span-2' : undefined}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4 text-primary" /> {title}
              </h3>
              <dl className={kbd ? 'grid gap-x-6 gap-y-1.5 sm:grid-cols-2' : 'space-y-1.5'}>
                {rows.map(([keys, action]) => (
                  <div key={keys} className="flex items-baseline gap-3 text-sm">
                    <dt className={kbd ? 'w-24 shrink-0' : 'w-44 shrink-0 text-muted-foreground'}>
                      {kbd ? <Kbd>{keys}</Kbd> : keys}
                    </dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
