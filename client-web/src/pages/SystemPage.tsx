import { lazy, Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { StarmapView } from '@/features/starmap/StarmapView';
import { usePageAmbient } from '@/features/audio/use-page-ambient';
const SystemOrbitView=lazy(()=>import('@/features/system-three/SystemOrbitView').then(m=>({default:m.SystemOrbitView})));

export function SystemPage() {
  const { systemId = '' } = useParams();
  const [params]=useSearchParams();
  // 恒星系页声床：轨道低频（离开行星页后由页面级 hook 接管，1.5s 交叉淡化）。
  usePageAmbient({ page: 'system', frozen: params.has('freeze') });
  return params.get('view')==='2d' ? <StarmapView key={systemId} initialSystemId={systemId}/> : <Suspense fallback={<div className="panel">正在加载恒星系...</div>}><SystemOrbitView key={systemId} systemId={systemId}/></Suspense>;
}
