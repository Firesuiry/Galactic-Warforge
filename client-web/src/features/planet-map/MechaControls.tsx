import { useState } from 'react';
import type { CatalogView, CommandResponse, PlayerState, Unit } from '@shared/types';
import { getItemDisplayName, getRecipeDisplayName, getTechDisplayName } from './model';
import { normalizeCompletedTechIds } from './research-workflow';
import { isRecipeUnlocked } from './tech-gate';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';
import { MechaLogisticsControls } from './MechaLogisticsControls';
import { mechaCraftEnergyPerBatch } from './mecha-costs';

/** 补满所需燃料块数：按缺口向上取整，受背包持有量限制（服务端同样按缺口截断）。 */
export function refuelFullQuantity(missingEnergy: number, fuelEnergy: number, owned: number) {
  if (missingEnergy <= 0 || fuelEnergy <= 0) return 0;
  return Math.min(owned, Math.ceil(missingEnergy / fuelEnergy));
}

/** 服务端默认 10 tick/s（遭遇战预设）：tick 数换算成「X 分 Y 秒」。 */
const TICKS_PER_SECOND = 10;

/** 剩余 tick → 「1 分 12 秒」（负数/零 → 「即将完成」）。 */
export function formatDuration(ticks: number): string {
  if (!Number.isFinite(ticks) || ticks <= 0) return '即将完成';
  const totalSeconds = Math.ceil(ticks / TICKS_PER_SECOND);
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
}): string | null {
  if (!input.hasRecipe) return '暂无可手工制造的配方。';
  // 机甲正在忙排在科技/背包之前：它才是「按钮为什么点不动」的真正原因，
  // 缺料只是次要（试玩 1010 H：手搓中打开面板看不出在忙什么）。
  if (input.job) {
    const total = totalJobBatches(input.job);
    const subject = input.job.kind === 'mine'
      ? `手动采集 ${input.resourceName}`
      : `手搓 ${input.jobRecipeName}`;
    return `机甲正在${subject}（已完成 ${input.job.completed_batches}/${total}，剩余约 ${formatDuration(remainingJobTicks(input.job))}），完成后可开始新任务；需要中断请点「取消机甲任务」。`;
  }
  if (input.missingTech) return null; // 科技未解锁由独立提示行负责
  if (!input.hasPlayer) return null; // 背包未加载由独立提示行负责
  if (input.missingItems) return '背包原料不足，请先采集或取回原料。';
  return null;
}

/** All values and fuel choices come from the authoritative scene and catalog. */
export function MechaControls({ unit, catalog, planetId, canControl, player }: {
  unit: Unit; catalog?: CatalogView; planetId: string; canControl: boolean; player?: PlayerState;
}) {
  const client = useApiClient();
  const [fuelId, setFuelId] = useState('coal');
  const [pending, setPending] = useState(false);
  const [recipeId, setRecipeId] = useState('');
  const [batches, setBatches] = useState(1);
  const mecha = unit.mecha;
  if (!mecha) return null;
  const fuels = catalog?.items?.filter(item => (item.mecha_fuel_energy ?? 0) > 0) ?? [];
  const fuel = fuels.find(item => item.id === fuelId) ?? fuels[0];
  const full = mecha.energy >= mecha.max_energy || mecha.fuel_energy > 0;
  const fuelOwned = fuel ? player?.inventory?.[fuel.id] ?? 0 : 0;
  const fillQuantity = fuel ? refuelFullQuantity(mecha.max_energy - mecha.energy, fuel.mecha_fuel_energy ?? 0, fuelOwned) : 0;
  const recipes = catalog?.recipes?.filter(recipe => recipe.handcraft_allowed) ?? [];
  const completed = new Set(normalizeCompletedTechIds(player?.tech));
  // 配方科技门控统一走 tech-gate（对齐服务端 CanUseRecipeTech：无门控=基础配方，有门控则任一完成即可）。
  const isUnlocked = (recipe: { tech_unlock?: string[] }) => isRecipeUnlocked(recipe, completed);
  const recipe = recipes.find(entry => entry.id === recipeId) ?? recipes.find(entry => isUnlocked(entry)) ?? recipes[0];
  const missingTech = recipe && !isUnlocked(recipe);
  const count = Number.isFinite(batches) ? Math.max(1, Math.min(999, Math.floor(batches))) : 1;
  const missingItems = recipe?.inputs.some(input => (player?.inventory?.[input.item_id] ?? 0) < input.quantity * count);
  const job = mecha.job;
  const totalBatches = job ? totalJobBatches(job) : 0;
  const remainingTicks = job ? remainingJobTicks(job) : 0;
  const craftBlockReasonText = craftBlockReason({
    hasRecipe: Boolean(recipe),
    missingTech: Boolean(missingTech),
    missingItems: Boolean(missingItems),
    hasPlayer: Boolean(player),
    job,
    jobRecipeName: job?.recipe_id ? getRecipeDisplayName(catalog, job.recipe_id) : '',
    resourceName: job?.resource_id ? getItemDisplayName(catalog, job.resource_id) : '',
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
  return (
    <section className="planet-side-section mecha-controls" aria-label="机甲核心">
      {canControl ? <MechaLogisticsControls unit={unit} catalog={catalog} planetId={planetId} inventory={player?.inventory} /> : null}
      <div className="section-title">机甲核心</div>
      <label>核心能量 <strong>{mecha.energy} / {mecha.max_energy}</strong>
        <meter aria-label="核心能量" min={0} max={mecha.max_energy} value={mecha.energy} />
      </label>
      <label>能量护盾 <strong>{mecha.shield} / {mecha.max_shield}</strong>
        <meter aria-label="能量护盾" min={0} max={Math.max(1, mecha.max_shield)} value={mecha.shield} />
      </label>
      <p className="muted">燃料余能 {mecha.fuel_energy} · 每次攻击耗能 {mecha.attack_energy_cost} · 每格移动耗能 {mecha.move_energy_cost}</p>
      <p className="muted">{mecha.max_shield > 0 ? `脱战 ${mecha.shield_recharge_delay} tick 后消耗核心能量恢复护盾。` : '研究能量护盾科技后解锁护盾。'}</p>
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
        <p>本批剩余 {job.remaining_ticks} tick · 剩余 {job.remaining_batches} 批 · 预计还需 {formatDuration(remainingTicks)}</p>
        <p>{job.state === 'no_energy' ? '核心能量不足，补能后自动继续。' : job.state === 'out_of_range' ? '距离矿点过远，回到 2 格内继续采集。' : `工作中 · 每批开工消耗 ${job.energy_per_batch} 核心能量`}</p>
        {canControl ? <button className="secondary-button" disabled={pending} onClick={() => void submit('cancel_mecha_job', () => client.cmdCancelMechaJob(unit.id))}>取消机甲任务</button> : null}
      </section> : null}
      {canControl ? <form onSubmit={async event => {
        event.preventDefault();
        if (!fuel || full || pending || fillQuantity <= 0) return;
        await submit('refuel_mecha', () => client.cmdRefuelMecha(unit.id, fuel.id, fillQuantity));
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
            onClick={() => { if (fuel) void submit('refuel_mecha', () => client.cmdRefuelMecha(unit.id, fuel.id, 1)); }}>
            补 1 个
          </button>
        </div>
        <p className="muted">背包有 {fuelOwned} 个{fuel ? getItemDisplayName(catalog, fuel.id) : '燃料'}。{full ? '核心已满或尚有燃料余能，暂不需补能。' : ''}</p>
      </form> : null}
      {canControl ? <form aria-label="个人制造" onSubmit={event => {
        event.preventDefault();
        if (!recipe || missingTech || missingItems || job || pending || !player) return;
        void submit('craft_item', () => client.cmdCraftItem(unit.id, recipe.id, count));
      }}>
        <div className="section-title">个人制造</div>
        <label>个人制造配方
          <select aria-label="个人制造配方" value={recipe?.id ?? ''} onChange={event => setRecipeId(event.target.value)}>
            {recipes.map(entry => <option key={entry.id} value={entry.id}>{getRecipeDisplayName(catalog, entry.id)}{isUnlocked(entry) ? '' : ' · 科技未解锁'}</option>)}
          </select>
        </label>
        <label>制造批数<input aria-label="制造批数" type="number" min={1} max={999} step={1} value={batches} onChange={event => setBatches(Number(event.target.value))} /></label>
        {recipe ? <>
          <p>原料：{recipe.inputs.map(input => `${getItemDisplayName(catalog, input.item_id)} ${input.quantity * count}（背包 ${player ? player.inventory?.[input.item_id] ?? 0 : '…'}）`).join('、') || '无'}</p>
          <p>产物：{[...recipe.outputs, ...(recipe.byproducts ?? [])].map(output => `${getItemDisplayName(catalog, output.item_id)} ${output.quantity * count}`).join('、')}</p>
          <p>耗时 {recipe.duration * count} tick · 核心耗能 {mechaCraftEnergyPerBatch(recipe.duration) * count}（每批 {mechaCraftEnergyPerBatch(recipe.duration)}）</p>
          {craftBlockReasonText ? <p role="status">{craftBlockReasonText}</p> : missingTech ? <p role="status">需要科技：{recipe.tech_unlock?.map(id => getTechDisplayName(catalog, id)).join(' 或 ')}</p> : !player ? <p role="status">正在读取背包…</p> : null}
        </> : <p>暂无可手工制造的配方。</p>}
        <button className="secondary-button" disabled={!recipe || missingTech || missingItems || Boolean(job) || pending || !player} type="submit">开始制造</button>
        <p className="muted">制造时预留原料；取消会退回未完成部分。</p>
      </form> : null}
    </section>
  );
}
