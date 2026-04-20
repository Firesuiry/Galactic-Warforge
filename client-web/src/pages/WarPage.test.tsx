import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

function createCommandResponse(message: string, status = 'executed') {
  return {
    request_id: 'req-war-1',
    accepted: true,
    enqueue_tick: 320,
    results: [
      {
        command_index: 0,
        status,
        code: status === 'executed' ? 'OK' : 'VALIDATION_FAILED',
        message,
      },
    ],
  };
}

describe('WarPage', () => {
  it('展示战争工作台四个面板与关键战争态势', async () => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 320,
          active_planet_id: 'planet-1-1',
          map_width: 128,
          map_height: 128,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 880, energy: 460 },
              inventory: {
                iron_ore: 40,
                silicon_ore: 18,
                stone_ore: 10,
              },
            },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 320,
          production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
          energy_stats: { generation: 320, consumption: 280, storage: 1000, current_stored: 640, shortage_ticks: 0 },
          logistics_stats: { throughput: 18, avg_distance: 22, avg_travel_time: 12, deliveries: 20 },
          combat_stats: { units_lost: 2, enemies_killed: 9, threat_level: 6, highest_threat: 7 },
        }));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse({
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
            public_blueprints: [
              {
                id: 'preset-corvette',
                name: '标准护航舰',
                domain: 'space_unit',
                source: 'preset',
                base_hull_id: 'corvette_hull',
                runtime_class: 'fleet',
                production_mode: 'commission',
              },
            ],
          },
        }));
      }
      if (url.endsWith('/world/warfare/blueprints')) {
        return Promise.resolve(jsonResponse({
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
                usage: {
                  power_output: 6,
                  power_draw: 12,
                  volume: 16,
                  mass: 12,
                  heat_load: 8,
                },
                limits: {
                  power_output: 8,
                  sustained_draw: 10,
                  volume_capacity: 20,
                  mass_capacity: 20,
                  heat_capacity: 12,
                },
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
              allowed_actions: ['blueprint_set_component', 'blueprint_validate', 'blueprint_finalize'],
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
                usage: {
                  power_output: 18,
                  power_draw: 14,
                  volume: 18,
                  mass: 15,
                  heat_load: 10,
                },
                limits: {
                  power_output: 18,
                  sustained_draw: 24,
                  volume_capacity: 30,
                  mass_capacity: 34,
                  heat_capacity: 22,
                },
                issues: [],
              },
              allowed_actions: ['blueprint_finalize'],
              components: [
                { slot_id: 'engine', component_id: 'burner_drive' },
                { slot_id: 'weapon', component_id: 'coilgun' },
              ],
            },
          ],
        }));
      }
      if (url.endsWith('/world/warfare/industry')) {
        return Promise.resolve(jsonResponse({
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
              stage_remaining_ticks: 12,
              stage_total_ticks: 30,
              repeat_bonus_percent: 10,
            },
          ],
          refit_orders: [
            {
              id: 'refit-1',
              building_id: 'dock-1',
              unit_id: 'fleet-legacy',
              unit_kind: 'fleet',
              source_blueprint_id: 'preset-corvette',
              target_blueprint_id: 'fleet-adopted',
              status: 'blocked',
              remaining_ticks: 18,
              total_ticks: 40,
            },
          ],
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
              updated_tick: 320,
            },
          ],
        }));
      }
      if (url.endsWith('/world/warfare/task-forces')) {
        return Promise.resolve(jsonResponse({
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
                over: 0,
              },
              supply_status: {
                current: { fuel: 40, ammo: 12 },
                capacity: { fuel: 100, ammo: 60 },
                condition: 'critical',
                shortages: ['fuel', 'ammo'],
                retreat_recommended: true,
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
        }));
      }
      if (url.endsWith('/world/warfare/theaters')) {
        return Promise.resolve(jsonResponse({
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
        }));
      }
      if (url.endsWith('/world/planets/planet-1-1')) {
        return Promise.resolve(jsonResponse({
          planet_id: 'planet-1-1',
          system_id: 'sys-1',
          name: 'Gaia',
          discovered: true,
          kind: 'terrestrial',
          map_width: 128,
          map_height: 128,
          tick: 320,
        }));
      }
      if (url.endsWith('/world/systems/sys-1')) {
        return Promise.resolve(jsonResponse({
          system_id: 'sys-1',
          name: 'Helios',
          discovered: true,
          planets: [
            { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
            { planet_id: 'planet-1-2', name: 'Ares', discovered: true, kind: 'lava' },
          ],
        }));
      }
      if (url.endsWith('/world/systems/sys-1/runtime')) {
        return Promise.resolve(jsonResponse({
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
              transport_capacity: 0,
              updated_tick: 320,
            },
          ],
          contacts: [
            {
              id: 'contact-1',
              contact_kind: 'enemy_force',
              classification: 'destroyer_screen',
              confidence: 0.72,
              threat_level: 7,
              entity_id: 'enemy-fleet-3',
              position: { x: 18, y: 0, z: 4 },
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
        }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(['/war']);

    expect(await screen.findByRole('heading', { name: '战争工作台' })).toBeInTheDocument();
    expect(screen.getByText('蓝图工作台')).toBeInTheDocument();
    expect(screen.getByText('军工总览')).toBeInTheDocument();
    expect(screen.getByText('战区面板')).toBeInTheDocument();
    expect(screen.getByText('战报与情报')).toBeInTheDocument();
    expect(screen.getByText('前锋试制型')).toBeInTheDocument();
    expect(screen.getByText('功率预算不足')).toBeInTheDocument();
    expect(screen.getByText('舰队封锁型')).toBeInTheDocument();
    expect(screen.getByText('第一封锁群')).toBeInTheDocument();
    expect(screen.getByText('补给危急')).toBeInTheDocument();
    expect(screen.getByText('Helios')).toBeInTheDocument();
    expect(screen.getByText('destroyer_screen')).toBeInTheDocument();
    expect(screen.getByText('battle-9')).toBeInTheDocument();
    expect(screen.getByText('已封锁')).toBeInTheDocument();
  });

  it('支持蓝图创建、姿态调整、部署尝试、封锁与登陆操作', async () => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    const commandTypes: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state/summary')) {
        return jsonResponse({
          tick: 320,
          active_planet_id: 'planet-1-1',
          map_width: 128,
          map_height: 128,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 880, energy: 460 },
              inventory: {
                iron_ore: 40,
                silicon_ore: 18,
                stone_ore: 10,
              },
            },
          },
        });
      }
      if (url.endsWith('/state/stats')) {
        return jsonResponse({
          player_id: 'p1',
          tick: 320,
          production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
          energy_stats: { generation: 320, consumption: 280, storage: 1000, current_stored: 640, shortage_ticks: 0 },
          logistics_stats: { throughput: 18, avg_distance: 22, avg_travel_time: 12, deliveries: 20 },
          combat_stats: { units_lost: 2, enemies_killed: 9, threat_level: 6, highest_threat: 7 },
        });
      }
      if (url.endsWith('/catalog')) {
        return jsonResponse({
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
        });
      }
      if (url.endsWith('/world/warfare/blueprints')) {
        return jsonResponse({
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
        });
      }
      if (url.endsWith('/world/warfare/industry')) {
        return jsonResponse({
          production_orders: [],
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
          supply_nodes: [],
        });
      }
      if (url.endsWith('/world/warfare/task-forces')) {
        return jsonResponse({
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
        });
      }
      if (url.endsWith('/world/warfare/theaters')) {
        return jsonResponse({
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
        });
      }
      if (url.endsWith('/world/planets/planet-1-1')) {
        return jsonResponse({
          planet_id: 'planet-1-1',
          system_id: 'sys-1',
          name: 'Gaia',
          discovered: true,
          kind: 'terrestrial',
          map_width: 128,
          map_height: 128,
          tick: 320,
        });
      }
      if (url.endsWith('/world/systems/sys-1')) {
        return jsonResponse({
          system_id: 'sys-1',
          name: 'Helios',
          discovered: true,
          planets: [
            { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
          ],
        });
      }
      if (url.endsWith('/world/systems/sys-1/runtime')) {
        return jsonResponse({
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
          planet_blockades: [],
          landing_operations: [],
          contacts: [],
          battle_reports: [],
        });
      }
      if (url.endsWith('/commands')) {
        const request = init?.body ? JSON.parse(String(init.body)) : null;
        const command = request?.commands?.[0];
        commandTypes.push(command?.type);
        switch (command?.type) {
          case 'blueprint_create':
            return jsonResponse(createCommandResponse('blueprint bp-new created'));
          case 'blueprint_validate':
            return jsonResponse(createCommandResponse('blueprint bp-draft invalid', 'failed'));
          case 'task_force_set_stance':
            return jsonResponse(createCommandResponse('task force tf-1 stance set to siege'));
          case 'commission_fleet':
            return jsonResponse(createCommandResponse('building hub-1 cannot deploy blueprint fleet-adopted', 'failed'));
          case 'blockade_planet':
            return jsonResponse(createCommandResponse('planet planet-1-1 blockade assigned to task force tf-1'));
          case 'landing_start':
            return jsonResponse(createCommandResponse('task force tf-1 lacks transport capacity for landing', 'failed'));
          default:
            return jsonResponse(createCommandResponse('unexpected command'));
        }
      }
      throw new Error(`unexpected url ${url}`);
    }));

    const user = userEvent.setup();

    renderApp(['/war']);

    await screen.findByRole('heading', { name: '战争工作台' });

    await user.type(screen.getByLabelText('蓝图 ID'), 'bp-new');
    await user.type(screen.getByLabelText('蓝图名称'), '晨星改');
    await user.selectOptions(screen.getByLabelText('作战域'), 'ground_unit');
    await user.selectOptions(screen.getByLabelText('底盘'), 'mech_frame_alpha');
    await user.click(screen.getByRole('button', { name: '创建蓝图' }));

    await user.click(screen.getByRole('button', { name: '校验蓝图' }));

    await user.selectOptions(screen.getByLabelText('部署蓝图'), 'fleet-adopted');
    await user.click(screen.getByRole('button', { name: '尝试部署' }));

    await user.selectOptions(screen.getByLabelText('任务群姿态'), 'siege');
    await user.click(screen.getByRole('button', { name: '更新姿态' }));

    await user.click(screen.getByRole('button', { name: '发起封锁' }));
    await user.click(screen.getByRole('button', { name: '发起登陆' }));

    await waitFor(() => {
      expect(commandTypes).toEqual([
        'blueprint_create',
        'blueprint_validate',
        'commission_fleet',
        'task_force_set_stance',
        'blockade_planet',
        'landing_start',
      ]);
    });

    expect(screen.getByText('blueprint bp-new created')).toBeInTheDocument();
    expect(screen.getByText('当前部署枢纽不支持该蓝图')).toBeInTheDocument();
    expect(screen.getByText('当前任务群缺少登陆运力')).toBeInTheDocument();
    expect(screen.getByText('task force tf-1 stance set to siege')).toBeInTheDocument();
  });
});
