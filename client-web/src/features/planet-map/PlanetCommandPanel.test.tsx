import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlanetCommandStore } from "@/features/planet-commands/store";
import { PlanetCommandPanel } from "@/features/planet-map/PlanetCommandPanel";
import { usePlanetViewStore } from "@/features/planet-map/store";

function createPlanet() {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 4,
    map_height: 4,
    tick: 120,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: [
      ["buildable", "buildable", "buildable", "buildable"],
      ["buildable", "buildable", "buildable", "buildable"],
      ["buildable", "buildable", "buildable", "buildable"],
      ["buildable", "buildable", "buildable", "buildable"],
    ],
    visible: [
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
    ],
    explored: [
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
    ],
    environment: {
      wind_factor: 0.8,
      light_factor: 1.1,
    },
    buildings: {
      "b-35": {
        id: "b-35",
        type: "planetary_logistics_station",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
        hp: 120,
        max_hp: 120,
        level: 1,
        vision_range: 2,
        runtime: {
          params: {
            energy_consume: 0,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "running",
        },
      },
      "lab-1": {
        id: "lab-1",
        type: "matrix_lab",
        owner_id: "p1",
        position: { x: 2, y: 1, z: 0 },
        hp: 120,
        max_hp: 120,
        level: 1,
        vision_range: 2,
        runtime: {
          params: {
            energy_consume: 0,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "running",
        },
        storage: {
          inventory: {
            electromagnetic_matrix: 10,
          },
        },
      },
      "ejector-1": {
        id: "ejector-1",
        type: "em_rail_ejector",
        owner_id: "p1",
        position: { x: 3, y: 1, z: 0 },
        hp: 120,
        max_hp: 120,
        level: 1,
        vision_range: 2,
        runtime: {
          params: {
            energy_consume: 0,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "running",
        },
      },
      "silo-1": {
        id: "silo-1",
        type: "vertical_launching_silo",
        owner_id: "p1",
        position: { x: 0, y: 2, z: 0 },
        hp: 120,
        max_hp: 120,
        level: 1,
        vision_range: 2,
        runtime: {
          params: {
            energy_consume: 0,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "running",
        },
      },
      "ray-1": {
        id: "ray-1",
        type: "ray_receiver",
        owner_id: "p1",
        position: { x: 1, y: 2, z: 0 },
        hp: 120,
        max_hp: 120,
        level: 1,
        vision_range: 2,
        runtime: {
          params: {
            energy_consume: 0,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "running",
        },
      },
    },
    units: {},
    resources: [],
    building_count: 1,
    unit_count: 0,
    resource_count: 0,
  };
}

function createRuntime() {
  return {
    available: true,
    logistics_stations: [
      {
        building_id: "b-35",
        building_type: "planetary_logistics_station",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
        state: {
          priority: { input: 1, output: 1 },
          drone_capacity: 10,
          interstellar: {
            enabled: false,
            warp_enabled: false,
            ship_slots: 5,
            ship_capacity: 200,
            ship_speed: 2,
            warp_speed: 10,
            warp_distance: 20,
            energy_per_distance: 5,
            warp_energy_multiplier: 3,
            warp_item_id: "space_warper",
            warp_item_cost: 1,
          },
          cache: {},
          interstellar_cache: {},
        },
        drone_ids: ["drone-1"],
      },
    ],
    logistics_drones: [],
    logistics_ships: [],
    construction_tasks: [],
    threat_level: 0,
  };
}

function createCatalog() {
  return {
    items: [
      { id: "annihilation_constraint_sphere", name: "A Item" },
      { id: "electromagnetic_matrix", name: "电磁矩阵" },
      { id: "small_carrier_rocket", name: "小型运载火箭" },
      { id: "solar_sail", name: "太阳帆" },
      { id: "silicon_ore", name: "S Item" },
    ],
    buildings: [
      {
        id: "planetary_logistics_station",
        name: "Planetary Logistics Station",
        buildable: true,
      },
      {
        id: "wind_turbine",
        name: "风力涡轮机",
        buildable: true,
        unlock_tech: ["dyson_sphere_program"],
      },
      {
        id: "matrix_lab",
        name: "矩阵研究站",
        buildable: true,
        unlock_tech: ["dyson_sphere_program"],
      },
      {
        id: "tesla_tower",
        name: "特斯拉塔",
        buildable: true,
        unlock_tech: ["electromagnetism"],
      },
      {
        id: "em_rail_ejector",
        name: "电磁弹射器",
        buildable: true,
        unlock_tech: ["electromagnetism"],
      },
      {
        id: "vertical_launching_silo",
        name: "垂直发射井",
        buildable: true,
        unlock_tech: ["energy_matrix"],
      },
      {
        id: "ray_receiver",
        name: "射线接收站",
        buildable: true,
        unlock_tech: ["energy_matrix"],
      },
    ],
    recipes: [
      {
        id: "magnet_recipe",
        name: "磁铁配方",
      },
    ],
    techs: [
      {
        id: "dyson_sphere_program",
        name: "戴森球计划",
        level: 0,
        prerequisites: [],
        cost: [],
        unlocks: [{ type: "building", id: "matrix_lab" }],
      },
      {
        id: "electromagnetism",
        name: "电磁学",
        level: 1,
        prerequisites: ["dyson_sphere_program"],
        cost: [{ item_id: "electromagnetic_matrix", quantity: 10 }],
        unlocks: [
          { type: "building", id: "tesla_tower" },
          { type: "recipe", id: "magnet_recipe" },
        ],
      },
      {
        id: "energy_matrix",
        name: "能量矩阵",
        level: 2,
        prerequisites: ["electromagnetism"],
        cost: [{ item_id: "electromagnetic_matrix", quantity: 20 }],
        unlocks: [{ type: "special", id: "red_science" }],
      },
    ],
  };
}

function createSummary(options?: {
  completedTechIds?: string[];
  currentResearch?: { tech_id: string; progress?: number; total_cost?: number } | null;
  executorUnitId?: string;
  operateRange?: number;
}) {
  const currentResearch = options?.currentResearch === null
    ? undefined
    : {
        tech_id: options?.currentResearch?.tech_id ?? "electromagnetism",
        progress: options?.currentResearch?.progress ?? 4,
        total_cost: options?.currentResearch?.total_cost ?? 10,
        blocked_reason: "waiting_matrix",
      };
  return {
    active_planet_id: "planet-1-1",
    players: {
      p1: {
        player_id: "p1",
        is_alive: true,
        resources: {
          minerals: 100,
          energy: 80,
        },
        tech: {
          completed_techs: options?.completedTechIds ?? ["dyson_sphere_program"],
          ...(currentResearch ? { current_research: currentResearch } : {}),
        },
        ...(options?.executorUnitId
          ? {
              executor: {
                unit_id: options.executorUnitId,
                build_efficiency: 1,
                operate_range: options.operateRange ?? 6,
                concurrent_tasks: 1,
                research_boost: 0,
              },
            }
          : {}),
      },
    },
  };
}

function createClient() {
  return {
    getAuth: () => ({ playerId: "p1", playerKey: "key_player_1" }),
    cmdScanPlanet: vi.fn(),
    cmdStartResearch: vi.fn(),
    cmdTransferItem: vi.fn(),
    cmdSetRayReceiverMode: vi.fn(),
    cmdConfigureLogisticsSlot: vi.fn(),
    cmdConfigureLogisticsStation: vi.fn(),
    fetchEventSnapshot: vi.fn().mockResolvedValue({
      available_from_tick: 1,
      has_more: false,
      events: [],
    }),
  };
}

describe("PlanetCommandPanel", () => {
  beforeEach(() => {
    usePlanetViewStore.getState().resetForPlanet("planet-1-1");
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
  });

  it("保留玩家手动选择的物流槽位物品，即使 runtime 刷新", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    const runtime = createRuntime();

    const { rerender } = render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={runtime as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "物流" }));
    const itemSelect = await screen.findByLabelText("物品");
    await waitFor(() => {
      expect((itemSelect as HTMLSelectElement).value).toBe(
        "electromagnetic_matrix",
      );
    });

    await user.selectOptions(itemSelect, "silicon_ore");
    expect((itemSelect as HTMLSelectElement).value).toBe("silicon_ore");

    rerender(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={{ ...runtime } as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "物流" }));
    expect((screen.getByLabelText("物品") as HTMLSelectElement).value).toBe(
      "silicon_ore",
    );
  });

  it("保留玩家手动填写的槽位模式和本地库存，即使 runtime 刷新", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    const runtime = createRuntime();

    const { rerender } = render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={runtime as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "物流" }));
    const itemSelect = await screen.findByLabelText("物品");
    const modeSelect = screen.getByLabelText("物流模式");
    const localStorageInput = screen.getByLabelText("本地库存");

    await user.selectOptions(itemSelect, "silicon_ore");
    await user.selectOptions(modeSelect, "demand");
    await user.clear(localStorageInput);
    await user.type(localStorageInput, "60");

    expect((modeSelect as HTMLSelectElement).value).toBe("demand");
    expect((localStorageInput as HTMLInputElement).value).toBe("60");

    rerender(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={{ ...runtime } as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "物流" }));
    expect((screen.getByLabelText("物流模式") as HTMLSelectElement).value).toBe(
      "demand",
    );
    expect(
      (screen.getByLabelText("本地库存") as HTMLInputElement).value,
    ).toBe("60");
  });

  it("提交命令后会写入 pending journal，并等待 authoritative 回写", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    client.cmdScanPlanet.mockResolvedValue({
      request_id: "req-scan-1",
      accepted: true,
      enqueue_tick: 121,
      results: [
        {
          command_index: 0,
          status: "queued",
          code: "OK",
          message: "scan_planet accepted",
        },
      ],
    });

    render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
      />,
    );

    await user.click(screen.getByRole("button", { name: "扫描当前行星" }));

    await waitFor(() => {
      expect(client.cmdScanPlanet).toHaveBeenCalledWith("planet-1-1");
    });
    expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
      requestId: "req-scan-1",
      commandType: "scan_planet",
      planetId: "planet-1-1",
      status: "pending",
      acceptedMessage: "scan_planet accepted",
      enqueueTick: 121,
    });

    act(() => {
      usePlanetCommandStore.getState().ingestEvent({
        event_id: "evt-command-result-1",
        tick: 121,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: "req-scan-1",
          code: "OK",
          message: "planet scan complete",
        },
      } as never);
    });

    await waitFor(() => {
      expect(usePlanetCommandStore.getState().journal[0]).toMatchObject({
        requestId: "req-scan-1",
        status: "succeeded",
        authoritativeCode: "OK",
        authoritativeMessage: "planet scan complete",
      });
    });
  });

  it("按工作流分组命令并展示最近结果历史", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();

    act(() => {
      usePlanetCommandStore.getState().addJournalEntry({
        requestId: "req-research-1",
        commandType: "start_research",
        planetId: "planet-1-1",
        status: "failed",
        acceptedMessage: "start_research accepted",
        authoritativeCode: "WAITING_MATRIX",
        authoritativeMessage: "缺少 electromagnetic_matrix",
        nextHint: "先把 electromagnetic_matrix 装入研究站，再继续启动研究。",
      });
      usePlanetCommandStore.getState().addJournalEntry({
        requestId: "req-build-1",
        commandType: "build",
        planetId: "planet-1-1",
        status: "succeeded",
        acceptedMessage: "build accepted",
        authoritativeCode: "OK",
        authoritativeMessage: "wind_turbine 已开始施工",
      });
    });

    render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary() as never}
      />,
    );

    expect(screen.getByRole("tab", { name: "基础操作" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "研究与装料" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "物流" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "跨星球" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "戴森" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "研究与装料" }));

    expect(screen.getByText("当前研究")).toBeInTheDocument();
    expect(screen.getByText("开局推荐路径")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "装入建筑" }),
    ).toBeInTheDocument();
    expect(screen.getByText("最近结果")).toBeInTheDocument();
    expect(
      screen.getByText("先把 electromagnetic_matrix 装入研究站，再继续启动研究。"),
    ).toBeInTheDocument();
  });

  it("展示推荐路径与分组研究列表，并可启动当前可研究科技", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    client.cmdStartResearch.mockResolvedValue({
      request_id: "req-research-ui-1",
      accepted: true,
      enqueue_tick: 140,
      results: [
        {
          command_index: 0,
          status: "queued",
          code: "OK",
          message: "start_research accepted",
        },
      ],
    });

    render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program"],
          currentResearch: null,
        }) as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "研究与装料" }));

    expect(screen.getByText("开局推荐路径")).toBeInTheDocument();
    expect(
      screen.getByText("风机 -> 空研究站 -> 装 10 电磁矩阵 -> 研究 electromagnetism"),
    ).toBeInTheDocument();
    expect(screen.getByText("当前可研究")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("尚未满足前置")).toBeInTheDocument();

    const availableGroup = screen.getByRole("region", { name: "当前可研究" });
    const completedGroup = screen.getByRole("region", { name: "已完成" });
    const lockedGroup = screen.getByRole("region", { name: "尚未满足前置" });

    expect(within(availableGroup).getByRole("button", { name: /电磁学/ })).toBeInTheDocument();
    expect(within(completedGroup).getByText("戴森球计划")).toBeInTheDocument();
    expect(within(lockedGroup).getByText("能量矩阵")).toBeInTheDocument();

    await user.click(within(availableGroup).getByRole("button", { name: /电磁学/ }));
    await user.click(screen.getByRole("button", { name: "开始研究" }));

    await waitFor(() => {
      expect(client.cmdStartResearch).toHaveBeenCalledWith("electromagnetism");
    });
  });

  it("研究完成后隐藏开局推荐，并把科技移动到已完成分组", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();

    const { rerender } = render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program"],
          currentResearch: null,
        }) as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "研究与装料" }));
    expect(screen.getByText("开局推荐路径")).toBeInTheDocument();

    rerender(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program", "electromagnetism"],
          currentResearch: null,
        }) as never}
      />,
    );

    expect(screen.queryByText("开局推荐路径")).not.toBeInTheDocument();
    const completedGroup = screen.getByRole("region", { name: "已完成" });
    expect(within(completedGroup).getByText("电磁学")).toBeInTheDocument();
  });

  it("默认建造列表只显示已解锁建筑，高级模式展开后才显示未解锁与目录异常项", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();

    render(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program"],
        }) as never}
      />,
    );

    expect(
      screen.getByRole("option", { name: /风力涡轮机/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /矩阵研究站/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /特斯拉塔/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Planetary Logistics Station/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示高级建造" }));

    expect(
      screen.getByRole("option", { name: /特斯拉塔 · 未解锁/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Planetary Logistics Station · 目录异常/ }),
    ).toBeInTheDocument();
  });

  it("建造前检查展示执行体距离，并在超范围时提示切到移动工作流", () => {
    const planet = createPlanet();
    planet.units = {
      "exec-1": {
        id: "exec-1",
        type: "executor",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        attack: 0,
        defense: 0,
        attack_range: 0,
        move_range: 2,
        vision_range: 4,
        is_moving: false,
      },
    };

    act(() => {
      usePlanetViewStore.getState().setSelected({
        kind: "tile",
        position: { x: 5, y: 4, z: 0 },
      });
    });

    render(
      <PlanetCommandPanel
        catalog={createCatalog() as never}
        client={createClient() as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program"],
          executorUnitId: "exec-1",
          operateRange: 6,
        }) as never}
      />,
    );

    expect(screen.getByText("建造前检查")).toBeInTheDocument();
    expect(screen.getByText(/执行体 exec-1/)).toBeInTheDocument();
    expect(screen.getByText(/distance \/ operateRange = 7 \/ 6/)).toBeInTheDocument();
    expect(
      screen.getByText("当前执行体无法直接建造到目标坐标"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切到移动工作流" })).toBeInTheDocument();
  });
});
