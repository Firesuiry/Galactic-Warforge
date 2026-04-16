import { expect, test, type Page } from "@playwright/test";

function createCatalog() {
  return {
    items: [
      { id: "electromagnetic_matrix", name: "电磁矩阵", category: "science", form: "item", stack_limit: 100, unit_volume: 1, icon_key: "electromagnetic_matrix", color: "#7dd3fc" },
    ],
    buildings: [
      { id: "planetary_logistics_station", name: "Planetary Logistics Station", category: "logistics", subcategory: "logistics", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, icon_key: "planetary_logistics_station", color: "#d1d5db" },
      { id: "wind_turbine", name: "风力涡轮机", category: "power", subcategory: "power", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, unlock_tech: ["dyson_sphere_program"], icon_key: "wind_turbine", color: "#86efac" },
      { id: "matrix_lab", name: "矩阵研究站", category: "research", subcategory: "research", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, unlock_tech: ["dyson_sphere_program"], icon_key: "matrix_lab", color: "#7dd3fc" },
      { id: "tesla_tower", name: "特斯拉塔", category: "power", subcategory: "power", footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1, items: [] }, buildable: true, unlock_tech: ["electromagnetism"], icon_key: "tesla_tower", color: "#93c5fd" },
    ],
    recipes: [],
    techs: [
      { id: "dyson_sphere_program", name: "戴森球计划", category: "main", type: "main", level: 0, prerequisites: [], cost: [], unlocks: [{ type: "building", id: "matrix_lab" }], icon_key: "dyson_sphere_program", color: "#93c5fd" },
      { id: "electromagnetism", name: "电磁学", category: "main", type: "main", level: 1, prerequisites: ["dyson_sphere_program"], cost: [{ item_id: "electromagnetic_matrix", quantity: 10 }], unlocks: [{ type: "building", id: "tesla_tower" }], icon_key: "electromagnetism", color: "#7dd3fc" },
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
    map_width: 8,
    map_height: 8,
    tick: 120,
    bounds: { x: 0, y: 0, width: 8, height: 8 },
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "buildable")),
    visible: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => true)),
    explored: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => true)),
    environment: {
      wind_factor: 0.8,
      light_factor: 1.1,
    },
    buildings: {
      "lab-1": {
        id: "lab-1",
        type: "matrix_lab",
        owner_id: "p1",
        position: { x: 5, y: 4, z: 0 },
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
    units: {
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
    },
    resources: [],
    building_count: 1,
    unit_count: 1,
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

function createSummary() {
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
        executor: {
          unit_id: "exec-1",
          build_efficiency: 1,
          operate_range: 6,
          concurrent_tasks: 1,
          research_boost: 0,
        },
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
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

async function installPlanetRoutes(page: Page) {
  await installSession(page);

  await page.route("**/events/stream**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
      body: 'event: connected\ndata: {"player_id":"p1","event_types":["command_result","building_state_changed"]}\n\n',
    });
  });

  await page.route("**/state/summary", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(createSummary()),
    });
  });

  await page.route("**/state/stats", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        player_id: "p1",
        tick: 120,
        production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 1 },
        energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
        combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
      }),
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
        power_coverage: [
          {
            building_id: "lab-1",
            owner_id: "p1",
            building_type: "matrix_lab",
            position: { x: 5, y: 4, z: 0 },
            connected: true,
            allocated: 0,
            demand: 2,
            reason: "under_power",
          },
        ],
      }),
    });
  });

  await page.route("**/world/planets/planet-1-1/overview", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        planet_id: "planet-1-1",
        system_id: "sys-1",
        discovered: true,
        kind: "terrestrial",
        map_width: 8,
        map_height: 8,
        tick: 120,
        step: 100,
        cells_width: 1,
        cells_height: 1,
        terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "buildable")),
        visible: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => true)),
        explored: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => true)),
        resource_counts: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
        building_counts: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
        unit_counts: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
      }),
    });
  });

  await page.route("**/world/systems/sys-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route("**/world/systems/sys-1/runtime", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route("**/events/snapshot**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        available_from_tick: 1,
        has_more: false,
        events: [],
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
    const command = (request.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const commandType = String(command.type ?? "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        request_id: String(request.request_id ?? "req-build"),
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
}

test("浏览器中默认收口建造列表，并展示距离预检与停机提示", async ({ page }) => {
  await installPlanetRoutes(page);

  await page.goto("/planet/planet-1-1");
  await expect(page.getByRole("heading", { name: "Gaia" })).toBeVisible();

  await page.getByLabel("X 坐标").first().fill("5");
  await page.getByLabel("Y 坐标").first().fill("4");

  await expect(page.getByText("建造前检查")).toBeVisible();
  await expect(page.getByText("执行体 exec-1")).toBeVisible();
  await expect(page.getByText("distance / operateRange = 7 / 6")).toBeVisible();
  await expect(page.getByText("当前执行体无法直接建造到目标坐标")).toBeVisible();
  await expect(page.getByText("建议落点 (2, 1, 0)")).toBeVisible();
  await expect(page.getByText("电网已接入，但当前发电不足")).toBeVisible();

  const buildSelect = page.getByLabel("建筑类型");
  await expect(buildSelect).toContainText("风力涡轮机 · wind_turbine");
  await expect(buildSelect).toContainText("矩阵研究站 · matrix_lab");
  await expect(buildSelect).not.toContainText("特斯拉塔 · 未解锁");
  await expect(buildSelect).not.toContainText("Planetary Logistics Station · 目录异常");

  await page.getByRole("button", { name: "显示高级建造" }).click();
  await expect(buildSelect).toContainText("特斯拉塔 · 未解锁");
  await expect(buildSelect).toContainText("Planetary Logistics Station · 目录异常");

  await page.getByRole("button", { name: "切到移动工作流" }).click();
  await expect(page.getByRole("combobox", { name: "单位" })).toHaveValue("exec-1");
  await expect(page.getByLabel("X 坐标").nth(1)).toHaveValue("2");
  await expect(page.getByLabel("Y 坐标").nth(1)).toHaveValue("1");
});
