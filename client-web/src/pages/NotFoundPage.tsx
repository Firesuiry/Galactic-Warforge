import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="panel">
      <div className="page-header">
        <h1>页面不存在</h1>
        <p className="subtle-text">请返回总览继续操作。</p>
      </div>
      <Link className="primary-link" to="/overview">返回总览</Link>
    </div>
  );
}
