/**
 * SSE 游戏事件 → toast 通知映射（纯函数，无副作用）。
 *
 * 设计：
 * - 返回 { toast, sfx? }；sfx 仅在「该事件此前没有任何音效覆盖」时给出——
 *   战斗总线五类（use-game-audio）与行星四类（planet-audio）已自带音效，
 *   toast 不重复播；其余事件按 kind 补一声轻量反馈（info→uiClick、
 *   warning→alert、danger→explosion(小)、success→commandOk）。
 * - 高频事件（导弹齐射/点防/产线告警/小队部署等）带 mergeKey，由 store
 *   在 MERGE_WINDOW_MS 窗口内合并为 1 条计数。
 * - 文案中文、简洁游戏化；名称尽量走 i18n 字典（建筑/科技）。
 */

import type { GameEventDetail } from '@shared/types';

import { GAME_FINISHED_MESSAGE, isGameFinishedResult, toPlayerFacingMessage } from '@/common/player-facing-error';
import type { SoundName } from '@/engine/audio';
import { isBuildingCompletionEvent } from '@/features/audio/planet-audio';
import type { ToastInput } from '@/features/notifications/store';
import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { translateAlertType, translateBuildingType, translateTechId, translateUnitType } from '@/i18n/translate';

export interface EventToast {
  toast: ToastInput;
  /** 仅当该事件没有既有音效覆盖时给出（见文件头注释）。 */
  sfx?: SoundName;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** 服务端默认 10 tick/s（遭遇战预设）；换算「X 分钟」提示用。 */
const TICKS_PER_SECOND = 10;
/** 产线告警节流：同 mergeKey 的 toast 消退后 60s 内只累计到历史，不再弹出。 */
export const PRODUCTION_ALERT_THROTTLE_MS = 60_000;

/**
 * 断电类告警类型（优先级高于吞吐类）：试玩报告 F——
 * 石矿机缺电 50 分钟没人发现，因为 `power_shortage` 混在上百条
 * `input_shortage` / `output_blocked` 里。
 */
const POWER_ALERT_TYPES: ReadonlySet<string> = new Set(['power_shortage', 'power_low']);

/** 该告警类型是否属于断电类。 */
export function isPowerAlertType(alertType: string | undefined | null): boolean {
  return Boolean(alertType && POWER_ALERT_TYPES.has(alertType));
}

/**
 * 该通知条目是否属于断电类（铃铛历史分组用）。
 *
 * 判据放在 mergeKey 上而不是给 Toast 加字段：mergeKey 已经写进
 * sessionStorage（persistence.ts），刷新后回填的历史条目仍能正确分组；
 * 新增字段则要在持久化层同步（本任务不涉及该文件）。
 * mergeKey 形如 `production_alert:${buildingId}:${alertType}`。
 */
export function isPowerAlertToast(toast: { mergeKey?: string }): boolean {
  const key = toast.mergeKey;
  if (!key || !key.startsWith('production_alert:')) {
    return false;
  }
  return isPowerAlertType(key.slice(key.lastIndexOf(':') + 1));
}

/** 玩家机甲（executor）的单位类型 id；词典译名「玩家机甲」。 */
const MECHA_UNIT_TYPES = new Set(['executor', 'mecha']);

/** 是否玩家机甲/执行者单位（击毁文案与普通单位区分开）。 */
export function isMechaUnitType(unitType: string): boolean {
  return MECHA_UNIT_TYPES.has(unitType);
}

/** entity_destroyed 的中文名：按 entity_kind 选字典；旧事件缺字段时按 id 前缀推断。 */
export function describeDestroyedEntity(payload: Record<string, unknown>): { kind: string; name: string } {
  const entityId = asString(payload.entity_id) || asString(payload.target_id);
  const kind = asString(payload.entity_kind)
    || (entityId.startsWith('b-') ? 'building' : entityId.startsWith('u-') ? 'unit' : '');
  const type = asString(payload.entity_type);
  switch (kind) {
    case 'building':
      return { kind, name: type ? translateBuildingType(type) : '建筑' };
    case 'unit':
      return { kind, name: type ? translateUnitType(type) : '单位' };
    case 'enemy_force':
      return { kind, name: '黑雾' };
    case 'fleet':
      return { kind, name: '舰队' };
    case 'combat_squad':
      return { kind, name: '军团' };
    default:
      return { kind, name: '目标' };
  }
}

/**
 * 战报目标的中文名（不暴露 fleet/单位 id）。
 * 服务端战报只给 target_type 这个类别码（当前仅 'enemy_force'），
 * 未知类别返回空串而不是把原始码/ id 拼进文案。
 */
function battleTargetName(report: Record<string, unknown> | undefined): string {
  switch (asString(report?.target_type)) {
    case 'enemy_force':
      return '黑雾';
    case 'fleet':
      return '舰队';
    case 'building':
      return '建筑';
    case 'unit':
      return '单位';
    default:
      return '';
  }
}

function planetHref(payload: Record<string, unknown>): string | undefined {
  const planetId = asString(payload.planet_id);
  return planetId ? `/planet/${planetId}` : undefined;
}

/**
 * 告警位置文案：`(x, y)`。只在 payload 真的带了坐标时给出——
 * 当前服务端 production_alert 没有位置字段，此时返回空串，绝不编造。
 */
function formatPositionLabel(position: unknown): string {
  const record = asRecord(position);
  const x = asNumber(record?.x);
  const y = asNumber(record?.y);
  if (x === undefined || y === undefined) {
    return '';
  }
  return `(${Math.round(x)}, ${Math.round(y)})`;
}

/**
 * @param viewerId 当前玩家：用于区分「己方被毁 / 击毁敌方」与只对自己弹的黑雾敌对提示。
 */
export function toastFromGameEvent(event: GameEventDetail, viewerId = ''): EventToast | null {
  const payload = event.payload ?? {};

  switch (event.event_type) {
    // ---------- 战斗类（战斗总线已配音，toast 不再发声） ----------
    case 'battle_report_generated': {
      const report = asRecord(payload.report);
      const destroyed = report?.target_destroyed === true;
      const damage = asNumber(report?.target_strength_loss);
      // 目标名走类别码中文化；服务端战报没有实体中文名，绝不把 fleet-xxx 之类 id 拼进文案
      const targetName = battleTargetName(report);
      return {
        toast: {
          kind: 'danger',
          title: destroyed
            ? (targetName ? `击毁目标：${targetName}` : '击毁目标')
            : '舰队交火',
          body: [
            !destroyed && targetName ? targetName : '',
            damage !== undefined ? `-${Math.round(damage)}` : '',
          ].filter(Boolean).join(' · ') || undefined,
          href: '/war',
          mergeKey: `battle:${asString(report?.fleet_id) || 'unknown'}`,
        },
      };
    }
    case 'entity_destroyed': {
      const { kind, name } = describeDestroyedEntity(payload);
      const ownerId = asString(payload.owner_id);
      const own = viewerId !== '' && ownerId === viewerId;
      if (kind === 'building' || kind === 'unit') {
        const type = asString(payload.entity_type);
        const mecha = kind === 'unit' && isMechaUnitType(type);
        if (own) {
          return {
            toast: {
              kind: 'danger',
              title: kind === 'building'
                ? `建筑被摧毁：${name}`
                : mecha ? `机甲被击毁：${name}` : `单位阵亡：${name}`,
              href: planetHref(payload),
              mergeKey: `entity_destroyed:own:${kind}:${name}`,
            },
          };
        }
        // 别家互相交火的伤亡不打扰；没有归属字段（旧事件）时仍按己方损失提示
        if (ownerId) {
          return null;
        }
        return {
          toast: {
            kind: 'danger',
            title: kind === 'building'
              ? `建筑被摧毁：${name}`
              : mecha ? `机甲被击毁：${name}` : `单位被摧毁：${name}`,
            mergeKey: `entity_destroyed:${kind}:${name}`,
          },
        };
      }
      if (kind === 'enemy_force') {
        return { toast: { kind: 'success', title: '击退黑雾', mergeKey: 'entity_destroyed:enemy_force' } };
      }
      return {
        toast: { kind: 'danger', title: `${name}被摧毁`, href: kind === 'fleet' ? '/war' : undefined, mergeKey: `entity_destroyed:${kind}` },
      };
    }
    case 'dark_fog_provoked': {
      if (asString(payload.player_id) !== viewerId) {
        return null;
      }
      const until = asNumber(payload.until_tick);
      const minutes = until !== undefined ? Math.max(1, Math.ceil((until - event.tick) / TICKS_PER_SECOND / 60)) : undefined;
      return {
        toast: {
          kind: 'danger',
          title: '你激怒了黑雾',
          body: minutes !== undefined ? `${minutes} 分钟内会遭到报复，停止攻击后才会恢复中立。` : '黑雾将报复你的基地，停止攻击后才会恢复中立。',
          mergeKey: 'dark_fog_provoked',
          sticky: true,
        },
        sfx: 'alert',
      };
    }
    case 'dark_fog_calmed':
      if (asString(payload.player_id) !== viewerId) {
        return null;
      }
      return { toast: { kind: 'success', title: '黑雾已恢复中立', body: '不主动攻击它就不会再来报复。' }, sfx: 'commandOk' };
    case 'missile_salvo_fired': {
      const count = asNumber(payload.count) ?? asNumber(payload.salvo_size);
      return {
        toast: {
          kind: 'info',
          title: '导弹齐射',
          body: count !== undefined ? `×${count}` : undefined,
          href: '/war',
          mergeKey: 'missile_salvo_fired',
        },
      };
    }
    case 'point_defense_intercept': {
      const intercepted = asNumber(payload.intercepted);
      return {
        toast: {
          kind: 'info',
          title: '点防拦截',
          body: intercepted !== undefined ? `拦截 ×${intercepted}` : undefined,
          href: '/war',
          mergeKey: 'point_defense_intercept',
        },
      };
    }
    // damage_applied 太频繁且战报已覆盖，不弹
    case 'damage_applied':
      return null;

    // ---------- 行星类（planet-audio 已配音，toast 不再发声） ----------
    case 'building_state_changed': {
      if (!isBuildingCompletionEvent(payload)) {
        return null;
      }
      const buildingType = asString(payload.building_type);
      return {
        toast: {
          kind: 'success',
          title: `建造完成：${buildingType ? translateBuildingType(buildingType) : '建筑'}`,
          href: planetHref(payload),
        },
      };
    }
    case 'research_completed': {
      const techId = asString(payload.tech_id);
      return {
        toast: {
          kind: 'success',
          title: `研究完成：${techId ? translateTechId(techId) : '科技'}`,
          href: planetHref(payload),
        },
      };
    }
    case 'traffic_monitor_alert': {
      const active = payload.alert_active === true;
      const id = asString(payload.building_id);
      return { toast: { kind: active ? 'warning' : 'info', title: active ? '传送带流量告警' : '传送带告警已解除',
        body: `流速监测器：${active ? (payload.state === 'blocked' ? '积货且无物料流出' : '流量低于阈值') : '监测状态已更新'}`,
        href: planetHref(payload), mergeKey: `traffic_monitor_alert:${id}` } };
    }
    case 'production_alert': {
      const alert = asRecord(payload.alert);
      const alertType = asString(alert?.alert_type);
      const buildingType = asString(alert?.building_type);
      // 建筑实例 id（合并键用）：同一建筑的同类告警合并计数，不同建筑分开显示
      const buildingId = asString(alert?.building_id) || asString(payload.building_id);
      // 研究模式（无配方）的 matrix_lab / self_evolution_lab 是合法开局状态，
      // 其吞吐类告警属噪音，不弹 toast（见 production-alerts.ts）
      if (isResearchStationAlertNoise({ building_type: buildingType, alert_type: alertType })) {
        return null;
      }
      // 文案本地化：建筑名 + 告警类型，不使用 server 的英文原文 message
      const issue = translateAlertType(alertType, asString(alert?.message) || '产线告警');
      const buildingLabel = buildingType ? translateBuildingType(buildingType) : '建筑';
      const power = isPowerAlertType(alertType);
      // 位置不一定有（服务端 production_alert payload 只有建筑 id/类型）；有才写，绝不编造
      const position = alert?.position ?? payload.position;
      const positionLabel = position
        ? formatPositionLabel(position)
        : '';
      return {
        toast: {
          // 断电类：danger + 常驻（sticky）且不套用产线节流——
          // 否则第二次断电提醒会被节流吞掉（试玩报告 F）。
          kind: power ? 'danger' : 'warning',
          title: power ? '建筑断电' : '产线告警',
          body: [buildingLabel, power ? '电力不足' : issue, positionLabel].filter(Boolean).join('：') || undefined,
          href: planetHref(payload),
          // 同一建筑的同类告警合并计数并节流（采矿机满仓后每 3000 tick 重复提醒，
          // 不合并会刷屏）；键含建筑 id，不同建筑的同类告警分开显示。
          // 断电类不节流，且停留 STICKY_TTL_MS。
          mergeKey: `production_alert:${buildingId || buildingType || 'unknown'}:${alertType || 'unknown'}`,
          ...(power ? { sticky: true } : { throttleMs: PRODUCTION_ALERT_THROTTLE_MS }),
        },
      };
    }
    case 'rocket_launched': {
      const count = asNumber(payload.count);
      return {
        toast: {
          kind: 'info',
          title: '火箭发射',
          body: count !== undefined && count > 1 ? `×${count}` : undefined,
          href: planetHref(payload),
        },
      };
    }
    // 命令入队后在执行阶段失败（如建造到一半发现缺料/地块不可用）：
    // HTTP 层已 accepted，executor 不会弹 toast，必须在这里兜底提醒。
    case 'command_result': {
      const code = asString(payload.code).toUpperCase();
      const message = asString(payload.message);
      if (isGameFinishedResult({ code, message })) {
        return {
          toast: {
            kind: 'danger',
            title: '对局已结束',
            body: GAME_FINISHED_MESSAGE,
            href: '/settlement',
            mergeKey: 'command_result_fail:GAME_FINISHED',
          },
          sfx: 'alert',
        };
      }
      const status = asString(payload.status).toLowerCase();
      const failed = (code !== '' && code !== 'OK')
        || status.includes('fail')
        || status.includes('error');
      if (!failed) {
        return null;
      }
      return {
        toast: {
          kind: 'danger',
          title: '命令执行失败',
          body: toPlayerFacingMessage(message),
          href: planetHref(payload),
          mergeKey: `command_result_fail:${code || 'unknown'}`,
        },
        sfx: 'alert',
      };
    }

    // ---------- 舰队/战争流程类（此前无音效，toast 补一声） ----------
    case 'fleet_commissioned':
      return {
        toast: {
          kind: 'info',
          title: '新舰队服役',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
        },
        sfx: 'uiClick',
      };
    case 'fleet_assigned':
      return {
        toast: {
          kind: 'info',
          title: '舰队已编组',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
          mergeKey: 'fleet_assigned',
        },
        sfx: 'uiClick',
      };
    case 'fleet_disbanded':
      return {
        toast: {
          kind: 'info',
          title: '舰队已解散',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
        },
        sfx: 'uiClick',
      };
    case 'squad_deployed':
      return {
        toast: {
          kind: 'info',
          title: '小队已部署',
          href: '/war',
          mergeKey: 'squad_deployed',
        },
        sfx: 'uiClick',
      };
    case 'fleet_attack_started':
      return {
        toast: {
          kind: 'warning',
          title: '舰队出击',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
        },
        sfx: 'alert',
      };
    case 'fleet_move_started': {
      const from = asString(payload.from_system_id);
      const to = asString(payload.to_system_id);
      return {
        toast: {
          kind: 'info',
          title: `舰队跃迁：${from || '?'}→${to || '?'}`,
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/galaxy',
        },
        sfx: 'uiClick',
      };
    }
    case 'fleet_arrived':
      return {
        toast: {
          kind: 'success',
          title: `舰队抵达：${asString(payload.system_id) || '?'}`,
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/galaxy',
        },
        sfx: 'commandOk',
      };
    case 'theater_zone_alert':
      return {
        toast: {
          kind: 'danger',
          title: `战区告警：${asString(payload.theater_name) || asString(payload.theater_id) || '?'}`,
          body: `${asString(payload.planet_id) || '?'} 区域发现敌方实体 ×${asString(payload.hostile_count) || '?'}`,
          href: '/war',
        },
        sfx: 'alert',
      };
    case 'supply_line_disrupted':
      return {
        toast: {
          kind: 'warning',
          title: '补给线被切断',
          href: '/war',
          mergeKey: 'supply_line_disrupted',
        },
        sfx: 'alert',
      };
    case 'orbital_superiority_changed':
      return {
        toast: {
          kind: 'info',
          title: '轨道控制权变更',
          href: '/war',
          mergeKey: 'orbital_superiority_changed',
        },
        sfx: 'uiClick',
      };
    case 'victory_declared':
      return {
        toast: {
          kind: 'success',
          title: '对局已结束',
          body: '请前往结算页查看战报。',
          href: '/settlement',
        },
        sfx: 'commandOk',
      };

    default:
      return null;
  }
}
