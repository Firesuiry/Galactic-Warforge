import { useState } from 'react';
import type { CatalogView, CommandResponse, PlayerState, Unit } from '@shared/types';
import { getItemDisplayName, getRecipeDisplayName, getTechDisplayName } from './model';
import { normalizeCompletedTechIds } from './research-workflow';
import { useApiClient } from '@/hooks/use-api-client';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from '@/features/planet-commands/store';

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
  const recipes = catalog?.recipes?.filter(recipe => recipe.handcraft_allowed) ?? [];
  const completed = new Set(normalizeCompletedTechIds(player?.tech));
  const isUnlocked = (required: string[] | undefined) => !required?.length || required.some(id => completed.has(id));
  const recipe = recipes.find(entry => entry.id === recipeId) ?? recipes.find(entry => isUnlocked(entry.tech_unlock)) ?? recipes[0];
  const missingTech = recipe && !isUnlocked(recipe.tech_unlock);
  const count = Number.isFinite(batches) ? Math.max(1, Math.min(999, Math.floor(batches))) : 1;
  const missingItems = recipe?.inputs.some(input => (player?.inventory?.[input.item_id] ?? 0) < input.quantity * count);
  const job = mecha.job;
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
        <p>已完成 {job.completed_batches} · 剩余 {job.remaining_batches} · 本批剩余 {job.remaining_ticks} tick</p>
        <progress aria-label="当前任务进度" max={Math.max(1, job.ticks_per_batch)} value={Math.max(0, job.ticks_per_batch - job.remaining_ticks)} />
        <p>{job.state === 'no_energy' ? '核心能量不足，补能后自动继续。' : job.state === 'out_of_range' ? '距离矿点过远，回到 2 格内继续采集。' : `工作中 · 每 tick 消耗 ${job.energy_per_tick} 核心能量`}</p>
        {canControl ? <button className="secondary-button" disabled={pending} onClick={() => void submit('cancel_mecha_job', () => client.cmdCancelMechaJob(unit.id))}>取消机甲任务</button> : null}
      </section> : null}
      {canControl ? <form onSubmit={async event => {
        event.preventDefault();
        if (!fuel || full || pending) return;
        await submit('refuel_mecha', () => client.cmdRefuelMecha(unit.id, fuel.id, 1));
      }}>
        <label>背包燃料
          <select aria-label="机甲燃料" value={fuel?.id ?? ''} onChange={event => setFuelId(event.target.value)}>
            {fuels.map(item => <option key={item.id} value={item.id}>{getItemDisplayName(catalog, item.id)} · {item.mecha_fuel_energy} 能量</option>)}
          </select>
        </label>
        <button className="secondary-button" type="submit" disabled={!fuel || full || pending}>
          {pending ? '提交中…' : '消耗 1 个燃料补能'}
        </button>
        <p className="muted">从背包扣除燃料。核心已满或尚有燃料余能时无需添加。</p>
      </form> : null}
      {canControl ? <form aria-label="个人制造" onSubmit={event => {
        event.preventDefault();
        if (!recipe || missingTech || missingItems || job || pending || !player) return;
        void submit('craft_item', () => client.cmdCraftItem(unit.id, recipe.id, count));
      }}>
        <div className="section-title">个人制造</div>
        <label>个人制造配方
          <select aria-label="个人制造配方" value={recipe?.id ?? ''} onChange={event => setRecipeId(event.target.value)}>
            {recipes.map(entry => <option key={entry.id} value={entry.id}>{getRecipeDisplayName(catalog, entry.id)}{isUnlocked(entry.tech_unlock) ? '' : ' · 科技未解锁'}</option>)}
          </select>
        </label>
        <label>制造批数<input aria-label="制造批数" type="number" min={1} max={999} step={1} value={batches} onChange={event => setBatches(Number(event.target.value))} /></label>
        {recipe ? <>
          <p>原料：{recipe.inputs.map(input => `${getItemDisplayName(catalog, input.item_id)} ${input.quantity * count}（背包 ${player ? player.inventory?.[input.item_id] ?? 0 : '…'}）`).join('、') || '无'}</p>
          <p>产物：{[...recipe.outputs, ...(recipe.byproducts ?? [])].map(output => `${getItemDisplayName(catalog, output.item_id)} ${output.quantity * count}`).join('、')}</p>
          <p>耗时 {recipe.duration * count} tick · 核心耗能 {recipe.duration * count}（每 tick 1）</p>
          {missingTech ? <p role="status">需要科技：{recipe.tech_unlock?.map(id => getTechDisplayName(catalog, id)).join(' 或 ')}</p> : !player ? <p role="status">正在读取背包…</p> : missingItems ? <p role="status">背包原料不足，请先采集或取回原料。</p> : null}
        </> : <p>暂无可手工制造的配方。</p>}
        <button className="secondary-button" disabled={!recipe || missingTech || missingItems || Boolean(job) || pending || !player} type="submit">开始制造</button>
        <p className="muted">制造时预留原料；取消会退回未完成部分。</p>
      </form> : null}
    </section>
  );
}
