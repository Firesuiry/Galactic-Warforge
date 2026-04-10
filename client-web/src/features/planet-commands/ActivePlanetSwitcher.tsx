interface ActivePlanetSwitcherProps {
  routePlanetId: string;
  routePlanetName?: string;
  activePlanetId: string;
  systemName?: string;
}

export function ActivePlanetSwitcher({
  routePlanetId,
  routePlanetName,
  activePlanetId,
  systemName,
}: ActivePlanetSwitcherProps) {
  return (
    <div className="planet-context-grid">
      <div>
        <dt>当前路由行星</dt>
        <dd>{routePlanetName ? `${routePlanetName} · ${routePlanetId}` : routePlanetId}</dd>
      </div>
      <div>
        <dt>当前 active planet</dt>
        <dd>{activePlanetId}</dd>
      </div>
      <div>
        <dt>所在星系</dt>
        <dd>{systemName || "未同步"}</dd>
      </div>
    </div>
  );
}
