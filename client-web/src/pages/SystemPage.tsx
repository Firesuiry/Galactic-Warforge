import { lazy, Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { StarmapView } from '@/features/starmap/StarmapView';
const SystemOrbitView=lazy(()=>import('@/features/system-three/SystemOrbitView').then(m=>({default:m.SystemOrbitView})));

export function SystemPage() {
  const { systemId = '' } = useParams();
  const [params]=useSearchParams();
  return params.get('view')==='2d' ? <StarmapView key={systemId} initialSystemId={systemId}/> : <Suspense fallback={<div className="panel">正在加载恒星系...</div>}><SystemOrbitView key={systemId} systemId={systemId}/></Suspense>;
}
