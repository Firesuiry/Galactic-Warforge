import { Link } from 'react-router-dom';

import type { WarCommandHint } from '@/features/war/error-hints';

export function WarFeedbackBanner({ feedback }: { feedback: WarCommandHint }) {
  return (
    <div className={`status-banner status-banner--${feedback.tone}`}>
      <strong>{feedback.title}</strong>
      {feedback.detail ? <span>{feedback.detail}</span> : null}
      {feedback.href ? <Link to={feedback.href}>查看结算</Link> : null}
    </div>
  );
}
