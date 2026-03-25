import type { PropsWithChildren } from 'react';

import { Navigate, useLocation } from 'react-router-dom';

import { useHasSession } from '@/hooks/use-session';

export function RequireSession({ children }: PropsWithChildren) {
  const hasSession = useHasSession();
  const location = useLocation();

  if (!hasSession) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function OnlyGuests({ children }: PropsWithChildren) {
  const hasSession = useHasSession();

  if (hasSession) {
    return <Navigate to="/overview" replace />;
  }

  return children;
}
