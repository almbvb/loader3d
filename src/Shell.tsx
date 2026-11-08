import { App } from './App';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';

/**
 * Everything inside the router and the query client. main.tsx renders it in the browser and
 * scripts/prerender.mjs on the server (the landing page), so the two trees match for hydration.
 */
export function Shell() {
  return (
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
