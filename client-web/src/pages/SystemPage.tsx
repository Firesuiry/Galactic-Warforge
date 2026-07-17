import { useParams } from 'react-router-dom';

import { StarmapView } from '@/features/starmap/StarmapView';

export function SystemPage() {
  const { systemId = '' } = useParams();
  return <StarmapView key={systemId} initialSystemId={systemId} />;
}
