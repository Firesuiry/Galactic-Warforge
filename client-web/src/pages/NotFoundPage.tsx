import { useNavigate } from 'react-router-dom';

import { Button } from '@/common/controls';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="notfound-page">
      <section className="panel notfound-panel">
        <p className="notfound-code">404</p>
        <div className="page-header">
          <h1>页面不存在</h1>
          <p className="subtle-text">星图上没有这条航线，请返回总览继续指挥。</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/overview')}>
          返回总览
        </Button>
      </section>
    </div>
  );
}
