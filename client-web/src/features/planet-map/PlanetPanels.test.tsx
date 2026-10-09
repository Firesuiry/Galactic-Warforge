import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogView } from "@shared/types";

import { usePlanetCommandStore } from "@/features/planet-commands/store";
import {
  PlanetActivityPanel,
  PlanetEntityPanel,
} from "@/features/planet-map/PlanetPanels";
import { usePlanetViewStore } from "@/features/planet-map/store";
import { useSessionStore } from "@/stores/session";

const { mockClient, mockSubmit } = vi.hoisted(() => ({
  mockClient: {
    cmdTransferItem: vi.fn(),
    fetchEventSnapshot: vi.fn().mockResolvedValue({ events: [] }),
  },
  mockSubmit: vi.fn(),
}));

vi.mock("@/hooks/use-api-client", () => ({ useApiClient: () => mockClient }));
vi.mock("@/features/planet-commands/executor", () => ({
  submitPlanetCommand: (input: { execute: () => Promise<unknown> }) =>
    mockSubmit(input),
}));

function createPlanet() {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 8,
    map_height: 8,
    tick: 120,
    terrain: Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => "buildable"),
    ),
    buildings: {
      "b-44": {
        id: "b-44",
        type: "mining_machine",
        owner_id: "p1",
        position: { x: 2, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 4,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "no_power",
          state_reason: "under_power",
        },
      },
    },
    units: {},
    resources: [],
  };
}

describe("PlanetActivityPanel", () => {
  beforeEach(() => {
    usePlanetViewStore.getState().resetForPlanet("planet-1-1");
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
  });

  it("默认关键反馈优先显示命令结果，并把告警翻译成玩家文案", () => {
    render(
      <PlanetActivityPanel
        alerts={[
          {
            alert_id: "alert-1",
            tick: 121,
            player_id: "p1",
            building_id: "b-44",
            building_type: "mining_machine",
            alert_type: "throughput_drop",
            severity: "warning",
            message: "building b-44 throughput drop detected",
            metrics: {
              throughput: 0,
              backlog: 3,
              idle_ratio: 0.2,
              efficiency: 0,
              input_shortage: true,
              output_blocked: true,
              power_state: "under_power",
            },
            details: {},
          },
        ]}
        events={[
          {
            event_id: "evt-command-1",
            tick: 122,
            event_type: "command_result",
            visibility_scope: "p1",
            payload: {
              request_id: "req-1",
              command_type: "build",
              message: "wind_turbine 已开始施工",
              code: "OK",
            },
          },
          {
            event_id: "evt-alert-1",
            tick: 121,
            event_type: "production_alert",
            visibility_scope: "p1",
            payload: {
              alert: {
                alert_id: "alert-1",
                tick: 121,
                player_id: "p1",
                building_id: "b-44",
                building_type: "mining_machine",
                alert_type: "throughput_drop",
                severity: "warning",
                message: "building b-44 throughput drop detected",
                metrics: {
                  throughput: 0,
                  backlog: 3,
                  idle_ratio: 0.2,
                  efficiency: 0,
                  input_shortage: true,
                  output_blocked: true,
                  power_state: "under_power",
                },
                details: {},
              },
            },
          },
        ]}
        planet={createPlanet() as never}
      />,
    );

    expect(screen.getByText("wind_turbine 已开始施工")).toBeInTheDocument();
    expect(screen.queryByText("产线告警")).not.toBeInTheDocument();
    expect(screen.getByText("采矿机 · (2, 1, 0)")).toBeInTheDocument();
    expect(screen.getByText("问题：产能下降")).toBeInTheDocument();
    expect(
      screen.getByText("建议：优先补原料，并检查供电与输出链路"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("building b-44 throughput drop detected"),
    ).not.toBeInTheDocument();
  });

  it("研究站（空 matrix_lab）的吞吐类告警不进入告警面板", () => {
    render(
      <PlanetActivityPanel
        alerts={[
          {
            alert_id: "alert-noise",
            tick: 121,
            player_id: "p1",
            building_id: "b-25",
            building_type: "matrix_lab",
            alert_type: "throughput_drop",
            severity: "warning",
            message: "building b-25 throughput drop detected",
            metrics: {
              throughput: 1,
              backlog: 0,
              idle_ratio: 0,
              efficiency: 0,
              input_shortage: false,
              output_blocked: false,
              power_state: "normal",
            },
            details: {},
          },
        ]}
        events={[]}
        planet={createPlanet() as never}
      />,
    );

    expect(screen.getByText("暂无告警")).toBeInTheDocument();
    expect(screen.queryByText(/矩阵研究站/)).not.toBeInTheDocument();
  });
});

describe("PlanetEntityPanel 建筑库存", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockImplementation((input: { execute: () => Promise<unknown> }) =>
      input.execute(),
    );
    mockClient.cmdTransferItem.mockResolvedValue({
      accepted: true,
      request_id: "r-transfer",
      results: [],
    });
    mockClient.fetchEventSnapshot.mockResolvedValue({ events: [] });
    usePlanetViewStore.getState().resetForPlanet("planet-1-1");
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
    useSessionStore.getState().setSession({
      serverUrl: "http://test.local",
      playerId: "p1",
      playerKey: "key",
    });
  });

  it("结构化展示本地存储/容量/产出速率，积压将满时给出警示", () => {
    const planet = createPlanet();
    (planet.buildings as Record<string, unknown>)["b-mine"] = {
      id: "b-mine",
      type: "mining_machine",
      owner_id: "p1",
      position: { x: 5, y: 1, z: 0 },
      hp: 100,
      max_hp: 100,
      level: 1,
      vision_range: 4,
      runtime: {
        params: {
          energy_consume: 1,
          energy_generate: 0,
          capacity: 0,
          maintenance_cost: { minerals: 0, energy: 0 },
          footprint: { width: 1, height: 1 },
        },
        functions: {
          storage: { capacity: 20 },
          collect: { resource_kind: "silicon_ore", yield_per_tick: 2 },
        },
        state: "running",
      },
      storage: { inventory: { silicon_ore: 19 } },
    };
    usePlanetViewStore.getState().setSelected({
      kind: "building",
      id: "b-mine",
      position: { x: 5, y: 1, z: 0 },
    });

    render(<PlanetEntityPanel planet={planet as never} />);

    expect(screen.getByText("库存与任务")).toBeInTheDocument();
    expect(screen.getByText(/硅矿 19（19\/20）/)).toBeInTheDocument();
    expect(screen.getByText(/存储将满/)).toBeInTheDocument();
    expect(screen.getByText("2/tick")).toBeInTheDocument();
    expect(screen.getByText("未配置")).toBeInTheDocument();
    // 不再是原始 JSON dump
    expect(document.querySelector(".planet-panel-stack .json-preview")).toBeNull();
  });

  it("无存储数据时显示空库存与未配置配方", () => {
    const planet = createPlanet();
    usePlanetViewStore.getState().setSelected({
      kind: "building",
      id: "b-44",
      position: { x: 2, y: 1, z: 0 },
    });

    render(<PlanetEntityPanel planet={planet as never} />);

    expect(screen.getByText("库存与任务")).toBeInTheDocument();
    expect(screen.queryByText(/存储将满/)).not.toBeInTheDocument();
    expect(screen.getByText("未配置")).toBeInTheDocument();
  });

  it("生产建筑详情提供「取出」控件：下拉列库存与输出缓存去重，提交 to_player 转运", async () => {
    const planet = createPlanet();
    (planet.buildings as Record<string, unknown>)["b-smelt"] = {
      id: "b-smelt",
      type: "smelter",
      owner_id: "p1",
      position: { x: 3, y: 3, z: 0 },
      hp: 100,
      max_hp: 100,
      level: 1,
      vision_range: 4,
      runtime: {
        params: {
          energy_consume: 1,
          energy_generate: 0,
          capacity: 0,
          maintenance_cost: { minerals: 0, energy: 0 },
          footprint: { width: 2, height: 2 },
        },
        functions: { storage: { capacity: 50 } },
        state: "running",
      },
      // 本地库存与输出缓存含同一物品 → 下拉去重
      storage: { inventory: { iron_ingot: 12 }, output_buffer: { iron_ingot: 3, copper_ingot: 5 } },
      production: { recipe_id: "iron_ingot" },
    };
    const catalog = {
      items: [
        { id: "iron_ingot", name: "铁块" },
        { id: "copper_ingot", name: "铜锭" },
      ],
    } as CatalogView;
    usePlanetViewStore.getState().setSelected({
      kind: "building",
      id: "b-smelt",
      position: { x: 3, y: 3, z: 0 },
    });

    render(<PlanetEntityPanel catalog={catalog} planet={planet as never} />);

    const select = screen.getByRole("combobox", { name: "取出物品" });
    expect(
      Array.from(select.querySelectorAll("option")).map((option) => option.textContent),
    ).toEqual(["选择物品", "铁块", "铜锭"]);

    const button = screen.getByRole("button", { name: "取出" });
    // 未选物品 → 禁用
    expect(button).toBeDisabled();

    fireEvent.change(select, { target: { value: "iron_ingot" } });
    // 数量非正整数 → 仍禁用
    fireEvent.change(screen.getByLabelText("取出数量"), { target: { value: "0" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("取出数量"), { target: { value: "4" } });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockClient.cmdTransferItem).toHaveBeenCalledWith(
      "b-smelt",
      "iron_ingot",
      4,
      "planet-1-1",
      "to_player",
    );
  });

  it("非本方建筑的取出控件禁用", () => {
    const planet = createPlanet();
    (planet.buildings as Record<string, unknown>)["b-enemy"] = {
      id: "b-enemy",
      type: "smelter",
      owner_id: "p2",
      position: { x: 6, y: 6, z: 0 },
      hp: 100,
      max_hp: 100,
      level: 1,
      vision_range: 4,
      runtime: {
        params: {
          energy_consume: 1,
          energy_generate: 0,
          capacity: 0,
          maintenance_cost: { minerals: 0, energy: 0 },
          footprint: { width: 2, height: 2 },
        },
        functions: {},
        state: "running",
      },
      storage: { inventory: { iron_ingot: 2 } },
    };
    usePlanetViewStore.getState().setSelected({
      kind: "building",
      id: "b-enemy",
      position: { x: 6, y: 6, z: 0 },
    });

    render(<PlanetEntityPanel planet={planet as never} />);

    expect(screen.getByRole("combobox", { name: "取出物品" })).toBeDisabled();
    expect(screen.getByLabelText("取出数量")).toBeDisabled();
    expect(screen.getByRole("button", { name: "取出" })).toBeDisabled();
  });
});
