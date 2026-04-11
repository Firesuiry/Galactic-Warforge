import type {
  CatalogView,
  PlanetNetworksView,
  PlanetRuntimeView,
  StateSummary,
  SystemRuntimeView,
  SystemView,
} from "@shared/types";
import type { ApiClient } from "@shared/api";

import { PlanetCommandPanel } from "@/features/planet-map/PlanetCommandPanel";
import type { PlanetRenderView } from "@/features/planet-map/model";

interface PlanetCommandCenterProps {
  catalog?: CatalogView;
  client: ApiClient;
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  summary?: StateSummary;
  system?: SystemView;
  systemRuntime?: SystemRuntimeView;
}

export function PlanetCommandCenter(props: PlanetCommandCenterProps) {
  return <PlanetCommandPanel {...props} />;
}
