import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from '@/app/routes';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
