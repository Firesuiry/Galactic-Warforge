import type {
  LandingOperationStage,
  PlanetBlockadeStatus,
  WarBaseFrameCatalogEntry,
  WarBaseHullCatalogEntry,
  WarBlueprintDetailView,
  WarBlueprintValidationIssue,
  WarComponentCatalogEntry,
  WarOrderStatus,
  WarProductionStage,
  WarSupplyCondition,
  WarTaskForceStance,
  WarfareCatalogView,
} from '@shared/types';

function formatOrFallback(value: string | undefined, fallback: string) {
  return value && value.length > 0 ? value : fallback;
}

export function formatSupplyCondition(condition?: WarSupplyCondition) {
  switch (condition) {
    case 'healthy':
      return '补给健康';
    case 'strained':
      return '补给吃紧';
    case 'critical':
      return '补给危急';
    case 'collapsed':
      return '补给崩溃';
    default:
      return '补给未知';
  }
}

export function formatOrderStatus(status?: WarOrderStatus) {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'in_progress':
      return '进行中';
    case 'blocked':
      return '阻塞';
    case 'completed':
      return '已完成';
    default:
      return '未知';
  }
}

export function formatProductionStage(stage?: WarProductionStage) {
  switch (stage) {
    case 'components':
      return '部件阶段';
    case 'assembly':
      return '总装阶段';
    case 'ready':
      return '待部署';
    default:
      return '未知';
  }
}

export function formatTaskForceStance(stance?: WarTaskForceStance) {
  switch (stance) {
    case 'hold':
      return '固守';
    case 'patrol':
      return '巡逻';
    case 'escort':
      return '护航';
    case 'intercept':
      return '拦截';
    case 'harass':
      return '袭扰';
    case 'siege':
      return '围攻';
    case 'bombard':
      return '轰击';
    case 'retreat_on_losses':
      return '受损撤退';
    default:
      return '未知';
  }
}

export function formatBlockadeStatus(status?: PlanetBlockadeStatus) {
  switch (status) {
    case 'planned':
      return '待展开';
    case 'active':
      return '已封锁';
    case 'contested':
      return '封锁争夺中';
    case 'broken':
      return '封锁失效';
    default:
      return '未知';
  }
}

export function formatLandingStage(stage?: LandingOperationStage) {
  switch (stage) {
    case 'reconnaissance':
      return '登陆侦察';
    case 'landing_window_open':
      return '登陆窗口已打开';
    case 'vanguard_landing':
      return '前锋登陆';
    case 'beachhead_established':
      return '滩头已建立';
    case 'failed':
      return '登陆失败';
    default:
      return '未知';
  }
}

export function formatBlueprintState(state?: WarBlueprintDetailView['state']) {
  switch (state) {
    case 'draft':
      return '草案';
    case 'validated':
      return '已校验';
    case 'prototype':
      return '原型';
    case 'field_tested':
      return '实战验证';
    case 'adopted':
      return '定型';
    case 'obsolete':
      return '已淘汰';
    default:
      return '未知';
  }
}

export function formatValidationIssue(issue: WarBlueprintValidationIssue) {
  const parts = [issue.message];
  if (issue.slot_id) {
    parts.push(`槽位 ${issue.slot_id}`);
  }
  if (issue.actual !== undefined && issue.limit !== undefined) {
    parts.push(`${issue.actual}/${issue.limit}`);
  }
  return parts.join(' · ');
}

export function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value * 100)}%`;
}

export function formatMetric(value?: number) {
  return value ?? 0;
}

function findFrame(catalog: WarfareCatalogView | undefined, frameId?: string) {
  return catalog?.base_frames?.find((item) => item.id === frameId);
}

function findHull(catalog: WarfareCatalogView | undefined, hullId?: string) {
  return catalog?.base_hulls?.find((item) => item.id === hullId);
}

export function resolveBlueprintBase(
  catalog: WarfareCatalogView | undefined,
  blueprint: WarBlueprintDetailView | undefined,
): WarBaseFrameCatalogEntry | WarBaseHullCatalogEntry | undefined {
  if (!blueprint) {
    return undefined;
  }
  return findFrame(catalog, blueprint.base_frame_id) ?? findHull(catalog, blueprint.base_hull_id);
}

export function inferBlueprintRole(
  catalog: WarfareCatalogView | undefined,
  blueprint: WarBlueprintDetailView | undefined,
) {
  const base = resolveBlueprintBase(catalog, blueprint);
  if (base?.role) {
    return base.role;
  }

  const componentMap = new Map<string, WarComponentCatalogEntry>();
  catalog?.components?.forEach((component) => {
    componentMap.set(component.id, component);
  });

  const tags = new Set<string>();
  blueprint?.components?.forEach((slot) => {
    componentMap.get(slot.component_id)?.tags?.forEach((tag) => tags.add(tag));
  });
  if (tags.size > 0) {
    return Array.from(tags).join(' / ');
  }
  return formatOrFallback(blueprint?.domain, '未定义角色');
}

export function formatBlueprintBaseLabel(
  catalog: WarfareCatalogView | undefined,
  blueprint: WarBlueprintDetailView | undefined,
) {
  const base = resolveBlueprintBase(catalog, blueprint);
  return base ? `${base.name} (${base.id})` : '未识别底盘';
}

export function getBlueprintSlotComponents(
  catalog: WarfareCatalogView | undefined,
  blueprint: WarBlueprintDetailView | undefined,
) {
  const base = resolveBlueprintBase(catalog, blueprint);
  if (!base?.slots) {
    return [];
  }

  const components = catalog?.components ?? [];
  return base.slots.map((slot) => {
    const current = blueprint?.components?.find((item) => item.slot_id === slot.id)?.component_id ?? '';
    const candidates = components.filter((component) => {
      if (component.category !== slot.category) {
        return false;
      }
      if (!component.supported_domains || component.supported_domains.length === 0) {
        return true;
      }
      return Boolean(blueprint?.domain && component.supported_domains.includes(blueprint.domain));
    });
    return {
      slot,
      current,
      candidates,
    };
  });
}
