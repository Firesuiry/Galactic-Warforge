import type { PlanetCommandJournalEntry } from "@/features/planet-commands/store";

import { ActivePlanetSwitcher } from "./ActivePlanetSwitcher";

interface PlanetOperationHeaderProps {
  routePlanetId: string;
  routePlanetName?: string;
  activePlanetId: string;
  systemName?: string;
  latestEntry?: PlanetCommandJournalEntry;
  pendingCount: number;
}

function describeLatestEntry(entry: PlanetCommandJournalEntry | undefined) {
  if (!entry) {
    return "暂无命令结果";
  }
  if (entry.status === "pending") {
    return entry.acceptedMessage;
  }
  return entry.authoritativeMessage ?? entry.acceptedMessage;
}

export function PlanetOperationHeader(props: PlanetOperationHeaderProps) {
  return (
    <section className="planet-side-section planet-operation-header">
      <div className="section-title">行星工作台</div>
      <ActivePlanetSwitcher
        activePlanetId={props.activePlanetId}
        routePlanetId={props.routePlanetId}
        routePlanetName={props.routePlanetName}
        systemName={props.systemName}
      />
      <div className="planet-command-bar">
        <span>待处理命令 {props.pendingCount}</span>
        <span>
          最新反馈 {describeLatestEntry(props.latestEntry)}
        </span>
      </div>
    </section>
  );
}
