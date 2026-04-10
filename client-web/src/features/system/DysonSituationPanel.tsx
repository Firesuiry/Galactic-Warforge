import type { SystemLayerSituationView, SystemSituationMetricView } from "@/features/system/system-situation-model";

interface DysonSituationPanelProps {
  metrics: SystemSituationMetricView[];
  layers: SystemLayerSituationView[];
}

export function DysonSituationPanel(props: DysonSituationPanelProps) {
  return (
    <section className="system-situation">
      <div className="system-situation__metrics">
        {props.metrics.map((metric) => (
          <article className="system-situation__metric" key={metric.label}>
            <span className="system-situation__metric-label">{metric.label}</span>
            <strong className="system-situation__metric-value">{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="section-title">戴森层级</div>
      {props.layers.length > 0 ? (
        <div className="system-situation__layers">
          {props.layers.map((layer) => (
            <article className="system-situation__layer-card" key={layer.key}>
              <header className="system-situation__layer-header">
                <strong>{layer.title}</strong>
                <span className="subtle-text">轨道半径 {layer.orbitRadius}</span>
              </header>
              <dl className="planet-kv-list">
                <div>
                  <dt>层总产能</dt>
                  <dd>{layer.energyOutput}</dd>
                </div>
                <div>
                  <dt>火箭发射</dt>
                  <dd>{layer.rocketLaunches}</dd>
                </div>
                <div>
                  <dt>节点</dt>
                  <dd>{layer.nodeCount}</dd>
                </div>
                <div>
                  <dt>框架</dt>
                  <dd>{layer.frameCount}</dd>
                </div>
                <div>
                  <dt>壳层</dt>
                  <dd>{layer.shellCount}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <p className="subtle-text">当前 system 还没有可展示的戴森层。</p>
      )}
    </section>
  );
}
