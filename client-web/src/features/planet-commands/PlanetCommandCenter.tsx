import type {
  CatalogView,
  PlanetRuntimeView,
  StateSummary,
  SystemRuntimeView,
  SystemView,
} from "@shared/types";
import type { ApiClient } from "@shared/api";

import {
  PlanetCommandPanel,
  type CommandWorkflowId,
} from "@/features/planet-map/PlanetCommandPanel";
import type { PlanetRenderView } from "@/features/planet-map/model";

interface PlanetCommandCenterProps {
  catalog?: CatalogView;
  client: ApiClient;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  summary?: StateSummary;
  system?: SystemView;
  systemRuntime?: SystemRuntimeView;
  /** 深链初值：研究/物流/戴森工作流 Tab。 */
  initialWorkflow?: CommandWorkflowId;
}

export function PlanetCommandCenter(props: PlanetCommandCenterProps) {
  return <PlanetCommandPanel {...props} />;
}
