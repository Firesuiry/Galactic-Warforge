import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { renderApp, jsonResponse, sseResponse } from "@/test/utils";
import { useSessionStore } from "@/stores/session";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function createPlanetPayload() {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 4,
    map_height: 4,
    tick: 120,
    terrain: [
      ["buildable", "buildable", "buildable", "water"],
      ["buildable", "buildable", "buildable", "water"],
      ["blocked", "buildable", "buildable", "lava"],
      ["buildable", "buildable", "buildable", "buildable"],
    ],
    environment: {
      wind_factor: 0.8,
      light_factor: 1.1,
    },
    buildings: {
      "miner-1": {
        id: "miner-1",
        type: "mining_machine",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 6,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          state: "running",
          state_reason: "",
        },
        storage: {
          inventory: {
            iron_ore: 12,
          },
        },
        production: {
          recipe_id: "mining-iron",
          remaining_ticks: 4,
        },
      },
    },
    units: {
      "worker-1": {
        id: "worker-1",
        type: "worker",
        owner_id: "p1",
        position: { x: 2, y: 1, z: 0 },
        hp: 24,
        max_hp: 24,
        attack: 3,
        defense: 1,
        attack_range: 1,
        move_range: 2,
        vision_range: 4,
        is_moving: false,
      },
    },
    resources: [
      {
        id: "iron-1",
        planet_id: "planet-1-1",
        kind: "iron_ore",
        behavior: "finite",
        position: { x: 0, y: 0, z: 0 },
        remaining: 900,
        current_yield: 3,
        is_rare: false,
      },
    ],
  };
}

function createFogPayload() {
  return {
    planet_id: "planet-1-1",
    discovered: true,
    map_width: 4,
    map_height: 4,
    visible: [
      [true, true, true, false],
      [true, true, true, false],
      [false, true, true, false],
      [false, false, false, false],
    ],
    explored: [
      [true, true, true, false],
      [true, true, true, false],
      [true, true, true, false],
      [true, true, false, false],
    ],
  };
}

function createScenePayload() {
  const planet = createPlanetPayload();
  const fog = createFogPayload();
  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: planet.terrain,
    environment: planet.environment,
    visible: fog.visible,
    explored: fog.explored,
    buildings: planet.buildings,
    units: planet.units,
    resources: planet.resources,
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function createOverviewPayload(step = 100) {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 4,
    map_height: 4,
    tick: 120,
    step,
    cells_width: Math.max(1, Math.ceil(4 / step)),
    cells_height: Math.max(1, Math.ceil(4 / step)),
    terrain: [["buildable"]],
    visible: [[true]],
    explored: [[true]],
    resource_counts: [[1]],
    building_counts: [[1]],
    unit_counts: [[1]],
    building_count: 1,
    unit_count: 1,
    resource_count: 1,
  };
}

function createLargeScenePayload() {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 2000,
    map_height: 2000,
    tick: 120,
    bounds: { x: 0, y: 0, width: 96, height: 96 },
    terrain: [],
    environment: {
      wind_factor: 0.8,
      light_factor: 1.1,
    },
    visible: [],
    explored: [],
    buildings: {},
    units: {},
    resources: [],
    building_count: 0,
    unit_count: 0,
    resource_count: 0,
  };
}

function createSummaryPayload() {
  return {
    tick: 120,
    active_planet_id: "planet-1-1",
    map_width: 4,
    map_height: 4,
    players: {
      p1: {
        player_id: "p1",
        is_alive: true,
        resources: { minerals: 240, energy: 140 },
        inventory: {
          iron_ore: 24,
          silicon_ore: 8,
          stone_ore: 3,
        },
        tech: {
          player_id: "p1",
          current_research: {
            tech_id: "tech-energy-1",
            state: "running",
            progress: 40,
            total_cost: 100,
          },
        },
      },
    },
  };
}

function createStatsPayload() {
  return {
    player_id: "p1",
    tick: 120,
    production_stats: {
      total_output: 24,
      by_building_type: {},
      by_item: {},
      efficiency: 0.95,
    },
    energy_stats: {
      generation: 120,
      consumption: 90,
      storage: 100,
      current_stored: 75,
      shortage_ticks: 0,
    },
    logistics_stats: {
      throughput: 8,
      avg_distance: 16,
      avg_travel_time: 10,
      deliveries: 12,
    },
    combat_stats: {
      units_lost: 1,
      enemies_killed: 5,
      threat_level: 3,
      highest_threat: 4,
    },
  };
}

function createRuntimePayload() {
  return {
    planet_id: "planet-1-1",
    discovered: true,
    available: true,
    tick: 120,
    logistics_stations: [],
    logistics_drones: [],
    logistics_ships: [],
    construction_tasks: [],
    enemy_forces: [],
    detections: [],
    threat_level: 0,
  };
}

function createNetworksPayload() {
  return {
    planet_id: "planet-1-1",
    discovered: true,
    available: true,
    tick: 120,
    power_networks: [],
    power_nodes: [],
    power_links: [],
    power_coverage: [],
    pipeline_nodes: [],
    pipeline_segments: [],
    pipeline_endpoints: [],
  };
}

function createCatalogPayload() {
  return {
    buildings: [
      {
        id: "mining_machine",
        name: "采矿机",
        category: "production",
        subcategory: "mining",
        footprint: { width: 1, height: 1 },
        build_cost: { minerals: 12 },
        buildable: true,
        icon_key: "mining_machine",
        color: "#d8a23a",
      },
    ],
    items: [
      {
        id: "iron_ore",
        name: "铁矿",
        category: "ore",
        form: "solid",
        stack_limit: 100,
        unit_volume: 1,
        icon_key: "iron_ore",
        color: "#8893a5",
      },
    ],
    recipes: [
      {
        id: "mining-iron",
        name: "开采铁矿",
        inputs: [],
        outputs: [{ item_id: "iron_ore", amount: 1 }],
        duration: 4,
        energy_cost: 1,
        building_types: ["mining_machine"],
        icon_key: "mining-iron",
        color: "#d8a23a",
      },
    ],
    techs: [
      {
        id: "tech-energy-1",
        name: "基础能源学",
        category: "energy",
        type: "upgrade",
        level: 1,
        icon_key: "tech-energy-1",
        color: "#4c8bf5",
      },
    ],
  };
}

function createPlanetPayloadWithLogisticsStation(
  kind: "planetary" | "interstellar",
) {
  const planet = createPlanetPayload();
  const buildingId = kind === "planetary" ? "pls-1" : "ils-1";
  const buildingType =
    kind === "planetary"
      ? "planetary_logistics_station"
      : "interstellar_logistics_station";
  return {
    ...planet,
    buildings: {
      ...planet.buildings,
      [buildingId]: {
        id: buildingId,
        type: buildingType,
        owner_id: "p1",
        position: { x: 2, y: 2, z: 0 },
        hp: 300,
        max_hp: 300,
        level: 1,
        vision_range: 8,
        runtime: {
          params: {
            energy_consume: 12,
            energy_generate: 0,
            capacity: 200,
            maintenance_cost: { minerals: 0, energy: 1 },
            footprint: { width: 2, height: 2 },
          },
          state: "running",
          state_reason: "",
        },
        storage: {
          inventory: {
            iron_ore: 45,
            hydrogen: kind === "interstellar" ? 20 : 0,
          },
        },
      },
    },
  };
}

function createScenePayloadWithLogisticsStation(
  kind: "planetary" | "interstellar",
) {
  const planet = createPlanetPayloadWithLogisticsStation(kind);
  const fog = createFogPayload();
  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: planet.terrain,
    environment: planet.environment,
    visible: fog.visible,
    explored: fog.explored,
    buildings: planet.buildings,
    units: planet.units,
    resources: planet.resources,
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function createRuntimePayloadWithPlanetaryLogisticsStation() {
  return {
    ...createRuntimePayload(),
    logistics_stations: [
      {
        building_id: "pls-1",
        building_type: "planetary_logistics_station",
        owner_id: "p1",
        position: { x: 2, y: 2, z: 0 },
        state: {
          priority: { input: 2, output: 4 },
          settings: {
            iron_ore: {
              item_id: "iron_ore",
              mode: "supply",
              local_storage: 60,
            },
          },
          inventory: {
            iron_ore: 45,
          },
          drone_capacity: 10,
          interstellar: {
            enabled: false,
            warp_enabled: false,
            ship_slots: 0,
            ship_capacity: 0,
            ship_speed: 0,
            warp_speed: 0,
            warp_distance: 0,
            energy_per_distance: 0,
            warp_energy_multiplier: 0,
            warp_item_cost: 0,
          },
          cache: {
            supply: { iron_ore: 45 },
            demand: {},
            local: { iron_ore: 60 },
          },
        },
        drone_ids: ["drone-pls-1", "drone-pls-2"],
        ship_ids: [],
      },
    ],
  };
}

function createRuntimePayloadWithInterstellarLogisticsStation() {
  return {
    ...createRuntimePayload(),
    logistics_stations: [
      {
        building_id: "ils-1",
        building_type: "interstellar_logistics_station",
        owner_id: "p1",
        position: { x: 2, y: 2, z: 0 },
        state: {
          priority: { input: 5, output: 6 },
          settings: {
            iron_ore: {
              item_id: "iron_ore",
              mode: "supply",
              local_storage: 30,
            },
          },
          interstellar_settings: {
            hydrogen: {
              item_id: "hydrogen",
              mode: "demand",
              local_storage: 80,
            },
          },
          inventory: {
            iron_ore: 20,
            hydrogen: 12,
          },
          drone_capacity: 20,
          interstellar: {
            enabled: true,
            warp_enabled: true,
            ship_slots: 6,
            ship_capacity: 200,
            ship_speed: 12,
            warp_speed: 36,
            warp_distance: 24,
            energy_per_distance: 5,
            warp_energy_multiplier: 3,
            warp_item_id: "space_warper",
            warp_item_cost: 1,
          },
          cache: {
            supply: { iron_ore: 20 },
            demand: {},
            local: { iron_ore: 30 },
          },
          interstellar_cache: {
            supply: {},
            demand: { hydrogen: 80 },
            local: { hydrogen: 20 },
          },
        },
        drone_ids: ["drone-ils-1"],
        ship_ids: ["ship-ils-1", "ship-ils-2"],
      },
    ],
  };
}

function createCatalogPayloadWithLogistics() {
  const catalog = createCatalogPayload();
  return {
    ...catalog,
    buildings: [
      ...catalog.buildings,
      {
        id: "planetary_logistics_station",
        name: "行星物流站",
        category: "logistics",
        subcategory: "planetary",
        footprint: { width: 2, height: 2 },
        build_cost: { minerals: 80 },
        buildable: true,
        icon_key: "planetary_logistics_station",
        color: "#6a8f5b",
      },
      {
        id: "interstellar_logistics_station",
        name: "星际物流站",
        category: "logistics",
        subcategory: "interstellar",
        footprint: { width: 2, height: 2 },
        build_cost: { minerals: 160 },
        buildable: true,
        icon_key: "interstellar_logistics_station",
        color: "#4a6db3",
      },
    ],
    items: [
      ...catalog.items,
      {
        id: "hydrogen",
        name: "氢",
        category: "gas",
        form: "fluid",
        stack_limit: 100,
        unit_volume: 1,
        icon_key: "hydrogen",
        color: "#7dd3fc",
      },
      {
        id: "space_warper",
        name: "空间翘曲器",
        category: "component",
        form: "solid",
        stack_limit: 100,
        unit_volume: 1,
        icon_key: "space_warper",
        color: "#d8b4fe",
      },
    ],
  };
}

describe("PlanetPage", () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: "http://localhost:5173",
      playerId: "p1",
      playerKey: "key_player_1",
    });
  });

  it("默认首屏展示行星工作台与 active planet 上下文", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.endsWith("/world/systems/sys-1")) {
          return Promise.resolve(
            jsonResponse({
              system_id: "sys-1",
              galaxy_id: "galaxy-1",
              name: "Helios",
              star_type: "main_sequence",
              planets: [
                {
                  planet_id: "planet-1-1",
                  name: "Gaia",
                  kind: "terrestrial",
                },
              ],
            }),
          );
        }
        if (url.endsWith("/world/systems/sys-1/runtime")) {
          return Promise.resolve(
            jsonResponse({
              system_id: "sys-1",
              orbiting_fleets: [],
              enemy_fleets: [],
              solar_sails: [],
              dyson_sphere: {
                system_id: "sys-1",
                layers: [],
                ray_receivers: [],
                sails: [],
              },
            }),
          );
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(["/planet/planet-1-1"]);

    expect(await screen.findByText("当前路由行星")).toBeInTheDocument();
    expect(screen.getByText("当前 active planet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "扫描当前行星" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "命令" }),
    ).not.toBeInTheDocument();
  });

  it("移动端提供工作台、选中对象和活动流切换，并默认保留地图首屏", async () => {
    stubMatchMedia(true);

    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.endsWith("/world/systems/sys-1")) {
          return Promise.resolve(
            jsonResponse({
              system_id: "sys-1",
              galaxy_id: "galaxy-1",
              name: "Helios",
              star_type: "main_sequence",
              planets: [
                {
                  planet_id: "planet-1-1",
                  name: "Gaia",
                  kind: "terrestrial",
                },
              ],
            }),
          );
        }
        if (url.endsWith("/world/systems/sys-1/runtime")) {
          return Promise.resolve(
            jsonResponse({
              system_id: "sys-1",
              orbiting_fleets: [],
              enemy_fleets: [],
              solar_sails: [],
              dyson_sphere: {
                system_id: "sys-1",
                layers: [],
                ray_receivers: [],
                sails: [],
              },
            }),
          );
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("img", { name: "行星地图" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "选中对象" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "活动流" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "活动流" }));
    expect(screen.getByText("事件时间线")).toBeInTheDocument();
  });

  it("渲染地图、迷雾、事件和实体详情侧栏", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [
                {
                  event_id: "evt-10",
                  tick: 119,
                  event_type: "building_state_changed",
                  visibility_scope: "p1",
                  payload: {
                    building_id: "miner-1",
                    building_type: "mining_machine",
                    prev_state: "idle",
                    next_state: "running",
                    reason: "power_restored",
                  },
                },
              ],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [
                {
                  alert_id: "alert-1",
                  tick: 118,
                  player_id: "p1",
                  building_id: "miner-1",
                  building_type: "mining_machine",
                  alert_type: "input_shortage",
                  severity: "warning",
                  message: "矿物输入不足",
                  metrics: {
                    throughput: 0,
                    backlog: 2,
                    idle_ratio: 0.5,
                    efficiency: 0.3,
                    input_shortage: true,
                    output_blocked: false,
                    power_state: "normal",
                  },
                  details: {},
                },
              ],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "行星地图" })).toBeInTheDocument();
    expect(
      screen.getAllByText("矿产 铁矿 24 · 石矿 3 · 硅矿 8").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("资源 240 / 140")).not.toBeInTheDocument();
    expect(screen.getByText("事件时间线")).toBeInTheDocument();
    expect(screen.getByText("告警面板")).toBeInTheDocument();
    expect(
      screen.getByText("建筑状态变更 · miner-1 空闲 -> 运行中"),
    ).toBeInTheDocument();
    expect(screen.getByText("采矿机 · (1, 1, 0)")).toBeInTheDocument();
    expect(screen.getByText("问题：原料短缺")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "定位" })[0]);

    expect(await screen.findByText("建筑详情")).toBeInTheDocument();
    expect(screen.getByText("采矿机")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开调试" }));
    expect(screen.getByText("调试面板")).toBeInTheDocument();
  });

  it("接收 SSE 后会把新事件和新告警并入页面并触发快照重拉", async () => {
    let alertSnapshotCalls = 0;
    const liveAlert = {
      alert_id: "alert-2",
      tick: 121,
      player_id: "p1",
      building_id: "miner-1",
      building_type: "mining_machine",
      alert_type: "output_blocked",
      severity: "warning",
      message: "产线堵塞",
      metrics: {
        throughput: 0,
        backlog: 5,
        idle_ratio: 0.2,
        efficiency: 0,
        input_shortage: false,
        output_blocked: true,
        power_state: "normal",
      },
      details: {},
    };

    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["production_alert"],
              available_from_tick: 1,
              next_event_id: "evt-121",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          alertSnapshotCalls += 1;
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: alertSnapshotCalls > 1 ? [liveAlert] : [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["production_alert"],
                  },
                },
                {
                  event: "game",
                  data: {
                    event_id: "evt-121",
                    tick: 121,
                    event_type: "production_alert",
                    visibility_scope: "p1",
                    payload: {
                      alert: liveAlert,
                    },
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("[t121] 产物阻塞"),
    ).toBeInTheDocument();
    expect(screen.getByText("采矿机 · (1, 1, 0)")).toBeInTheDocument();
    expect(screen.getByText("问题：产物阻塞")).toBeInTheDocument();

    await waitFor(() => {
      expect(alertSnapshotCalls).toBeGreaterThan(1);
    });
  });

  it("命令操作面板可以发送扫描命令", async () => {
    const commandRequests: Array<{
      commands?: Array<{ type?: string; target?: { planet_id?: string } }>;
    }> = [];
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }
        if (url.endsWith("/commands") && init?.method === "POST") {
          commandRequests.push(JSON.parse(String(init.body)));
          return Promise.resolve(
            jsonResponse({
              request_id: "req-scan-1",
              accepted: true,
              enqueue_tick: 120,
              results: [
                {
                  command_index: 0,
                  status: "queued",
                  code: "OK",
                  message: "scan_planet accepted",
                },
              ],
            }),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "扫描当前行星" }));

    expect(
      await screen.findByText(/已受理：scan_planet accepted/),
    ).toBeInTheDocument();
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]?.commands?.[0]?.type).toBe("scan_planet");
    expect(commandRequests[0]?.commands?.[0]?.target?.planet_id).toBe(
      "planet-1-1",
    );
  });

  it("选中物流站后显示结构化物流详情，并允许提交物流站配置", async () => {
    const user = userEvent.setup();
    const commandRequests: Array<{
      commands?: Array<{
        type?: string;
        target?: { entity_id?: string };
        payload?: Record<string, unknown>;
      }>;
    }> = [];
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(
            jsonResponse(createScenePayloadWithLogisticsStation("planetary")),
          );
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(
            jsonResponse(createRuntimePayloadWithPlanetaryLogisticsStation()),
          );
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(
            jsonResponse(createCatalogPayloadWithLogistics()),
          );
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-logistics-1",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }
        if (url.endsWith("/commands") && init?.method === "POST") {
          commandRequests.push(JSON.parse(String(init.body)));
          return Promise.resolve(
            jsonResponse({
              request_id: "req-logistics-station-1",
              accepted: true,
              enqueue_tick: 120,
              results: [
                {
                  command_index: 0,
                  status: "queued",
                  code: "OK",
                  message: "station updated",
                },
              ],
            }),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(["/planet/planet-1-1?select=building:pls-1"]);

    expect(await screen.findByText("建筑详情")).toBeInTheDocument();
    expect(screen.getByText("行星槽位")).toBeInTheDocument();
    expect(screen.getByText("库存与缓存摘要")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "物流" }));
    expect(await screen.findByText("物流站配置")).toBeInTheDocument();
    expect(
      (screen.getAllByLabelText("物流站") as HTMLSelectElement[]).some(
        (element) => element.value === "pls-1",
      ),
    ).toBe(true);
    await user.clear(screen.getByLabelText("无人机容量"));
    await user.type(screen.getByLabelText("无人机容量"), "12");
    await user.click(screen.getByRole("button", { name: "提交物流站配置" }));

    expect(
      await screen.findByText(/已受理：station updated/),
    ).toBeInTheDocument();
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]?.commands?.[0]?.type).toBe(
      "configure_logistics_station",
    );
    expect(commandRequests[0]?.commands?.[0]?.target?.entity_id).toBe("pls-1");
    expect(commandRequests[0]?.commands?.[0]?.payload?.drone_capacity).toBe(12);
  });

  it("星际物流站显示星际字段，并允许提交 interstellar 槽位配置", async () => {
    const user = userEvent.setup();
    const commandRequests: Array<{
      commands?: Array<{
        type?: string;
        target?: { entity_id?: string };
        payload?: Record<string, unknown>;
      }>;
    }> = [];
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(
            jsonResponse(
              createScenePayloadWithLogisticsStation("interstellar"),
            ),
          );
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(
            jsonResponse(
              createRuntimePayloadWithInterstellarLogisticsStation(),
            ),
          );
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(
            jsonResponse(createCatalogPayloadWithLogistics()),
          );
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-logistics-2",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }
        if (url.endsWith("/commands") && init?.method === "POST") {
          commandRequests.push(JSON.parse(String(init.body)));
          return Promise.resolve(
            jsonResponse({
              request_id: "req-logistics-slot-1",
              accepted: true,
              enqueue_tick: 120,
              results: [
                {
                  command_index: 0,
                  status: "queued",
                  code: "OK",
                  message: "slot updated",
                },
              ],
            }),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(["/planet/planet-1-1?select=building:ils-1"]);

    expect(await screen.findByText("建筑详情")).toBeInTheDocument();
    expect(screen.getByText("星际配置")).toBeInTheDocument();
    expect(screen.getByText("星际槽位")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "物流" }));
    expect(await screen.findByText("物流槽位配置")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("物流范围"), "interstellar");
    await user.selectOptions(screen.getByLabelText("物品"), "hydrogen");
    await user.selectOptions(screen.getByLabelText("物流模式"), "demand");
    await user.clear(screen.getByLabelText("本地库存"));
    await user.type(screen.getByLabelText("本地库存"), "80");
    await user.click(screen.getByRole("button", { name: "提交物流槽位配置" }));

    expect(
      await screen.findByText(/已受理：slot updated/),
    ).toBeInTheDocument();
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]?.commands?.[0]?.type).toBe(
      "configure_logistics_slot",
    );
    expect(commandRequests[0]?.commands?.[0]?.target?.entity_id).toBe("ils-1");
    expect(commandRequests[0]?.commands?.[0]?.payload?.scope).toBe(
      "interstellar",
    );
    expect(commandRequests[0]?.commands?.[0]?.payload?.item_id).toBe(
      "hydrogen",
    );
    expect(commandRequests[0]?.commands?.[0]?.payload?.mode).toBe("demand");
    expect(commandRequests[0]?.commands?.[0]?.payload?.local_storage).toBe(80);
  });

  it("切到 1px/4tile 缩放时，小地图会按 step=4 请求行星总览", async () => {
    let overviewCalls = 0;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.includes("/world/planets/planet-1-1/overview")) {
          overviewCalls += 1;
          const parsedUrl = new URL(url);
          expect(parsedUrl.searchParams.get("step")).toBe("4");
          return Promise.resolve(jsonResponse(createOverviewPayload(4)));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1px/4tile" }));

    expect(await screen.findByText("缩放 1px/4tile")).toBeInTheDocument();
    await waitFor(() => {
      expect(overviewCalls).toBeGreaterThan(0);
    });
  });

  it("大地图切到 1px/4tile 缩放时会抬高总览 step，避免单次响应过大", async () => {
    let requestedOverviewStep = "";

    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createLargeScenePayload()));
        }
        if (url.includes("/world/planets/planet-1-1/overview")) {
          const parsedUrl = new URL(url);
          requestedOverviewStep = parsedUrl.searchParams.get("step") ?? "";
          return Promise.resolve(
            jsonResponse({
              ...createOverviewPayload(16),
              map_width: 2000,
              map_height: 2000,
              step: 16,
              cells_width: 125,
              cells_height: 125,
            }),
          );
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1px/4tile" }));

    await waitFor(() => {
      expect(requestedOverviewStep).toBe("16");
    });
    expect(
      await screen.findByText("缩放 1px/4tile (实际 1px/16tile)"),
    ).toBeInTheDocument();
  });

  it("大地图切到 1px 缩放时会显示低缩放简化提示", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createLargeScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1px" }));

    expect(await screen.findByText("低缩放简化")).toBeInTheDocument();
    expect(await screen.findByText("细网格已简化")).toBeInTheDocument();
  });

  it("调试面板可以导出当前视角 JSON", async () => {
    let exportedHref = "";
    let exportedDownload = "";
    const anchorClick = vi.fn(function captureAnchor(this: HTMLAnchorElement) {
      exportedHref = this.href;
      exportedDownload = this.download;
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: anchorClick,
    });

    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/state/summary")) {
          return Promise.resolve(jsonResponse(createSummaryPayload()));
        }
        if (url.endsWith("/state/stats")) {
          return Promise.resolve(jsonResponse(createStatsPayload()));
        }
        if (url.includes("/world/planets/planet-1-1/scene")) {
          return Promise.resolve(jsonResponse(createScenePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/runtime")) {
          return Promise.resolve(jsonResponse(createRuntimePayload()));
        }
        if (url.endsWith("/world/planets/planet-1-1/networks")) {
          return Promise.resolve(jsonResponse(createNetworksPayload()));
        }
        if (url.endsWith("/catalog")) {
          return Promise.resolve(jsonResponse(createCatalogPayload()));
        }
        if (url.includes("/events/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              event_types: ["building_state_changed"],
              available_from_tick: 1,
              next_event_id: "evt-10",
              has_more: false,
              events: [],
            }),
          );
        }
        if (url.includes("/alerts/production/snapshot")) {
          return Promise.resolve(
            jsonResponse({
              available_from_tick: 1,
              has_more: false,
              alerts: [],
            }),
          );
        }
        if (url.includes("/events/stream")) {
          return Promise.resolve(
            sseResponse(
              [
                {
                  event: "connected",
                  data: {
                    player_id: "p1",
                    event_types: ["building_state_changed"],
                  },
                },
              ],
              init?.signal as AbortSignal,
            ),
          );
        }

        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    renderApp(["/planet/planet-1-1"]);

    expect(
      await screen.findByRole("heading", { name: "Gaia" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开调试" }));
    expect(
      screen.getByRole("button", { name: "收起调试" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导出视角 JSON" }));

    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    expect(exportedDownload).toBe("planet-1-1-viewport.json");
    expect(exportedHref).toContain("data:application/json");
    expect(decodeURIComponent(exportedHref)).toContain(
      '"planet_id": "planet-1-1"',
    );
    expect(decodeURIComponent(exportedHref)).toContain('"share_url":');
  });
});
