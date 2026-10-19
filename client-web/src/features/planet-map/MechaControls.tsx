import { useState } from 'react';
import type { CatalogView, CommandResponse, ItemInventory, PlayerState, Unit } from '@shared/types';
import { getItemDisplayName, getRecipeDisplayName, getTechDisplayName } from './model';
import { normalizeCompletedTechIds } from './research-workflow';
import { isRecipeUnlocked } from './tech-gate';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { MechaLogisticsControls } from './MechaLogisticsControls';
import { mechaCraftEnergyPerBatch, MECHA_MINE_RANGE } from './mecha-costs';
import { usePlanetViewStore } from './store';
import type { MechaView } from '@/features/mecha/model';
import { mechaOperatorLabel, mechaSlotUsage } from '@/features/mecha/model';
import { useSessionSnapshot } from '@/hooks/use-session';

/** 补满所需燃料块数：按缺口向上取整，受背包持有量限制（服务端同样按缺口截断）。 */
export function refuelFullQuantity(missingEnergy: number, fuelEnergy: number, owned: number) {
  if (missingEnergy <= 0 || fuelEnergy <= 0) return 0;
  return Math.min(owned, Math.ceil(missingEnergy / fuelEnergy));
}

/** 服务端默认 10 tick/s（遭遇战预设）兜底：实际速率由调用方从 /games/current 传入。 */
const DEFAULT_TICKS_PER_SECOND = 10;

/** 剩余 tick → 「1 分 12 秒」（负数/零 → 「即将完成」）。 */
export function formatDuration(ticks: number, tickRate: number = DEFAULT_TICKS_PER_SECOND): string {
  if (!Number.isFinite(ticks) || ticks <= 0) return '即将完成';
  const rate = tickRate > 0 ? tickRate : DEFAULT_TICKS_PER_SECOND;
  const totalSeconds = Math.ceil(ticks / rate);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

/** 批量任务剩余 tick：未完成批次（含当前批剩余）+ 每批 tick。 */
export function remainingJobTicks(job: {
  remaining_batches: number;
  remaining_ticks: number;
  ticks_per_batch: number;
}): number {
  return Math.max(0, (job.remaining_batches - 1) * job.ticks_per_batch) + Math.max(0, job.remaining_ticks);
}

/** 批量任务总批数：已完成 + 剩余（服务端不直接下发总数）。 */
export function totalJobBatches(job: { completed_batches: number; remaining_batches: number }): number {
  return Math.max(1, job.completed_batches + job.remaining_batches);
}

/**
 * 「开始制造」被禁用的准确原因（按玩家能采取的行动排序）：
 * 机甲正在执行上一个任务时，缺料只是次要原因——玩家看到「背包原料不足」会去采集，
 * 但真正要等的是当前任务完成（试玩 1009 I）。原因里带上当前任务与预计剩余时间。
 *
 * 任务名必须取 **job 自己的配方/资源**（jobRecipeName / resourceName），
 * 不能用下拉框当前选中的配方：机甲在手搓磁铁、玩家把下拉框切到玻璃时，
 * 面板会写「机甲正在手搓 玻璃」（试玩 1011 F）。
 */
export function craftBlockReason(input: {
  hasRecipe: boolean;
  missingTech: boolean;
  missingItems: boolean;
  hasPlayer: boolean;
  job?: { kind: string; recipe_id?: string; resource_id?: string; completed_batches: number; remaining_batches: number; remaining_ticks: number; ticks_per_batch: number };
  /** 当前 job 的配方显示名（job.recipe_id 的显示名，不是下拉框选中的配方）。 */
  jobRecipeName: string;
  resourceName: string;
  /** 服务端实际 tick 速率（/games/current 的 max_tick_rate）；缺省按 10 换算。 */
  tickRate?: number;
}): string | null {
  if (!input.hasRecipe) return '暂无可手工制造的配方。';
  // 机甲正在忙排在科技/背包之前：它才是「按钮为什么点不动」的真正原因，
  // 缺料只是次要（试玩 1010 H：手搓中打开面板看不出在忙什么）。
  if (input.job) {
    const total = totalJobBatches(input.job);
    const subject = input.job.kind === 'mine'
      ? `手动采集 ${input.resourceName}`
      : `手搓 ${input.jobRecipeName}`;
    return `机甲正在${subject}（已完成 ${input.job.completed_batches}/${total}，剩余约 ${formatDuration(remainingJobTicks(input.job), input.tickRate ?? DEFAULT_TICKS_PER_SECOND)}），完成后可开始新任务；需要中断请点「取消机甲任务」。`;
  }
  if (input.missingTech) return null; // 科技未解锁由独立提示行负责
  if (!input.hasPlayer) return null; // 背包未加载由独立提示行负责
  if (input.missingItems) return '背包原料不足，请先采集或取回原料。';
  return null;
}

/**
 * 机甲侧栏（契约 §7.3 第 2 条）。最上方「操作者」一行决定三态：
 * - `mecha.operator === 自己`：显示全部控件，背包数字读**这台机甲**的档案；
 * - 别人的：只读信息（核心能量、背包格数）+「接管」按钮，隐藏手搓/采集/补能/配送控件；
 * - 空闲：显示「空闲机甲」+「接管」按钮。
 *
 * `player` 只用来读科技与研究状态；背包一律读 `mecha.inventory`（机甲档案）。
 */
export function MechaControls({ unit, catalog, planetId, mecha, boundMecha, player, tickRate }: {
  unit: Unit; catalog?: CatalogView; planetId: string;
  /** 这台机甲的档案（summary.players[me].mechas 里按 unit_id 找到）；缺失时按空闲处理。 */
  mecha?: MechaView;
  /** 当前发令者已绑定的机甲（用于「接管后 <旧ID> 变为空闲」提示）。 */
  boundMecha?: MechaView;
  player?: PlayerState;
  /** 服务端实际 tick 速率（/games/current 的 max_tick_rate）；缺省按 10 换算。 */
  tickRate?: number;
}) {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const playerId = session.playerId;
  const [fuelId, setFuelId] = useState('coal');
  const [pending, setPending] = useState(false);
  const [assignPending, setAssignPending] = useState(false);
  const inventory: ItemInventory | undefined = mecha?.inventory;
  /** 只有自己的机甲档案才会出现在 summary 里；别人玩家的机甲按 owner 显示、不给「接管」。 */
  const isOwnUnit = Boolean(playerId) && unit.owner_id === playerId;
  const operator = isOwnUnit ? mecha?.operator ?? '' : unit.owner_id;
  const isMine = isOwnUnit && operator === playerId;
  const slotUsage = mechaSlotUsage(mecha);
  // 配方选择放在行星视图 store：详情面板会随「选中单位是否落在场景窗口内」卸载重挂，
  // 组件内 state 会丢，下拉框跳回第一个可用配方（试玩 1013 bug-1013-2）。
  const recipeId = usePlanetViewStore((state) => state.craftRecipeId);
  const setRecipeId = usePlanetViewStore((state) => state.setCraftRecipeId);
  const [batches, setBatches] = useState(1);
  const unitMecha = unit.mecha;
  if (!unitMecha) return null;
  const fuels = catalog?.items?.filter(item => (item.mecha_fuel_energy ?? 0) > 0) ?? [];
  const fuel = fuels.find(item => item.id === fuelId) ?? fuels[0];
  const full = unitMecha.energy >= unitMecha.max_energy || unitMecha.fuel_energy > 0;
  const fuelOwned = fuel ? inventory?.[fuel.id] ?? 0 : 0;
  const fillQuantity = fuel ? refuelFullQuantity(unitMecha.max_energy - unitMecha.energy, fuel.mecha_fuel_energy ?? 0, fuelOwned) : 0;
  const recipes = catalog?.recipes?.filter(recipe => recipe.handcraft_allowed) ?? [];
  const completed = new Set(normalizeCompletedTechIds(player?.tech));
  // 配方科技门控统一走 tech-gate（对齐服务端 CanUseRecipeTech：无门控=基础配方，有门控则任一完成即可）。
  const isUnlocked = (recipe: { tech_unlock?: string[] }) => isRecipeUnlocked(recipe, completed);
  const recipe = recipes.find(entry => entry.id === recipeId) ?? recipes.find(entry => isUnlocked(entry)) ?? recipes[0];
  const missingTech = recipe && !isUnlocked(recipe);
  const count = Number.isFinite(batches) ? Math.max(1, Math.min(999, Math.floor(batches))) : 1;
  const missingItems = recipe?.inputs.some(input => (inventory?.[input.item_id] ?? 0) < input.quantity * count);
  // 缺料时按钮禁用，并把缺什么说清楚：只看「背包原料不足」玩家不知道差几个（试玩 1013 C/D）。
  const missingInputs = (recipe?.inputs ?? []).flatMap(input => {
    const owned = inventory?.[input.item_id] ?? 0;
    const required = input.quantity * count;
    return owned < required
      ? [{ itemId: input.item_id, owned, required }]
      : [];
  });
  const missingInputsText = missingInputs
    .map(input => `${getItemDisplayName(catalog, input.itemId)}（背包 ${input.owned} / 需要 ${input.required}）`)
    .join('、');
  const job = unitMecha.job;
  const totalBatches = job ? totalJobBatches(job) : 0;
  const remainingTicks = job ? remainingJobTicks(job) : 0;
  const craftBlockReasonText = craftBlockReason({
    hasRecipe: Boolean(recipe),
    missingTech: Boolean(missingTech),
    missingItems: Boolean(missingItems),
    hasPlayer: Boolean(mecha),
    job,
    jobRecipeName: job?.recipe_id ? getRecipeDisplayName(catalog, job.recipe_id) : '',
    resourceName: job?.resource_id ? getItemDisplayName(catalog, job.resource_id) : '',
    tickRate,
  });
  async function submit(commandType: string, execute: () => Promise<CommandResponse>) {
    if (pending) return;
    setPending(true);
    try {
      await submitPlanetCommand({ commandType, planetId, focus: { entityId: unit.id }, execute,
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
      });
    } finally { setPending(false); }
  }
  async function assignToMe() {
    if (assignPending || !playerId) return;
    setAssignPending(true);
    try {
      await submitPlanetCommand({
        commandType: 'assign_mecha',
        planetId,
        focus: { entityId: unit.id },
        execute: () => client.cmdAssignMecha(mecha?.unit_id ?? unit.id, playerId, planetId),
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
      });
    } finally { setAssignPending(false); }
  }
  const canControl = isMine;
  const operatorLabel = mechaOperatorLabel(operator, playerId);
  const takeoverHint = isOwnUnit && boundMecha && boundMecha.unit_id !== unit.id
    ? `接管后 ${boundMecha.unit_id} 变为空闲`
    : null;
  return (
    <section className="planet-side-section mecha-controls" aria-label="机甲核心">
      {/* 操作者行（契约 §7.3 第 2 条）：三态决定下面的控件是否出现。 */}
      <div className="mecha-operator" aria-label="机甲操作者">
        <div className="mecha-operator__line">
          <span className="mecha-operator__label">操作者</span>
          <strong className="mecha-operator__value">
            {isMine ? '我' : operator ? operatorLabel : '空闲机甲'}
          </strong>
          <span className="mecha-operator__id">{unit.id}</span>
          {!isMine && isOwnUnit ? (
            <button
              className="secondary-button mecha-operator__takeover"
              disabled={assignPending || !playerId}
              onClick={() => void assignToMe()}
              type="button"
            >
              {assignPending ? '接管中…' : '接管'}
            </button>
          ) : null}
        </div>
        {!isMine && takeoverHint ? <p className="muted mecha-operator__hint">{takeoverHint}</p> : null}
        {!isMine && mecha && slotUsage ? (
          <p className="muted mecha-operator__readonly">背包 {slotUsage.used}/{slotUsage.total} 格</p>
        ) : null}
      </div>
      {canControl ? <MechaLogisticsControls unit={unit} catalog={catalog} planetId={planetId} inventory={inventory} /> : null}
      <div className="section-title">机甲核心</div>
      <label>核心能量 <strong>{unitMecha.energy} / {unitMecha.max_energy}</strong>
        <meter aria-label="核心能量" min={0} max={unitMecha.max_energy} value={unitMecha.energy} />
      </label>
      <label>能量护盾 <strong>{unitMecha.shield} / {unitMecha.max_shield}</strong>
        <meter aria-label="能量护盾" min={0} max={Math.max(1, unitMecha.max_shield)} value={unitMecha.shield} />
      </label>
      <p className="muted">燃料余能 {unitMecha.fuel_energy} · 每次攻击耗能 {unitMecha.attack_energy_cost} · 每格移动耗能 {unitMecha.move_energy_cost}</p>
      <p className="muted">{unitMecha.max_shield > 0 ? `脱战 ${unitMecha.shield_recharge_delay} tick 后消耗核心能量恢复护盾。` : '研究能量护盾科技后解锁护盾。'}</p>
      <p className="muted">靠近运行中的供电塔可自动充电。</p>
      {job ? <section className="mecha-job" aria-label="机甲任务">
        <strong>{job.kind === 'mine' ? '手动采集中' : `制造 ${getRecipeDisplayName(catalog, job.recipe_id ?? '')}`}</strong>
        <div className="mecha-job__progress" role="group" aria-label="批量进度">
          <progress
            aria-label="批量进度"
            max={Math.max(1, totalBatches)}
            value={job.completed_batches}
          />
          <span>已完成 {job.completed_batches} / {totalBatches}</span>
        </div>
        <p>本批剩余 {job.remaining_ticks} tick · 剩余 {job.remaining_batches} 批 · 预计还需 {formatDuration(remainingTicks, tickRate)}</p>
        <p>{job.state === 'no_energy' ? '核心能量不足，补能后自动继续。' : job.state === 'out_of_range' ? `距离矿点过远，回到 ${MECHA_MINE_RANGE} 格内继续采集。` : job.state === 'inventory_full' ? '背包已满（按格计：每格可堆叠该物品的堆叠上限），装不下的产出不会丢失：腾出空位后自动继续。' : `工作中 · 每批开工消耗 ${job.energy_per_batch} 核心能量`}</p>
        {canControl ? <button className="secondary-button" disabled={pending} onClick={() => void submit('cancel_mecha_job', () => client.cmdCancelMechaJob(planetId))}>取消机甲任务</button> : null}
      </section> : null}
      {canControl ? <form onSubmit={async event => {
        event.preventDefault();
        if (!fuel || full || pending || fillQuantity <= 0) return;
        await submit('refuel_mecha', () => client.cmdRefuelMecha(fuel.id, fillQuantity, planetId));
      }}>
        <label>背包燃料
          <select aria-label="机甲燃料" value={fuel?.id ?? ''} onChange={event => setFuelId(event.target.value)}>
            {fuels.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)} · {item.mecha_fuel_energy} 能量</option>)}
          </select>
        </label>
        <div className="mecha-controls__refuel">
          <button className="primary-button" type="submit" disabled={!fuel || full || pending || fillQuantity <= 0}>
            {pending ? '提交中…' : fillQuantity > 0 ? `补满（${fillQuantity} 个）` : '补满'}
          </button>
          <button className="secondary-button" type="button" disabled={!fuel || full || pending || fuelOwned <= 0}
            onClick={() => { if (fuel) void submit('refuel_mecha', () => client.cmdRefuelMecha(fuel.id, 1, planetId)); }}>
            补 1 个
          </button>
        </div>
        <p className="muted">背包有 {fuelOwned} 个{fuel ? getItemDisplayName(catalog, fuel.id) : '燃料'}。{full ? '核心已满或尚有燃料余能，暂不需补能。' : ''}</p>
      </form> : null}
      {canControl ? <form aria-label="个人制造" onSubmit={event => {
        event.preventDefault();
        if (!recipe || missingTech || missingItems || job || pending || !mecha) return;
        void submit('craft_item', () => client.cmdCraftItem(recipe.id, count, planetId));
      }}>
        <div className="section-title">个人制造</div>
        <label>个人制造配方
          <select aria-label="个人制造配方" value={recipe?.id ?? ''} onChange={event => setRecipeId(event.target.value)}>
            {recipes.map(entry => <option key={entry.id} value={entry.id}>{getRecipeDisplayName(catalog, entry.id)}{isUnlocked(entry) ? '' : ' · 科技未解锁'}</option>)}
          </select>
        </label>
        <label>制造批数<input aria-label="制造批数" type="number" min={1} max={999} step={1} value={batches} onChange={event => setBatches(Number(event.target.value))} /></label>
        {recipe ? <>
          <p>原料：{recipe.inputs.map(input => `${getItemDisplayName(catalog, input.item_id)} ${input.quantity * count}（背包 ${mecha ? inventory?.[input.item_id] ?? 0 : '…'}）`).join('、') || '无'}</p>
          <p>产物：{[...recipe.outputs, ...(recipe.byproducts ?? [])].map(output => `${getItemDisplayName(catalog, output.item_id)} ${output.quantity * count}`).join('、')}</p>
          <p>耗时 {recipe.duration * count} tick · 核心耗能 {mechaCraftEnergyPerBatch(recipe.duration) * count}（每批 {mechaCraftEnergyPerBatch(recipe.duration)}）</p>
          {craftBlockReasonText
            ? (
              <p role="status">
                {craftBlockReasonText}
                {missingInputsText && !job ? ` 缺少：${missingInputsText}` : ''}
              </p>
            )
            : missingTech ? <p role="status">需要科技：{recipe.tech_unlock?.map(id => getTechDisplayName(catalog, id)).join(' 或 ')}</p> : !mecha ? <p role="status">正在读取背包…</p> : null}
        </> : <p>暂无可手工制造的配方。</p>}
        <button className="secondary-button" disabled={!recipe || missingTech || missingItems || Boolean(job) || pending || !mecha} type="submit">开始制造</button>
        <p className="muted">制造时预留原料；取消会退回未完成部分。</p>
      </form> : null}
    </section>
  );
}
