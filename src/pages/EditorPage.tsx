import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, FileQuestion, RefreshCw } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { planApi } from '@/api/endpoints';
import { FullScreenLoader } from '@/components/RouteGuards';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { AutoloadDialog } from '@/editor/AutoloadDialog';
import { CargoPanel } from '@/editor/CargoPanel';
import { ConflictDialog } from '@/editor/ConflictDialog';
import { EditorHeader } from '@/editor/EditorHeader';
import { HelpDialog } from '@/editor/HelpDialog';
import { PdfExportDialog } from '@/editor/PdfExportDialog';
import { Viewport } from '@/editor/Viewport';
import { guardSceneShortcuts, useMediaQuery } from '@/editor/hooks';
import { flush, hasUnsavedChanges, startSync, stopSync, usePlanSync } from '@/editor/planSync';
import { useStore } from '@/store/useStore';
import { useUi } from '@/store/useUi';

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: unknown };

const DEFAULT_TITLE = document.title;

/** /plans/:planId — loads the plan into the store, then mounts the 3D editor around it. */
export function EditorPage() {
  const { planId = '' } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    planApi
      .get(planId)
      .then((record) => {
        if (cancelled) return;
        useStore.getState().openPlan(record.data);
        useUi.setState({ drawerOpen: false, autoloadOpen: false, pdfOpen: false });
        startSync(record);
        setState({ status: 'ready' });
      })
      .catch((error) => !cancelled && setState({ status: 'error', error }));
    return () => {
      cancelled = true;
      void flush();
      stopSync();
    };
  }, [planId, attempt]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      void flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const name = usePlanSync((s) => s.name);
  useEffect(() => {
    document.title = state.status === 'ready' && name ? `${name} — Loader3D` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [name, state.status]);

  if (state.status === 'loading') return <FullScreenLoader label="Открываем схему…" />;
  if (state.status === 'error') {
    const missing = state.error instanceof ApiError && state.error.status === 404;
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestion />
            </EmptyMedia>
            <EmptyTitle>{missing ? 'Схема не найдена' : 'Не удалось открыть схему'}</EmptyTitle>
            <EmptyDescription>
              {missing ? 'Возможно, её удалили или ссылка неверна.' : errorMessage(state.error)}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" asChild>
              <Link to="/">
                <ArrowLeft /> Все схемы
              </Link>
            </Button>
            {!missing && (
              <Button onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw /> Повторить
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return <EditorLayout />;
}

/** Width of the floating cargo panel and its distance from the edges, px. */
const PANEL_WIDTH = 360;
const PANEL_GAP = 12;

function EditorLayout() {
  const desktop = useMediaQuery('(min-width: 768px)');
  const panelHidden = useUi((s) => s.panelHidden);
  const setPanelHidden = useUi((s) => s.setPanelHidden);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const floating = desktop && !panelHidden;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-scene" onKeyDown={guardSceneShortcuts}>
      <EditorHeader />
      <div className="relative min-h-0 flex-1">
        <Viewport rightInset={floating ? PANEL_WIDTH + PANEL_GAP : 0} />
        {floating && (
          <aside
            className="absolute z-10 flex flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-xl shadow-foreground/10 backdrop-blur-md"
            style={{ top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, width: PANEL_WIDTH }}
          >
            <CargoPanel onHide={() => setPanelHidden(true)} />
          </aside>
        )}
        {!desktop && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
              <SheetTitle className="sr-only">Грузы</SheetTitle>
              <SheetDescription className="sr-only">Добавление грузов, автозагрузка и список</SheetDescription>
              <div className="min-h-0 flex-1 pt-8">
                <CargoPanel />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
      <HelpDialog />
      <AutoloadDialog />
      <PdfExportDialog />
      <ConflictDialog />
    </div>
  );
}
