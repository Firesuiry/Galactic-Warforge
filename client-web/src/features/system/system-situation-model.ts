import type {
  ActivePlanetDysonContextView,
  DysonLayerView,
  StateSummary,
  SystemRuntimeView,
  SystemView,
} from "@shared/types";

export interface SystemSituationMetricView {
  label: string;
  value: string;
}

export interface SystemLayerSituationView {
  key: string;
  title: string;
  orbitRadius: string;
  energyOutput: string;
  rocketLaunches: string;
  nodeCount: string;
  frameCount: string;
  shellCount: string;
}

export interface ActivePlanetDysonModeView {
  mode: string;
  label: string;
  count: number;
}

export interface ActivePlanetDysonContextCardView {
  planetId: string;
  planetName: string;
  ejectorCount: number;
  siloCount: number;
  receiverCount: number;
  receiverModes: ActivePlanetDysonModeView[];
}

export interface SystemSituationViewModel {
  systemName: string;
  metrics: SystemSituationMetricView[];
  layers: SystemLayerSituationView[];
  activePlanetContext?: ActivePlanetDysonContextCardView;
}

function formatNumber(value: number) {
  return String(value);
}

function modeLabel(mode: string) {
  switch (mode) {
    case "photon":
      return "光子模式";
    case "power":
      return "发电模式";
    case "hybrid":
      return "混合模式";
    default:
      return mode;
  }
}

function buildLayerView(layer: DysonLayerView): SystemLayerSituationView {
  return {
    key: `layer-${layer.layer_index}`,
    title: `Layer ${layer.layer_index}`,
    orbitRadius: String(layer.orbit_radius ?? "-"),
    energyOutput: formatNumber(layer.energy_output ?? 0),
    rocketLaunches: formatNumber(layer.rocket_launches ?? 0),
    nodeCount: formatNumber(layer.nodes?.length ?? 0),
    frameCount: formatNumber(layer.frames?.length ?? 0),
    shellCount: formatNumber(layer.shells?.length ?? 0),
  };
}

function buildActivePlanetContext(
  context: ActivePlanetDysonContextView | undefined,
  system: SystemView | undefined,
): ActivePlanetDysonContextCardView | undefined {
  if (!context) {
    return undefined;
  }

  const activePlanet = system?.planets?.find(
    (planet) => planet.planet_id === context.planet_id,
  );
  const modes = Object.entries(context.ray_receiver_modes ?? {})
    .map(([mode, count]) => ({
      mode,
      label: modeLabel(mode),
      count,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

  return {
    planetId: context.planet_id,
    planetName: activePlanet?.name || context.planet_id,
    ejectorCount: context.em_rail_ejector_count,
    siloCount: context.vertical_launching_silo_count,
    receiverCount: context.ray_receiver_count,
    receiverModes: modes,
  };
}

export function buildSystemSituationModel(input: {
  system?: SystemView;
  runtime?: SystemRuntimeView;
  summary?: StateSummary;
}): SystemSituationViewModel {
  const system = input.system;
  const runtime = input.runtime;
  const dysonEnergy = runtime?.dyson_sphere?.total_energy ?? 0;
  const solarSailEnergy = runtime?.solar_sail_orbit?.total_energy ?? 0;
  const rocketLaunches = (runtime?.dyson_sphere?.layers ?? []).reduce(
    (total, layer) => total + (layer.rocket_launches ?? 0),
    0,
  );

  return {
    systemName: system?.name || system?.system_id || runtime?.system_id || "",
    metrics: [
      { label: "系统总产能", value: formatNumber(dysonEnergy) },
      { label: "太阳帆轨道能量", value: formatNumber(solarSailEnergy) },
      { label: "火箭发射次数", value: formatNumber(rocketLaunches) },
      { label: "可用接收能量", value: formatNumber(dysonEnergy + solarSailEnergy) },
      {
        label: "当前 active planet",
        value: system?.planets?.find(
          (planet) => planet.planet_id === input.summary?.active_planet_id,
        )?.name || input.summary?.active_planet_id || "未设置",
      },
    ],
    layers: [...(runtime?.dyson_sphere?.layers ?? [])]
      .sort((left, right) => left.layer_index - right.layer_index)
      .map(buildLayerView),
    activePlanetContext: buildActivePlanetContext(
      runtime?.active_planet_context,
      system,
    ),
  };
}
