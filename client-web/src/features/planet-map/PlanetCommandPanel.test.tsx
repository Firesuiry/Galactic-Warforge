import { act, render, screen, waitFor } from "@testing-library/react";
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
      { id: "silicon_ore", name: "S Item" },
    ],
    buildings: [
      {
        id: "planetary_logistics_station",
        name: "Planetary Logistics Station",
        buildable: true,
      },
    ],
    recipes: [],
    techs: [],
  };
}

function createSummary() {
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
          current_research: {
            tech_id: "electromagnetism",
          },
        },
      },
    },
  };
}

function createClient() {
  return {
    getAuth: () => ({ playerId: "p1", playerKey: "key_player_1" }),
    cmdScanPlanet: vi.fn(),
    cmdConfigureLogisticsSlot: vi.fn(),
    cmdConfigureLogisticsStation: vi.fn(),
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
        "annihilation_constraint_sphere",
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

    expect(
      screen.getByRole("button", { name: "开始研究" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "装入建筑" }),
    ).toBeInTheDocument();
    expect(screen.getByText("最近结果")).toBeInTheDocument();
    expect(
      screen.getByText("先把 electromagnetic_matrix 装入研究站，再继续启动研究。"),
    ).toBeInTheDocument();
  });
});
