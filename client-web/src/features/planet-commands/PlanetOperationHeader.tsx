import type {
  CommandJournalStatus,
  PlanetCommandJournalEntry,
} from "@/features/planet-commands/store";

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

function latestEntryTone(status: CommandJournalStatus | undefined) {
  if (status === "failed") {
    return "error";
  }
  if (status === "succeeded") {
    return "ok";
  }
  if (status === "pending") {
    return "pending";
  }
  return "idle";
}

export function PlanetOperationHeader(props: PlanetOperationHeaderProps) {
  const tone = latestEntryTone(props.latestEntry?.status);
  return (
    <section className="planet-side-section planet-operation-header">
      <div className="section-title">行星工作台</div>
      <ActivePlanetSwitcher
        activePlanetId={props.activePlanetId}
        routePlanetId={props.routePlanetId}
        routePlanetName={props.routePlanetName}
        systemName={props.systemName}
      />
      <div className={`planet-command-bar planet-command-bar--${tone}`}>
        <span>待处理命令 {props.pendingCount}</span>
        <span
          className={`planet-command-bar__feedback planet-command-bar__feedback--${tone}`}
          data-testid="planet-latest-feedback"
        >
          最新反馈 {describeLatestEntry(props.latestEntry)}
        </span>
      </div>
    </section>
  );
}
