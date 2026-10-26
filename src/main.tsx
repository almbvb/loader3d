import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api/client';
import { App } from './App';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { useAuth } from './store/useAuth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx will not get better by repeating it.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

// Cached responses belong to the account that fetched them: none of them may survive a logout, a lost
// session or a login as someone else.
useAuth.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) queryClient.clear();
});
void useAuth.getState().bootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider delayDuration={300}>
          <App />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
