import { useSearchParams } from 'react-router-dom';

import { usePageAmbient } from '@/features/audio/use-page-ambient';
import { StarmapView } from '@/features/starmap/StarmapView';

export function GalaxyPage() {
  const [params] = useSearchParams();
  // 银河页也是太空视角：给轨道低频声床（与恒星系页同一路）。
  usePageAmbient({ page: 'system', frozen: params.has('freeze') });
  return <StarmapView />;
}
