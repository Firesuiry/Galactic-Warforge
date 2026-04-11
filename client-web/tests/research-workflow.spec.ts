import { expect, test, type Page } from "@playwright/test";

function createCatalog() {
  return {
    items: [
      { id: "electromagnetic_matrix", name: "电磁矩阵", category: "science", form: "item", stack_limit: 100, unit_volume: 1, icon_key: "electromagnetic_matrix", color: "#7dd3fc" },
      { id: "solar_sail", name: "太阳帆", category: "intermediate", form: "item", stack_limit: 100, unit_volume: 1, icon_key: "solar_sail", color: "#fde68a" },
      { id: "small_carrier_rocket", name: "小型运载火箭", category: "intermediate", form: "item", stack_limit: 100, unit_volume: 1, icon_key: "small_carrier_rocket", color: "#fca5a5" },
    ],
    buildings: [
      { id: "matrix_lab", name: "矩阵研究站", category: "research", subcategory: "research", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "matrix_lab", color: "#7dd3fc" },
      { id: "tesla_tower", name: "特斯拉塔", category: "power", subcategory: "power", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "tesla_tower", color: "#93c5fd" },
      { id: "em_rail_ejector", name: "电磁弹射器", category: "space", subcategory: "space", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "em_rail_ejector", color: "#fcd34d" },
      { id: "vertical_launching_silo", name: "垂直发射井", category: "space", subcategory: "space", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "vertical_launching_silo", color: "#fca5a5" },
      { id: "ray_receiver", name: "射线接收站", category: "space", subcategory: "space", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "ray_receiver", color: "#c4b5fd" },
    ],
    recipes: [
      { id: "magnet_recipe", name: "磁铁配方", inputs: [], outputs: [], duration: 1, energy_cost: 1, icon_key: "magnet_recipe", color: "#9ca3af" },
    ],
    techs: [
      { id: "dyson_sphere_program", name: "戴森球计划", category: "main", type: "main", level: 0, prerequisites: [], cost: [], unlocks: [{ type: "building", id: "matrix_lab" }], icon_key: "dyson_sphere_program", color: "#93c5fd" },
      { id: "electromagnetism", name: "电磁学", category: "main", type: "main", level: 1, prerequisites: ["dyson_sphere_program"], cost: [{ item_id: "electromagnetic_matrix", quantity: 10 }], unlocks: [{ type: "building", id: "tesla_tower" }, { type: "recipe", id: "magnet_recipe" }], icon_key: "electromagnetism", color: "#7dd3fc" },
      { id: "energy_matrix", name: "能量矩阵", category: "main", type: "energy", level: 2, prerequisites: ["electromagnetism"], cost: [{ item_id: "electromagnetic_matrix", quantity: 20 }], unlocks: [{ type: "special", id: "red_science" }], icon_key: "energy_matrix", color: "#fca5a5" },
    ],
  };
}

function createScene() {
  return {
    planet_id: "planet-1-1",
    system_id: "sys-1",
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
      "lab-1": {
        id: "lab-1",
        type: "matrix_lab",
        owner_id: "p1",
        position: { x: 1, y: 1, z: 0 },
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
          state: "running",
        },
      },
      "silo-1": {
        id: "silo-1",
        type: "vertical_launching_silo",
        owner_id: "p1",
        position: { x: 1, y: 2, z: 0 },
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
          state: "running",
        },
      },
      "ray-1": {
        id: "ray-1",
        type: "ray_receiver",
        owner_id: "p1",
        position: { x: 2, y: 2, z: 0 },
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
          state: "running",
        },
      },
    },
    units: {},
    resources: [],
    building_count: 4,
    unit_count: 0,
    resource_count: 0,
  };
}

function createRuntime() {
  return {
    planet_id: "planet-1-1",
    discovered: true,
    available: true,
    tick: 120,
    logistics_stations: [],
    logistics_drones: [],
    logistics_ships: [],
    construction_tasks: [],
    threat_level: 0,
  };
}

function createSystem() {
  return {
    system_id: "sys-1",
    name: "Aster",
    discovered: true,
    planets: [
      {
        planet_id: "planet-1-1",
        name: "Gaia",
        discovered: true,
      },
    ],
  };
}

function createSystemRuntime() {
  return {
    system_id: "sys-1",
    discovered: true,
    available: true,
    dyson_sphere: {
      layers: [
        {
          layer_index: 0,
          orbit_radius: 1.2,
          energy_output: 0,
          nodes: [],
        },
      ],
    },
  };
}

function createStats() {
  return {
    player_id: "p1",
    tick: 120,
    production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 1 },
    energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
    logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
    combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
  };
}

function createSummary(completedTechIds: string[]) {
  return {
    tick: 120,
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
          player_id: "p1",
          completed_techs: completedTechIds,
        },
      },
    },
  };
}

async function installSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "siliconworld-client-web-session",
      JSON.stringify({
        state: {
          serverUrl: "http://127.0.0.1:4173",
          playerId: "p1",
          playerKey: "key_player_1",
        },
        version: 0,
      }),
    );
  });
}

async function installPlanetRoutes(
  page: Page,
  options: { completedTechIds: string[] },
) {
  let completedTechIds = [...options.completedTechIds];
  const pendingEvents: Array<Record<string, unknown>> = [];
  const commandRequests: Array<Record<string, unknown>> = [];

  await installSession(page);

  await page.route("**/events/stream**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
      body: 'event: connected\ndata: {"player_id":"p1","event_types":["command_result","research_completed"]}\n\n',
    });
  });

  await page.route("**/state/summary", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createSummary(completedTechIds)),
    });
  });

  await page.route("**/state/stats", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createStats()),
    });
  });

  await page.route("**/catalog", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createCatalog()),
    });
  });

  await page.route("**/world/planets/planet-1-1/scene**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createScene()),
    });
  });

  await page.route("**/world/planets/planet-1-1/runtime", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createRuntime()),
    });
  });

  await page.route("**/world/planets/planet-1-1/networks", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        planet_id: "planet-1-1",
        discovered: true,
        available: true,
        tick: 120,
      }),
    });
  });

  await page.route("**/world/planets/planet-1-1/overview**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        planet_id: "planet-1-1",
        system_id: "sys-1",
        discovered: true,
        kind: "terrestrial",
        map_width: 4,
        map_height: 4,
        tick: 120,
        step: 100,
        cells_width: 1,
        cells_height: 1,
        terrain: [["buildable"]],
        visible: [[true]],
        explored: [[true]],
        resource_counts: [[0]],
        building_counts: [[4]],
        unit_counts: [[0]],
      }),
    });
  });

  await page.route("**/world/systems/sys-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createSystem()),
    });
  });

  await page.route("**/world/systems/sys-1/runtime", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createSystemRuntime()),
    });
  });

  await page.route("**/events/snapshot**", async (route) => {
    const events = pendingEvents.splice(0, pendingEvents.length);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        available_from_tick: 1,
        has_more: false,
        events,
      }),
    });
  });

  await page.route("**/alerts/production/snapshot**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        available_from_tick: 1,
        has_more: false,
        alerts: [],
      }),
    });
  });

  await page.route("**/commands", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    commandRequests.push(request);
    const requestId = String(request.request_id ?? `req-${commandRequests.length}`);
    const command = (request.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const commandType = String(command.type ?? "");

    if (commandType === "start_research") {
      pendingEvents.push({
        event_id: `evt-${requestId}`,
        tick: 121,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: requestId,
          code: "OK",
          message: "research started",
        },
      });
    }

    if (commandType === "transfer_item") {
      pendingEvents.push({
        event_id: `evt-${requestId}`,
        tick: 122,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: requestId,
          code: "OK",
          message: "items transferred",
        },
      });
    }

    if (commandType === "set_ray_receiver_mode") {
      pendingEvents.push({
        event_id: `evt-${requestId}`,
        tick: 123,
        event_type: "command_result",
        visibility_scope: "p1",
        payload: {
          request_id: requestId,
          code: "OK",
          message: "mode switched",
        },
      });
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        request_id: requestId,
        accepted: true,
        enqueue_tick: 121,
        results: [
          {
            command_index: 0,
            status: "queued",
            code: "OK",
            message: `${commandType} accepted`,
          },
        ],
      }),
    });
  });

  return {
    commandRequests,
    setCompletedTechIds(nextIds: string[]) {
      completedTechIds = [...nextIds];
    },
  };
}

test("默认新局在浏览器中展示推荐路径、分组研究列表并可启动 electromagnetism", async ({ page }) => {
  const scenario = await installPlanetRoutes(page, {
    completedTechIds: ["dyson_sphere_program"],
  });

  await page.goto("/planet/planet-1-1");
  await expect(page.getByRole("heading", { name: "Gaia" })).toBeVisible();
  await page.getByRole("tab", { name: "研究与装料" }).click();

  await expect(page.getByText("开局推荐路径")).toBeVisible();
  await expect(page.getByText("风机 -> 空研究站 -> 装 10 电磁矩阵 -> 研究 electromagnetism")).toBeVisible();
  await expect(page.getByRole("region", { name: "当前可研究" })).toContainText("电磁学");
  await expect(page.getByRole("region", { name: "已完成" })).toContainText("戴森球计划");
  await expect(page.getByRole("region", { name: "尚未满足前置" })).toContainText("能量矩阵");

  await page.getByRole("button", { name: /电磁学/ }).click();
  await page.getByRole("button", { name: "开始研究" }).click();

  await expect
    .poll(() => (
      (
        scenario.commandRequests[0]?.commands as Array<Record<string, unknown>> | undefined
      )?.[0]?.type
    ))
    .toBe("start_research");
  await expect(
    page.locator(".command-result").filter({ hasText: "research started" }),
  ).toBeVisible({ timeout: 4000 });
});

test("midgame 在浏览器中按建筑上下文展示装料与射线接收站提示", async ({ page }) => {
  await installPlanetRoutes(page, {
    completedTechIds: ["dyson_sphere_program", "electromagnetism", "energy_matrix"],
  });

  await page.goto("/planet/planet-1-1");
  await expect(page.getByRole("heading", { name: "Gaia" })).toBeVisible();
  await page.getByRole("tab", { name: "研究与装料" }).click();

  await page.getByLabel("建筑 ID").selectOption("ejector-1");
  await page.getByLabel("装料物品").selectOption("solar_sail");
  await page.getByRole("button", { name: "装入建筑" }).click();
  await expect(
    page.locator(".command-result").filter({
      hasText: "太阳帆已装入电磁弹射器，下一步可发射太阳帆扩展戴森云。",
    }),
  ).toBeVisible({ timeout: 4000 });

  await page.getByLabel("建筑 ID").selectOption("silo-1");
  await page.getByLabel("装料物品").selectOption("small_carrier_rocket");
  await page.getByRole("button", { name: "装入建筑" }).click();
  await expect(
    page.locator(".command-result").filter({
      hasText: "火箭已装入发射井，下一步可发射火箭构建戴森球结构。",
    }),
  ).toBeVisible({ timeout: 4000 });

  await page.getByRole("tab", { name: "戴森" }).click();
  const rayReceiverSection = page.locator(".planet-side-section").filter({ hasText: "射线接收站" });
  await rayReceiverSection.getByLabel("建筑 ID").selectOption("ray-1");
  await rayReceiverSection.getByLabel("模式").selectOption("power");
  await rayReceiverSection.getByRole("button", { name: "切换射线接收站模式" }).click();
  await expect(
    page.locator(".command-result").filter({
      hasText: "射线接收站已切到 power，下一步观察电网回灌是否生效。",
    }),
  ).toBeVisible({ timeout: 4000 });
});
