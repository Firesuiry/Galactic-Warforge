import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/common/Icon';
import { buildColonyProgression, type ProgressionInput } from './model';
import './progression.css';

export function ColonyProgressionPanel(props: ProgressionInput & { onNavigate?: (to: string) => void }) {
  const stages = buildColonyProgression(props);
  const recommended = stages.find(stage => !stage.complete) ?? stages[stages.length - 1];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = stages.find(stage => stage.id === selectedId) ?? recommended;
  const finished = stages.filter(stage => stage.complete).length;
  const next = selected.goals.find(goal => !goal.complete);
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, to: string) => {
    if (!props.onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onNavigate(to);
  };

  return (
    <section className="colony-progression" aria-label="工业发展导航">
      <header className="colony-progression__header">
        <div><span className="colony-progression__eyebrow">从落地到恒星</span><h3>工业发展导航</h3></div>
        <span className="colony-progression__count">{finished} / {stages.length} 阶段</span>
      </header>
      <p className="colony-progression__scope">科技按玩家进度，设施仅核对当前载入区域。移动地图后，未载入的设施可能暂时显示待完成。</p>
      <div className="colony-progression__stages" role="tablist" aria-label="发展阶段">
        {stages.map((stage, index) => (
          <button key={stage.id} id={`progression-tab-${stage.id}`} aria-controls={`progression-panel-${stage.id}`} role="tab" aria-selected={selected.id === stage.id} className={`colony-progression__stage${selected.id === stage.id ? ' is-selected' : ''}${stage.complete ? ' is-complete' : ''}`} onClick={() => setSelectedId(stage.id)} type="button">
            <span aria-hidden="true">{stage.complete ? '✓' : String(index + 1).padStart(2, '0')}</span><span>{stage.title}</span>
          </button>
        ))}
      </div>
      <div className="colony-progression__detail" role="tabpanel" id={`progression-panel-${selected.id}`} aria-labelledby={`progression-tab-${selected.id}`}>
        <div className="colony-progression__title"><Icon iconKey={selected.icon} size={22} /><div><h4>{selected.title}</h4><p>{selected.description}</p></div></div>
        <ul className="colony-progression__goals">
          {selected.goals.map(goal => <li key={goal.id} className={goal.complete ? 'is-complete' : ''}><span className="colony-progression__check" aria-label={goal.complete ? '已达成' : '待完成'}>{goal.complete ? '✓' : '○'}</span><div><strong>{goal.label}</strong><p>{goal.detail}</p>{!goal.complete && goal !== next ? <Link to={goal.action.to} onClick={event => navigate(event, goal.action.to)}>{goal.action.label} ↗</Link> : null}</div></li>)}
        </ul>
        {next ? <Link className="colony-progression__action" to={next.action.to} onClick={event => navigate(event, next.action.to)}><span>下一步 · {next.action.label}</span><span aria-hidden="true">→</span></Link> : <p className="colony-progression__done">本阶段目标已达成，可继续扩产或查看下一阶段。</p>}
      </div>
    </section>
  );
}
