import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

import '../styles/app.css';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent
});

function RootComponent() {
  return <Outlet />;
}
