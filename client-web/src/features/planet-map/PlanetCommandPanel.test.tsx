import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { usePlanetCommandStore } from "@/features/planet-commands/store";
import {
  parseCommandWorkflowId,
  PlanetCommandPanel,
} from "@/features/planet-map/PlanetCommandPanel";
import { usePlanetViewStore } from "@/features/planet-map/store";

function renderPanel(
  ui: React.ReactElement,
  options?: { initialEntries?: string[] },
) {
  const entries = options?.initialEntries ?? ["/planet/planet-1-1"];
  const wrap = (node: React.ReactElement) => (
    <MemoryRouter initialEntries={entries}>{node}</MemoryRouter>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: React.ReactElement) => result.rerender(wrap(next)),
  };
}

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

/** 没有存储的纯发电建筑（试玩 1014 问题 2 的反例：不能作为装料目标）。 */
function windTurbineBuilding() {
  return {
    id: "wind-1",
    type: "wind_turbine",
    owner_id: "p1",
    position: { x: 0, y: 0, z: 0 },
    hp: 120,
    max_hp: 120,
    level: 1,
    vision_range: 2,
    runtime: {
      params: {
        energy_consume: 0,
        energy_generate: 10,
        capacity: 0,
        maintenance_cost: { minerals: 0, energy: 0 },
        footprint: { width: 1, height: 1 },
      },
      functions: { energy: { output_per_tick: 10 } },
      state: "running",
    },
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
          energy: 100, energy_capacity: 1000, charge_per_tick: 10, last_charge_tick: 1, last_charge_amount: 10, slot_capacity: 3, item_capacity: 200,
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
  /** 玩家背包（装料只从背包扣，数量提示依赖它）。 */
  inventory?: Record<string, number>;
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
        ...(options?.inventory ? { inventory: options.inventory } : {}),
        resources: {
          minerals: 100,
          energy: 80,
        },
        tech: {
          completed_techs: options?.completedTechIds ?? ["dyson_sphere_program"],
          ...(currentResearch ? { current_research: currentResearch } : {}),
        },
      },
    },
  };
}

function createClient() {
  return {
    getAuth: () => ({ playerId: "p1", playerKey: "key_player_1" }),
    cmdScanPlanet: vi.fn(),
    cmdStartResearch: vi.fn(),
    cmdTransferItem: vi.fn().mockResolvedValue({
      request_id: "req-transfer-1",
      accepted: true,
      enqueue_tick: 121,
      results: [],
    }),
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

/** 有存储、无配方、无研究模块的建筑（补给站/储物仓一类的装料目标）。 */
function supplyStationBuilding(id = "supply-1") {
  return {
    id,
    type: "supply_station",
    owner_id: "p1",
    position: { x: 3, y: 3, z: 0 },
    hp: 300,
    max_hp: 300,
    level: 1,
    vision_range: 3,
    runtime: {
      params: {
        energy_consume: 0,
        energy_generate: 0,
        capacity: 1000,
        maintenance_cost: { minerals: 0, energy: 0 },
        footprint: { width: 1, height: 1 },
      },
      functions: { storage: { capacity: 1000 } },
      state: "running",
    },
    storage: { capacity: 1000, inventory: {} },
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

    const { rerender } = renderPanel(
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

    const { rerender } = renderPanel(
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

    renderPanel(
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

    renderPanel(
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

    renderPanel(
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
      screen.getByText(
        "风力涡轮机供电 -> 矿机开采铁矿/铜矿 -> 熔炉冶炼铁块/铜块 -> 装配机加工磁线圈/电路板 -> 合成 10 电磁矩阵装入研究站 -> 研究电磁学",
      ),
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

    const { rerender } = renderPanel(
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

  it("未解锁 dirac_inversion 时禁用 photon 模式并直接提示前置科技", async () => {
    const user = userEvent.setup();

    renderPanel(
      <PlanetCommandPanel
        catalog={createCatalog() as never}
        client={createClient() as never}
        planet={createPlanet() as never}
        runtime={createRuntime() as never}
        summary={createSummary({
          completedTechIds: ["dyson_sphere_program", "energy_matrix"],
        }) as never}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "戴森" }));

    expect(
      screen.getByRole("option", { name: /photon .*未解锁/ }),
    ).toBeDisabled();
    expect(screen.getByText(/缺少科技.*狄拉克反演/)).toBeInTheDocument();
  });

  it("parseCommandWorkflowId 校验合法 workflow", () => {
    expect(parseCommandWorkflowId("research")).toBe("research");
    expect(parseCommandWorkflowId("dyson")).toBe("dyson");
    expect(parseCommandWorkflowId("nope")).toBe("basic");
    expect(parseCommandWorkflowId(null)).toBe("basic");
  });

  it("initialWorkflow 深链落到研究 Tab", () => {
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        initialWorkflow="research"
      />,
    );
    expect(screen.getByRole("tab", { name: "研究与装料" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("建造任务列表显示中文建筑名与排队原因（不露 b-92）", () => {
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    const runtime = {
      ...createRuntime(),
      construction_tasks: [
        {
          id: "task-7",
          player_id: "p1",
          building_type: "wind_turbine",
          building_name: "风力涡轮机",
          position: { x: 2, y: 3, z: 0 },
          state: "pending",
          wait_reason: "executor_concurrent_limit",
          enqueue_tick: 100,
        },
      ],
    };
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={runtime as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=cancel"] },
    );
    const note = screen.getByTestId("construction-wait-note");
    expect(note).toHaveTextContent("风力涡轮机");
    expect(note).toHaveTextContent("排队中：执行体正在施工其他任务，排队等待");
    expect(note).not.toHaveTextContent("task-7");
    const option = within(screen.getByLabelText("待取消任务")).getByRole("option", { name: /风力涡轮机/ });
    expect(option).toHaveTextContent("排队中：执行体正在施工其他任务，排队等待");
  });

  it("URL ?workflow=dyson 落到戴森 Tab", () => {
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=dyson"] },
    );
    expect(screen.getByRole("tab", { name: "戴森" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("回归（试玩 1013 bug-1013-5）：研究站装料时玩家选好的物品不被强制改回电磁矩阵", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    // 研究站只列矩阵（P4 过滤）：目录里再加一种矩阵，才能验证「玩家换成另一种矩阵后
    // 不会被 effect 重置回电磁矩阵」。
    const baseCatalog = createCatalog();
    const catalog = {
      ...baseCatalog,
      items: [...baseCatalog.items, { id: "energy_matrix", name: "能量矩阵" }],
    };
    const client = createClient();
    const runtime = createRuntime();

    const { rerender } = renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={runtime as never}
        summary={
          createSummary({
            inventory: { electromagnetic_matrix: 3, energy_matrix: 2 },
          }) as never
        }
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    // 选中研究站：物品默认给电磁矩阵。
    await user.selectOptions(screen.getByLabelText("建筑 ID"), "lab-1");
    const itemSelect = await screen.findByLabelText("装料物品");
    await waitFor(() => {
      expect((itemSelect as HTMLSelectElement).value).toBe(
        "electromagnetic_matrix",
      );
    });

    // 玩家改成能量矩阵：旧实现每次 effect 都把 matrix_lab 目标重置回电磁矩阵。
    await user.selectOptions(itemSelect, "energy_matrix");
    expect((itemSelect as HTMLSelectElement).value).toBe("energy_matrix");

    // 服务端刷新（新对象引用）后仍然保持玩家选择。
    rerender(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={{ ...runtime } as never}
        summary={
          createSummary({
            inventory: { electromagnetic_matrix: 3, energy_matrix: 2 },
          }) as never
        }
      />,
    );
    expect((screen.getByLabelText("装料物品") as HTMLSelectElement).value).toBe(
      "energy_matrix",
    );
  });

  it("回归（试玩 1014 问题 2）：装料目标只列有存储的建筑，默认不再选中风机", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    // 在默认场景上追加一台没有存储的风机：旧实现会把它当成装料目标（必然让第一次
    // 「装入建筑」报「目标建筑没有存储」）。
    (planet.buildings as Record<string, unknown>)["wind-1"] = windTurbineBuilding();
    const catalog = createCatalog();
    const client = createClient();

    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary() as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    const buildingSelect = (await screen.findByLabelText(
      "建筑 ID",
    )) as HTMLSelectElement;
    const optionIds = Array.from(buildingSelect.options).map(
      (option) => option.value,
    );
    // 风机没有存储：不列在选项里（研究站优先排第一）。
    expect(optionIds).not.toContain("wind-1");
    expect(optionIds).toContain("lab-1");
    await waitFor(() => {
      expect(buildingSelect.value).toBe("lab-1");
    });
  });

  it("自有建筑都没有存储时禁用装料表单并说明原因", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    // 只留风机：装料下拉没有任何可选项，按钮禁用且给出解释。
    planet.buildings = { "wind-1": windTurbineBuilding() } as never;
    const catalog = createCatalog();
    const client = createClient();

    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary() as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    const buildingSelect = await screen.findByLabelText("建筑 ID");
    expect(buildingSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: "装入建筑" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "当前星球的自有建筑都没有存储",
    );
  });

  it("回归（试玩 1013 C）：背包数量不足时禁用「装入建筑」并说明背包里只有几个", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    const catalog = createCatalog();
    const client = createClient();
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({ inventory: { electromagnetic_matrix: 4 } }) as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    const itemSelect = await screen.findByLabelText("装料物品");
    await user.selectOptions(screen.getByLabelText("建筑 ID"), "lab-1");
    await waitFor(() => {
      expect((itemSelect as HTMLSelectElement).value).toBe(
        "electromagnetic_matrix",
      );
    });
    // 默认数量 10 > 背包 4：按钮禁用并说明差多少。
    expect(screen.getByRole("button", { name: "装入建筑" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("背包里只有 4 个");

    // 数量降到背包持有量以内：按钮恢复可用。
    const quantity = screen.getByLabelText("数量");
    await user.clear(quantity);
    await user.type(quantity, "4");
    expect(screen.getByRole("button", { name: "装入建筑" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("回归（试玩 1014 层 04 P4）：装料物品下拉只列「背包里有 ∩ 目标建筑会收」", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    // 加一台带配方（smelt_iron，输入铁矿）的电弧熔炉：装料物品只该出现铁矿。
    (planet.buildings as Record<string, unknown>)["smelter-1"] = {
      id: "smelter-1",
      type: "arc_smelter",
      owner_id: "p1",
      position: { x: 0, y: 3, z: 0 },
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
        functions: { production: {} },
        state: "running",
      },
      storage: { inventory: { iron_ore: 5 } },
      production: { recipe_id: "smelt_iron" },
    };
    const baseCatalog = createCatalog();
    const catalog = {
      ...baseCatalog,
      items: [...baseCatalog.items, { id: "iron_ore", name: "铁矿" }],
      recipes: [
        ...baseCatalog.recipes,
        {
          id: "smelt_iron",
          name: "铁块",
          inputs: [{ item_id: "iron_ore", quantity: 1 }],
          outputs: [{ item_id: "iron_ingot", quantity: 1 }],
        },
      ],
    };
    const client = createClient();
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={
          createSummary({
            inventory: { iron_ore: 30, electromagnetic_matrix: 2 },
          }) as never
        }
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    const buildingSelect = (await screen.findByLabelText(
      "建筑 ID",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(buildingSelect.options).map((o) => o.value)).toContain(
        "smelter-1",
      );
    });
    await user.selectOptions(buildingSelect, "smelter-1");

    const itemSelect = (await screen.findByLabelText("装料物品")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(itemSelect.options).map((o) => o.value)).toEqual([
        "",
        "iron_ore",
      ]);
    });
  });

  it("回归（试玩 1014 层 04 P4）：背包里没有目标建筑会收的物品时禁用下拉并说明原因", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    // 研究站只吃矩阵（runtime.functions.research 是服务端判定研究模式的依据），
    // 背包里只有硅矿：下拉没有可选项。
    (planet.buildings as Record<string, unknown>)["lab-1"] = {
      ...(planet.buildings as Record<string, any>)["lab-1"],
      runtime: {
        ...(planet.buildings as Record<string, any>)["lab-1"].runtime,
        functions: { research: { research_per_tick: 1 } },
      },
    };
    const baseCatalog = createCatalog();
    const catalog = {
      ...baseCatalog,
      // 目录里的物品带 category（服务端 /catalog 一直如此）：研究站「只吃矩阵」
      // 的过滤按 category === "matrix" 判定。
      items: baseCatalog.items.map((item) => ({
        ...item,
        category: item.id.endsWith("_matrix") ? "matrix" : "material",
      })),
    };
    const client = createClient();
    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({ inventory: { silicon_ore: 5 } }) as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    await user.selectOptions(await screen.findByLabelText("建筑 ID"), "lab-1");
    const itemSelect = (await screen.findByLabelText("装料物品")) as HTMLSelectElement;
    await waitFor(() => {
      expect(itemSelect).toBeDisabled();
    });
    expect(screen.getByRole("status")).toHaveTextContent("只接受矩阵");
    expect(screen.getByRole("button", { name: "装入建筑" })).toBeDisabled();
  });

  it("回归（试玩 1014 层 12 P1）：提交的 building_id 必须等于下拉里显示的建筑（选中变化只同步一次）", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    (planet.buildings as Record<string, unknown>)["supply-1"] = supplyStationBuilding();
    const baseCatalog = createCatalog();
    const catalog = {
      ...baseCatalog,
      items: [...baseCatalog.items, { id: "iron_ingot", name: "铁块" }],
    };
    const client = createClient();
    const inventory = { electromagnetic_matrix: 10, iron_ingot: 10 };

    const { rerender } = renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={createSummary({ inventory }) as never}
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    const buildingSelect = (await screen.findByLabelText(
      "建筑 ID",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(buildingSelect.value).toBe("lab-1");
    });

    // 玩家手动把目标改成补给站（地图选中仍停在研究站上）。
    await user.selectOptions(buildingSelect, "supply-1");
    expect(buildingSelect.value).toBe("supply-1");

    // 服务端每 2 秒换一次 /scene 引用：旧实现的地图选中同步 effect 每次重跑，
    // 会把玩家刚选的补给站改回研究站（回执里就成了「已装入…至矩阵研究站」）。
    for (let refresh = 0; refresh < 3; refresh += 1) {
      rerender(
        <PlanetCommandPanel
          catalog={catalog as never}
          client={client as never}
          // /scene 轮询 + SSE 失效都会换掉 buildings 的引用：同步 effect 的依赖随之变化。
          planet={{ ...planet, buildings: { ...planet.buildings } } as never}
          runtime={{ ...createRuntime() } as never}
          summary={createSummary({ inventory }) as never}
        />,
      );
    }
    expect(
      (screen.getByLabelText("建筑 ID") as HTMLSelectElement).value,
    ).toBe("supply-1");

    const quantity = screen.getByLabelText("数量");
    await user.clear(quantity);
    await user.type(quantity, "5");
    await user.click(screen.getByRole("button", { name: "装入建筑" }));

    await waitFor(() => {
      expect(client.cmdTransferItem).toHaveBeenCalled();
    });
    // 回执目标 = 下拉显示的建筑（两者同源，结构上不可能分叉）。
    expect(client.cmdTransferItem.mock.calls[0][0]).toBe("supply-1");
  });

  it("回归（试玩 1014 层 12 P2）：装入结算后回调 onCommandSettled，让背包数量立刻刷新", async () => {
    const user = userEvent.setup();
    const planet = createPlanet();
    (planet.buildings as Record<string, unknown>)["supply-1"] = supplyStationBuilding();
    const baseCatalog = createCatalog();
    const catalog = {
      ...baseCatalog,
      items: [...baseCatalog.items, { id: "iron_ingot", name: "铁块" }],
    };
    const client = createClient();
    const onCommandSettled = vi.fn();

    renderPanel(
      <PlanetCommandPanel
        catalog={catalog as never}
        client={client as never}
        onCommandSettled={onCommandSettled}
        planet={planet as never}
        runtime={createRuntime() as never}
        summary={
          createSummary({
            inventory: { electromagnetic_matrix: 10, iron_ingot: 10 },
          }) as never
        }
      />,
      { initialEntries: ["/planet/planet-1-1?workflow=research"] },
    );

    await user.selectOptions(await screen.findByLabelText("建筑 ID"), "supply-1");
    const quantity = screen.getByLabelText("数量");
    await user.clear(quantity);
    await user.type(quantity, "4");
    await user.click(screen.getByRole("button", { name: "装入建筑" }));

    await waitFor(() => {
      expect(onCommandSettled).toHaveBeenCalled();
    });
  });

});
