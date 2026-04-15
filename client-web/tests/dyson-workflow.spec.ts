import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { expect, test, type Page } from "@playwright/test";

function createCatalog() {
  return {
    items: [],
    buildings: [
      {
        id: "matrix_lab",
        name: "矩阵研究站",
        category: "research",
        subcategory: "research",
        footprint: { width: 1, height: 1 },
        build_cost: { minerals: 1, energy: 1, items: [] },
        buildable: true,
        icon_key: "matrix_lab",
        color: "#7dd3fc",
      },
    ],
    recipes: [],
    techs: [
      {
        id: "dyson_sphere_program",
        name: "戴森球计划",
        category: "main",
        type: "main",
        level: 0,
        prerequisites: [],
        cost: [],
        unlocks: [],
        icon_key: "dyson_sphere_program",
        color: "#93c5fd",
      },
    ],
  };
}

function createScene() {
  return {
    planet_id: "planet-1-2",
    system_id: "sys-1",
    name: "Aster Prime",
    discovered: true,
    kind: "terrestrial",
    map_width: 4,
    map_height: 4,
    tick: 220,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "buildable")),
    visible: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => true)),
    explored: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => true)),
    environment: {
      wind_factor: 0.6,
      light_factor: 1.3,
    },
    buildings: {},
    units: {},
    resources: [],
    building_count: 0,
    unit_count: 0,
    resource_count: 0,
  };
}

function createRuntime() {
  return {
    planet_id: "planet-1-2",
    discovered: true,
    available: true,
    tick: 220,
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
        planet_id: "planet-1-2",
        name: "Aster Prime",
        discovered: true,
      },
    ],
  };
}

function createSystemRuntime(nodeBuilt: boolean) {
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
          nodes: nodeBuilt
            ? [
                {
                  id: "p1-node-l0-latm1000-lonm2000",
                  latitude: 10,
                  longitude: 20,
                  orbit_radius: 1.2,
                },
              ]
            : [],
        },
      ],
    },
  };
}

function createSummary() {
  return {
    tick: 220,
    active_planet_id: "planet-1-2",
    players: {
      p1: {
        player_id: "p1",
        is_alive: true,
        resources: {
          minerals: 500,
          energy: 500,
        },
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
        },
      },
    },
  };
}

async function installSession(page: Page, serverUrl: string) {
  await page.addInitScript((nextServerUrl) => {
    window.localStorage.setItem(
      "siliconworld-client-web-session",
      JSON.stringify({
        state: {
          serverUrl: nextServerUrl,
          playerId: "p1",
          playerKey: "key_player_1",
        },
        version: 0,
      }),
    );
  }, serverUrl);
}

function applyCors(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

function sendJson(response: ServerResponse, payload: unknown, statusCode = 200) {
  applyCors(response);
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function startDysonBackend() {
  const commandRequests: Array<Record<string, unknown>> = [];
  const sseClients = new Set<ServerResponse>();
  let nodeBuilt = false;

  function emitGameEvent(event: Record<string, unknown>) {
    const payload = `event: game\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    applyCors(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/events/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write('event: connected\ndata: {"player_id":"p1","event_types":["command_result"]}\n\n');
      sseClients.add(response);
      request.on("close", () => {
        sseClients.delete(response);
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/state/summary") {
      sendJson(response, createSummary());
      return;
    }

    if (request.method === "GET" && url.pathname === "/state/stats") {
      sendJson(response, {
        player_id: "p1",
        tick: 220,
        production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 1 },
        energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
        combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/catalog") {
      sendJson(response, createCatalog());
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/planets/planet-1-2/scene") {
      sendJson(response, createScene());
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/planets/planet-1-2/runtime") {
      sendJson(response, createRuntime());
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/planets/planet-1-2/networks") {
      sendJson(response, {
        planet_id: "planet-1-2",
        discovered: true,
        available: true,
        tick: 220,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/planets/planet-1-2/overview") {
      sendJson(response, {
        planet_id: "planet-1-2",
        system_id: "sys-1",
        discovered: true,
        kind: "terrestrial",
        map_width: 4,
        map_height: 4,
        tick: 220,
        step: 100,
        cells_width: 1,
        cells_height: 1,
        terrain: [["buildable"]],
        visible: [[true]],
        explored: [[true]],
        resource_counts: [[0]],
        building_counts: [[0]],
        unit_counts: [[0]],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/systems/sys-1") {
      sendJson(response, createSystem());
      return;
    }

    if (request.method === "GET" && url.pathname === "/world/systems/sys-1/runtime") {
      sendJson(response, createSystemRuntime(nodeBuilt));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events/snapshot") {
      sendJson(response, {
        available_from_tick: 1,
        has_more: false,
        events: [],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/alerts/production/snapshot") {
      sendJson(response, {
        available_from_tick: 1,
        has_more: false,
        alerts: [],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/commands") {
      const payload = await readJson(request);
      commandRequests.push(payload);
      const command = (payload.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
      const commandType = String(command.type ?? "");

      if (commandType === "build_dyson_node") {
        nodeBuilt = true;
        setTimeout(() => {
          emitGameEvent({
            event_id: "evt-dyson-node-built",
            tick: 221,
            event_type: "command_result",
            visibility_scope: "p1",
            payload: {
              request_id: "req-dyson-node",
              code: "OK",
              message: "dyson node p1-node-l0-latm1000-lonm2000 built",
            },
          });
        }, 50);
      }

      sendJson(response, {
        request_id: "req-dyson-node",
        accepted: true,
        enqueue_tick: 221,
        results: [
          {
            command_index: 0,
            status: "queued",
            code: "OK",
            message: `${commandType} accepted`,
          },
        ],
      });
      return;
    }

    sendJson(response, { error: `${request.method} ${url.pathname} not found` }, 404);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind dyson backend");
  }

  return {
    commandRequests,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

test("浏览器里建造戴森节点后无需刷新即可继续选择新节点建框架", async ({ page }) => {
  const backend = await startDysonBackend();

  try {
    await installSession(page, backend.url);
    await page.goto("/planet/planet-1-2");
    await expect(page.getByRole("heading", { name: "Aster Prime" })).toBeVisible();

    const dysonSection = page.locator(".planet-side-section").filter({ hasText: "戴森建造" });
    await page.getByRole("tab", { name: "戴森" }).click();
    await dysonSection.getByRole("button", { name: "提交戴森建造命令" }).click();

    await expect
      .poll(() => (
        (
          backend.commandRequests[0]?.commands as Array<Record<string, unknown>> | undefined
        )?.[0]?.type
      ))
      .toBe("build_dyson_node");

    await dysonSection.getByLabel("命令").selectOption("build_dyson_frame");
    await expect(dysonSection.getByLabel("节点 A")).toContainText("p1-node-l0-latm1000-lonm2000");
    await expect(dysonSection.getByLabel("节点 B")).toContainText("p1-node-l0-latm1000-lonm2000");
  } finally {
    await backend.close();
  }
});
