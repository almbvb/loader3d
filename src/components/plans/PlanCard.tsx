import { Copy, Download, Ellipsis, FolderOpen, Package, Pencil, Trash2, Truck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { planApi } from '@/api/endpoints';
import type { PlanSummary } from '@/api/types';
import { CARGO_COLORS } from '@/core/presets';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { fullDate, plural, timeAgo } from '@/lib/format';
import { downloadPlan } from '@/lib/planFiles';
import { useDuplicatePlan } from '@/lib/plansQuery';

/** A stable colour per plan, so cards are easy to tell apart. */
function planColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CARGO_COLORS[Math.abs(hash) % CARGO_COLORS.length];
}

interface PlanCardProps {
  plan: PlanSummary;
  onRename(plan: PlanSummary): void;
  onDelete(plan: PlanSummary): void;
}

export function PlanCard({ plan, onRename, onDelete }: PlanCardProps) {
  const navigate = useNavigate();
  const duplicate = useDuplicatePlan();
  const color = planColor(plan.id);
  const href = `/plans/${plan.id}`;

  const exportJson = async () => {
    try {
      const full = await planApi.get(plan.id);
      downloadPlan(full.name, full.data);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card className="group/plan relative gap-0 py-0 transition-shadow hover:shadow-lg hover:shadow-foreground/5 hover:ring-primary/35 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex items-start gap-3 p-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-lg"
          style={{ background: `color-mix(in oklab, ${color} 16%, white)`, color: `color-mix(in oklab, ${color} 80%, black)` }}
        >
          <Truck className="size-5" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate leading-snug font-medium">
            <Link to={href} className="outline-none after:absolute after:inset-0 after:rounded-xl" title={plan.name}>
              {plan.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground" title={`Изменено ${fullDate(plan.updatedAt)}`}>
            Изменено {timeAgo(plan.updatedAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-10 -mt-1 -mr-1 text-muted-foreground opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/plan:opacity-100 sm:focus-visible:opacity-100"
              aria-label="Действия со схемой"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => navigate(href)}>
              <FolderOpen /> Открыть
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename(plan)}>
              <Pencil /> Переименовать
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={duplicate.isPending}
              onSelect={() =>
                duplicate.mutate(plan, {
                  onSuccess: (copy) => toast.success(`Создана копия «${copy.name}»`),
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
            >
              <Copy /> Дублировать
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportJson()}>
              <Download /> Скачать JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(plan)}>
              <Trash2 /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-4 border-t bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Package className="size-3.5" />
          {plural(plan.itemCount, ['груз', 'груза', 'грузов'])}
        </span>
        <span className="flex items-center gap-1.5">
          <Truck className="size-3.5" />
          {plan.vehicleCount > 1 && `${plural(plan.vehicleCount, ['машина', 'машины', 'машин'])} · `}
          {plural(plan.bodyCount, ['кузов', 'кузова', 'кузовов'])}
        </span>
      </div>
    </Card>
  );
}

export function PlanCardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-4">
        <Skeleton className="size-11 rounded-lg" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
      <div className="border-t px-4 py-3">
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}
