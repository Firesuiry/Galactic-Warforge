import type { ActivePlanetDysonContextCardView } from "@/features/system/system-situation-model";

interface ActivePlanetDysonContextCardProps {
  context?: ActivePlanetDysonContextCardView;
}

export function ActivePlanetDysonContextCard(
  props: ActivePlanetDysonContextCardProps,
) {
  return (
    <section className="planet-side-section">
      <div className="section-title">当前 active planet</div>
      {props.context ? (
        <>
          <strong className="system-situation__active-planet-name">
            {props.context.planetName}
          </strong>
          <p className="subtle-text">
            当前 active planet 的戴森建筑数量直接决定你能否在 Web 里继续发射太阳帆、火箭和切换接收模式。
          </p>
          <ul className="system-situation__context-list">
            <li>电磁轨道弹射器 {props.context.ejectorCount}</li>
            <li>垂直发射井 {props.context.siloCount}</li>
            <li>射线接收站 {props.context.receiverCount}</li>
          </ul>
          {props.context.receiverModes.length > 0 ? (
            <div className="system-situation__mode-list">
              {props.context.receiverModes.map((mode) => (
                <span className="system-situation__mode-chip" key={mode.mode}>
                  {mode.label} {mode.count}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="subtle-text">
          当前 active planet 不在本 system，或暂时没有可用的戴森运行态上下文。
        </p>
      )}
    </section>
  );
}
