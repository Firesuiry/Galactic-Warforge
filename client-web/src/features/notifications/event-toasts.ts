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

import type { SoundName } from '@/engine/audio';
import { isBuildingCompletionEvent } from '@/features/audio/planet-audio';
import type { ToastInput } from '@/features/notifications/store';
import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { translateAlertType, translateBuildingType, translateTechId } from '@/i18n/translate';

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

function planetHref(payload: Record<string, unknown>): string | undefined {
  const planetId = asString(payload.planet_id);
  return planetId ? `/planet/${planetId}` : undefined;
}

export function toastFromGameEvent(event: GameEventDetail): EventToast | null {
  const payload = event.payload ?? {};

  switch (event.event_type) {
    // ---------- 战斗类（战斗总线已配音，toast 不再发声） ----------
    case 'battle_report_generated': {
      const report = asRecord(payload.report);
      const destroyed = report?.target_destroyed === true;
      const damage = asNumber(report?.target_strength_loss);
      const targetId = asString(report?.target_id);
      return {
        toast: {
          kind: 'danger',
          title: destroyed ? '☄ 击毁目标' : '⚔ 舰队交火',
          body: [
            targetId ? shortId(targetId) : '',
            damage !== undefined ? `-${Math.round(damage)}` : '',
          ].filter(Boolean).join(' · ') || undefined,
          href: '/war',
          mergeKey: `battle:${asString(report?.fleet_id) || 'unknown'}`,
        },
      };
    }
    case 'entity_destroyed': {
      const entityId = asString(payload.entity_id) || asString(payload.target_id);
      return {
        toast: {
          kind: 'danger',
          title: '✖ 单位被摧毁',
          body: entityId ? shortId(entityId) : undefined,
          href: '/war',
          mergeKey: 'entity_destroyed',
        },
      };
    }
    case 'missile_salvo_fired': {
      const count = asNumber(payload.count) ?? asNumber(payload.salvo_size);
      return {
        toast: {
          kind: 'info',
          title: '🚀 导弹齐射',
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
          title: '🛡 点防拦截',
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
          title: `✓ 建造完成：${buildingType ? translateBuildingType(buildingType) : '建筑'}`,
          href: planetHref(payload),
        },
      };
    }
    case 'research_completed': {
      const techId = asString(payload.tech_id);
      return {
        toast: {
          kind: 'success',
          title: `✓ 研究完成：${techId ? translateTechId(techId) : '科技'}`,
          href: planetHref(payload),
        },
      };
    }
    case 'production_alert': {
      const alert = asRecord(payload.alert);
      const alertType = asString(alert?.alert_type);
      const buildingType = asString(alert?.building_type);
      const buildingId = asString(alert?.building_id) || asString(payload.building_id);
      // 研究模式（无配方）的 matrix_lab / self_evolution_lab 是合法开局状态，
      // 其吞吐类告警属噪音，不弹 toast（见 production-alerts.ts）
      if (isResearchStationAlertNoise({ building_type: buildingType, alert_type: alertType })) {
        return null;
      }
      // 文案本地化：建筑名 + 告警类型，不使用 server 的英文原文 message
      const issue = translateAlertType(alertType, asString(alert?.message) || '产线告警');
      const buildingLabel = buildingType
        ? `${translateBuildingType(buildingType)}${buildingId ? ` ${shortId(buildingId)}` : ''}`
        : (buildingId ? shortId(buildingId) : '');
      return {
        toast: {
          kind: 'warning',
          title: '⚠ 产线告警',
          body: [buildingLabel, issue].filter(Boolean).join('：') || undefined,
          href: planetHref(payload),
          // 同建筑同原因合并计数，避免刷屏
          mergeKey: `production_alert:${buildingId || 'unknown'}:${alertType || 'unknown'}`,
        },
      };
    }
    case 'rocket_launched': {
      const count = asNumber(payload.count);
      return {
        toast: {
          kind: 'info',
          title: '🚀 火箭发射',
          body: count !== undefined && count > 1 ? `×${count}` : undefined,
          href: planetHref(payload),
        },
      };
    }

    // ---------- 舰队/战争流程类（此前无音效，toast 补一声） ----------
    case 'fleet_commissioned':
      return {
        toast: {
          kind: 'info',
          title: '🛰 新舰队服役',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
        },
        sfx: 'uiClick',
      };
    case 'fleet_assigned':
      return {
        toast: {
          kind: 'info',
          title: '🛰 舰队已编组',
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
          title: '🛰 舰队已解散',
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/war',
        },
        sfx: 'uiClick',
      };
    case 'squad_deployed':
      return {
        toast: {
          kind: 'info',
          title: '⬇ 小队已部署',
          href: '/war',
          mergeKey: 'squad_deployed',
        },
        sfx: 'uiClick',
      };
    case 'fleet_attack_started':
      return {
        toast: {
          kind: 'warning',
          title: '⚔ 舰队出击',
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
          title: `🚀 舰队跃迁：${from || '?'}→${to || '?'}`,
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
          title: `✓ 舰队抵达：${asString(payload.system_id) || '?'}`,
          body: shortId(asString(payload.fleet_id)) || undefined,
          href: '/galaxy',
        },
        sfx: 'commandOk',
      };
    case 'landing_started':
      return {
        toast: {
          kind: 'warning',
          title: '⬇ 登陆作战开始',
          href: '/war',
        },
        sfx: 'alert',
      };
    case 'landing_failed':
      return {
        toast: {
          kind: 'danger',
          title: '✖ 登陆失败',
          href: '/war',
        },
        sfx: 'explosion',
      };
    case 'supply_line_disrupted':
      return {
        toast: {
          kind: 'warning',
          title: '⚠ 补给线被切断',
          href: '/war',
          mergeKey: 'supply_line_disrupted',
        },
        sfx: 'alert',
      };
    case 'orbital_superiority_changed':
      return {
        toast: {
          kind: 'info',
          title: '🛰 轨道控制权变更',
          href: '/war',
          mergeKey: 'orbital_superiority_changed',
        },
        sfx: 'uiClick',
      };
    case 'victory_declared':
      return {
        toast: {
          kind: 'success',
          title: '🏆 胜利宣言',
          href: '/war',
        },
        sfx: 'commandOk',
      };

    default:
      return null;
  }
}
