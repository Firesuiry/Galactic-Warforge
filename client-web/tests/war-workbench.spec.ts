import { expect, test, type Page } from '@playwright/test';

function createSummary() {
  return {
    tick: 320,
    active_planet_id: 'planet-1-1',
    players: {
      p1: {
        player_id: 'p1',
        is_alive: true,
        resources: {
          minerals: 880,
          energy: 460,
        },
        inventory: {
          iron_ore: 40,
          silicon_ore: 18,
          stone_ore: 10,
        },
      },
    },
  };
}

function createStats() {
  return {
    player_id: 'p1',
    tick: 320,
    production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
    energy_stats: { generation: 320, consumption: 280, storage: 1000, current_stored: 640, shortage_ticks: 0 },
    logistics_stats: { throughput: 18, avg_distance: 22, avg_travel_time: 12, deliveries: 20 },
    combat_stats: { units_lost: 2, enemies_killed: 9, threat_level: 6, highest_threat: 7 },
  };
}

function createCatalog() {
  return {
    warfare: {
      base_frames: [
        {
          id: 'mech_frame_alpha',
          name: '阿尔法机体',
          role: '前线突破',
          supported_domains: ['ground_unit'],
          budgets: {
            power_output: 8,
            sustained_draw: 14,
            volume_capacity: 20,
            mass_capacity: 20,
            heat_capacity: 12,
          },
          slots: [
            { id: 'core', category: 'core', required: true },
            { id: 'weapon', category: 'weapon', required: true },
          ],
        },
      ],
      base_hulls: [
        {
          id: 'corvette_hull',
          name: '轻型护航舰体',
          role: '护航封锁',
          supported_domains: ['space_unit'],
          budgets: {
            power_output: 18,
            sustained_draw: 24,
            volume_capacity: 30,
            mass_capacity: 34,
            heat_capacity: 22,
          },
          slots: [
            { id: 'engine', category: 'engine', required: true },
            { id: 'weapon', category: 'weapon', required: true },
          ],
        },
      ],
      components: [
        { id: 'fusion_core', name: '聚变核心', category: 'core', supported_domains: ['ground_unit'], power_output: 6 },
        { id: 'coilgun', name: '线圈炮', category: 'weapon', supported_domains: ['ground_unit', 'space_unit'], power_draw: 12, heat_load: 8 },
        { id: 'burner_drive', name: '燃烧驱动', category: 'engine', supported_domains: ['space_unit'], power_draw: 4, heat_load: 3, tags: ['escort'] },
      ],
    },
  };
}

function createBlueprints() {
  return {
    blueprints: [
      {
        id: 'bp-draft',
        name: '前锋试制型',
        source: 'player',
        state: 'draft',
        domain: 'ground_unit',
        base_frame_id: 'mech_frame_alpha',
        validation: {
          valid: false,
          issues: [
            {
              code: 'power_draw_exceeded',
              message: '功率预算不足',
              actual: 12,
              limit: 10,
              slot_id: 'weapon',
              component_id: 'coilgun',
            },
          ],
        },
        allowed_actions: ['blueprint_validate', 'blueprint_finalize'],
        components: [
          { slot_id: 'core', component_id: 'fusion_core' },
          { slot_id: 'weapon', component_id: 'coilgun' },
        ],
      },
      {
        id: 'fleet-adopted',
        name: '舰队封锁型',
        source: 'player',
        state: 'adopted',
        domain: 'space_unit',
        base_hull_id: 'corvette_hull',
        validation: {
          valid: true,
          issues: [],
        },
        allowed_actions: ['blueprint_finalize'],
        components: [
          { slot_id: 'engine', component_id: 'burner_drive' },
          { slot_id: 'weapon', component_id: 'coilgun' },
        ],
      },
    ],
  };
}

function createIndustry() {
  return {
    production_orders: [
      {
        id: 'prod-1',
        factory_building_id: 'factory-1',
        deployment_hub_id: 'hub-1',
        blueprint_id: 'fleet-adopted',
        domain: 'space_unit',
        count: 4,
        completed_count: 1,
        status: 'in_progress',
        stage: 'assembly',
      },
    ],
    refit_orders: [],
    deployment_hubs: [
      {
        building_id: 'hub-1',
        building_type: 'orbital_dock',
        planet_id: 'planet-1-1',
        capacity: 6,
        ready_payloads: {
          fleet_adopted: 2,
        },
      },
    ],
    supply_nodes: [
      {
        node_id: 'supply-1',
        source_type: 'orbital_supply_port',
        label: '前线补给港',
        planet_id: 'planet-1-1',
        system_id: 'sys-1',
        inventory: {
          fuel: 180,
          ammo: 90,
          spare_parts: 24,
        },
      },
    ],
  };
}

function createTaskForces() {
  return {
    task_forces: [
      {
        id: 'tf-1',
        name: '第一封锁群',
        theater_id: 'theater-front',
        stance: 'hold',
        deployment: {
          system_id: 'sys-1',
          planet_id: 'planet-1-1',
        },
        command_capacity: {
          total: 8,
          used: 6,
        },
        supply_status: {
          current: { fuel: 40, ammo: 12 },
          capacity: { fuel: 100, ammo: 60 },
          condition: 'critical',
          shortages: ['fuel', 'ammo'],
        },
        members: [
          {
            kind: 'fleet',
            entity_id: 'fleet-1',
            system_id: 'sys-1',
            blueprint_ids: ['fleet-adopted'],
            count: 2,
            state: 'ready',
          },
        ],
      },
    ],
  };
}

function createTheaters() {
  return {
    theaters: [
      {
        id: 'theater-front',
        name: '赫利俄斯前线',
        zones: [
          { zone_type: 'primary', system_id: 'sys-1', planet_id: 'planet-1-1', radius: 12 },
        ],
        objective: {
          objective_type: 'secure_planet',
          system_id: 'sys-1',
          planet_id: 'planet-1-1',
          description: '拿下登陆窗口并维持封锁',
        },
      },
    ],
  };
}

function createSystem() {
  return {
    system_id: 'sys-1',
    name: 'Helios',
    discovered: true,
    planets: [
      { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
      { planet_id: 'planet-1-2', name: 'Ares', discovered: true, kind: 'lava' },
    ],
  };
}

function createSystemRuntime() {
  return {
    system_id: 'sys-1',
    discovered: true,
    available: true,
    orbital_superiority: {
      system_id: 'sys-1',
      advantage_player_id: 'p1',
      contest_intensity: 0.32,
      last_reason: 'task_force_superiority',
      updated_tick: 320,
    },
    planet_blockades: [
      {
        planet_id: 'planet-1-1',
        system_id: 'sys-1',
        owner_id: 'p1',
        task_force_id: 'tf-1',
        status: 'active',
        intensity: 0.68,
        last_reason: 'orbital_superiority_held',
        updated_tick: 320,
      },
    ],
    landing_operations: [
      {
        id: 'landing-1',
        owner_id: 'p1',
        task_force_id: 'tf-1',
        system_id: 'sys-1',
        planet_id: 'planet-1-1',
        stage: 'reconnaissance',
        result: 'pending',
        blocked_reason: 'awaiting_orbital_superiority',
      },
    ],
    contacts: [
      {
        id: 'contact-1',
        scope_type: 'system',
        scope_id: 'sys-1',
        contact_kind: 'enemy_force',
        classification: 'destroyer_screen',
        threat_level: 7,
        entity_id: 'enemy-fleet-3',
        position: { x: 18, y: 0, z: 4 },
        level: 'confirmed_type',
        last_updated_tick: 319,
        lock_quality: 0.81,
      },
    ],
    battle_reports: [
      {
        battle_id: 'battle-9',
        tick: 319,
        system_id: 'sys-1',
        planet_id: 'planet-1-1',
        fleet_id: 'fleet-1',
        owner_id: 'p1',
        fleet_firepower: {
          direct_fire: 18,
          missile: 4,
          point_defense: 2,
        },
        enemy_firepower: {
          direct_fire: 12,
          missile: 8,
        },
        fleet_damage: {
          shield: 4,
          armor: 2,
        },
        target_strength_loss: 9,
        lock_quality: 0.81,
        jamming_penalty: 0.18,
      },
    ],
  };
}

async function installSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({
        state: {
          serverUrl: 'http://127.0.0.1:4173',
          playerId: 'p1',
          playerKey: 'key_player_1',
        },
        version: 0,
      }),
    );
  });
}

async function installWarRoutes(page: Page) {
  await installSession(page);

  await page.route('**/state/summary', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createSummary()) });
  });

  await page.route('**/state/stats', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createStats()) });
  });

  await page.route('**/catalog', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createCatalog()) });
  });

  await page.route('**/world/warfare/blueprints', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createBlueprints()) });
  });

  await page.route('**/world/warfare/industry', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createIndustry()) });
  });

  await page.route('**/world/warfare/task-forces', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createTaskForces()) });
  });

  await page.route('**/world/warfare/theaters', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createTheaters()) });
  });

  await page.route('**/world/planets/planet-1-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        planet_id: 'planet-1-1',
        system_id: 'sys-1',
        name: 'Gaia',
        discovered: true,
        kind: 'terrestrial',
        map_width: 128,
        map_height: 128,
        tick: 320,
      }),
    });
  });

  await page.route('**/world/systems/sys-1', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createSystem()) });
  });

  await page.route('**/world/systems/sys-1/runtime', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(createSystemRuntime()) });
  });

  await page.route('**/commands', async (route) => {
    const request = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const command = (request.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const commandType = String(command.type ?? '');
    const responseByType: Record<string, { status: string; message: string }> = {
      blueprint_create: { status: 'executed', message: 'blueprint bp-browser created' },
      task_force_set_stance: { status: 'executed', message: 'task force tf-1 stance set to siege' },
      commission_fleet: { status: 'failed', message: 'building hub-1 cannot deploy blueprint fleet-adopted' },
      blockade_planet: { status: 'executed', message: 'planet planet-1-1 blockade assigned to task force tf-1' },
      landing_start: { status: 'failed', message: 'task force tf-1 lacks transport capacity for landing' },
    };
    const result = responseByType[commandType] ?? { status: 'executed', message: `${commandType} accepted` };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        request_id: String(request.request_id ?? 'req-war-browser'),
        accepted: true,
        enqueue_tick: 321,
        results: [
          {
            command_index: 0,
            status: result.status,
            code: result.status === 'executed' ? 'OK' : 'VALIDATION_FAILED',
            message: result.message,
          },
        ],
      }),
    });
  });
}

test('浏览器中可操作战争工作台核心闭环', async ({ page }) => {
  await installWarRoutes(page);

  await page.goto('/war');

  await expect(page.getByRole('heading', { name: '战争工作台' })).toBeVisible();
  await expect(page.getByText('蓝图工作台')).toBeVisible();
  await expect(page.getByText('军工总览')).toBeVisible();
  await expect(page.getByText('战区面板')).toBeVisible();
  await expect(page.getByText('战报与情报')).toBeVisible();
  await expect(page.getByText('功率预算不足', { exact: true })).toBeVisible();
  await expect(page.getByText('destroyer_screen')).toBeVisible();

  await page.getByLabel('蓝图 ID').fill('bp-browser');
  await page.getByLabel('蓝图名称').fill('浏览器回归型');
  await page.getByRole('button', { name: '创建蓝图' }).click();
  await expect(page.getByText('blueprint bp-browser created')).toBeVisible();

  await page.getByLabel('部署蓝图').selectOption('fleet-adopted');
  await page.getByRole('button', { name: '尝试部署' }).click();
  await expect(page.getByText('当前部署枢纽不支持该蓝图')).toBeVisible();

  await page.getByLabel('任务群姿态').selectOption('siege');
  await page.getByRole('button', { name: '更新姿态' }).click();
  await expect(page.getByText('task force tf-1 stance set to siege')).toBeVisible();

  await page.getByRole('button', { name: '发起封锁' }).click();
  await expect(page.getByText('planet planet-1-1 blockade assigned to task force tf-1')).toBeVisible();

  await page.getByRole('button', { name: '发起登陆' }).click();
  await expect(page.getByText('当前任务群缺少登陆运力')).toBeVisible();
});

test('窄屏下战争工作台仍保留最小操作闭环', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWarRoutes(page);

  await page.goto('/war');

  await expect(page.getByRole('heading', { name: '战争工作台' })).toBeVisible();
  await expect(page.getByLabel('蓝图 ID')).toBeVisible();
  await expect(page.getByLabel('部署蓝图')).toBeVisible();
  await expect(page.getByLabel('任务群姿态')).toBeVisible();
  await expect(page.getByRole('button', { name: '发起封锁' })).toBeVisible();
  await expect(page.getByText('destroyer_screen')).toBeVisible();
});
