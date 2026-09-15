import { useMemo, useState } from 'react';
import { ArrowDown, Crosshair, Factory, Hammer, Search } from 'lucide-react';
import type { Building, CatalogView, ItemAmount } from '@shared/types';

import { getBuildingDisplayName, getItemDisplayName, getRecipeDisplayName, getTechDisplayName } from '@/features/planet-map/model';
import { translateBuildingState } from '@/i18n/translate';
import { diagnoseProduction, normalizeBatchCount, planRecipe, recipeBuildOptions } from './model';
import './production.css';

export interface ProductionPlannerProps {
  catalog?: CatalogView;
  buildings?: Record<string, Building>;
  playerId: string;
  completedTechs?: string[];
  onFocusBuilding: (building: Building) => void;
  onBuildRecipe: (buildingType: string, recipeId: string) => void;
}

function Materials({ items, catalog }: { items: ItemAmount[]; catalog?: CatalogView }) {
  return <div className="production-planner__materials">
    {items.length ? items.map((item) => <span key={item.item_id}>
      {getItemDisplayName(catalog, item.item_id)} <strong>×{item.quantity}</strong>
    </span>) : <span>无需原料</span>}
  </div>;
}

export function ProductionPlanner({ catalog, buildings, playerId, completedTechs = [], onFocusBuilding, onBuildRecipe }: ProductionPlannerProps) {
  const [search, setSearch] = useState('');
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [batches, setBatches] = useState('1');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const diagnoses = useMemo(() => diagnoseProduction(buildings, catalog, playerId), [buildings, catalog, playerId]);
  const problemCount = diagnoses.filter((entry) => ['offline', 'shortage', 'unconfigured'].includes(entry.state)).length;
  const visibleDiagnoses = onlyProblems ? diagnoses.filter((entry) => ['offline', 'shortage', 'unconfigured'].includes(entry.state)) : diagnoses;
  const recipes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (catalog?.recipes ?? []).filter((recipe) => !query || [getRecipeDisplayName(catalog, recipe.id), recipe.name, recipe.id,
      ...recipe.outputs.map((item) => getItemDisplayName(catalog, item.item_id)),
    ].some((name) => name.toLocaleLowerCase().includes(query)));
  }, [catalog, search]);
  const recipe = recipes.find((entry) => entry.id === selectedRecipeId) ?? recipes[0];
  const plan = recipe ? planRecipe(recipe, Number(batches)) : undefined;
  const buildOptions = recipe ? recipeBuildOptions(recipe, catalog, completedTechs) : [];

  return <section className="production-planner" aria-label="生产规划">
    <header className="production-planner__header">
      <Factory size={19} aria-hidden="true" />
      <div><strong>生产规划</strong><small>串联原料、制造与扩产</small></div>
    </header>
    <details className="production-planner__section" open>
      <summary>产线诊断 <span>{diagnoses.length} 座 · {problemCount} 项待检查</span></summary>
      <p className="production-planner__hint">当前载入区域 · 仅己方建筑。原料按本地库存与输入缓存计算。</p>
      {diagnoses.length > 0 && <label className="production-planner__filter">
        <input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} />仅看待检查
      </label>}
      <div className="production-planner__diagnoses">
        {visibleDiagnoses.map(({ building, recipe: activeRecipe, state, inputs }) => {
          const missing = inputs.filter((input) => input.missing > 0);
          const status = state === 'offline' ? translateBuildingState(building.runtime.state)
            : state === 'unconfigured' ? '未配置配方'
              : state === 'processing' ? `加工中 · ${building.production?.remaining_ticks} tick`
                : state === 'shortage' ? '下批缺料'
                  : building.runtime.functions?.collect ? '采集设施就绪' : activeRecipe ? '原料就绪' : '运行中';
          return <article className={`production-planner__machine production-planner__machine--${state}`} key={building.id}>
            <div className="production-planner__machine-heading">
              <strong>{getBuildingDisplayName(catalog, building.type)}</strong><span>{status}</span>
            </div>
            <small>{activeRecipe ? getRecipeDisplayName(catalog, activeRecipe.id) : building.runtime.functions?.collect ? '资源采集' : '生产设施'} · {building.position.x}, {building.position.y}</small>
            {missing.length > 0 && <p>{state === 'processing' ? '下批备料：' : '原料缺口：'}{missing.map((input) => `${getItemDisplayName(catalog, input.item_id)} ×${input.missing}`).join('、')}</p>}
            <button type="button" onClick={() => onFocusBuilding(building)} aria-label={`定位建筑 ${building.id}`}>
              <Crosshair size={13} aria-hidden="true" />定位并操作
            </button>
          </article>;
        })}
        {!visibleDiagnoses.length && <p className="production-planner__hint">{diagnoses.length ? '当前区域没有待检查产线。' : '当前区域尚无生产设施。选择下方配方开始规划。'}</p>}
      </div>
    </details>
    <details className="production-planner__section" open>
      <summary>配方规划 <span>{catalog?.recipes?.length ?? 0} 项配方</span></summary>
      <label className="production-planner__search"><Search size={15} aria-hidden="true" />
        <input aria-label="搜索生产配方" placeholder="搜索配方或产物" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {recipe && plan ? <>
        <label className="production-planner__field">配方
          <select aria-label="规划配方" value={recipe.id} onChange={(event) => setSelectedRecipeId(event.target.value)}>
            {recipes.map((entry) => <option key={entry.id} value={entry.id}>{getRecipeDisplayName(catalog, entry.id)}</option>)}
          </select>
        </label>
        <label className="production-planner__field">生产批次
          <input aria-label="生产批次" type="number" min={1} max={9999} step={1} value={batches}
            onChange={(event) => setBatches(event.target.value)} onBlur={() => setBatches(String(normalizeBatchCount(Number(batches))))} />
        </label>
        <div className="production-planner__recipe">
          <small>投入 · {plan.batches} 批</small><Materials items={plan.inputs} catalog={catalog} />
          <div className="production-planner__conversion"><ArrowDown size={18} aria-hidden="true" /><span>基础配方时长 {recipe.duration} tick / 批</span></div>
          <small>产出</small><Materials items={plan.outputs} catalog={catalog} />
          {plan.byproducts.length > 0 && <><small>副产物 · 需同时转运</small><Materials items={plan.byproducts} catalog={catalog} /></>}
        </div>
        <p className="production-planner__hint">按基础配方估算用料；实际生产受供电、物流与生产加成影响。</p>
        <div className="production-planner__build-options">
          {buildOptions.map(({ building, missingTechs, recipeTechOptions }) => <div key={building.id}>
            <button type="button" disabled={missingTechs.length > 0 || recipeTechOptions.length > 0} onClick={() => onBuildRecipe(building.id, recipe.id)}>
              <Hammer size={14} aria-hidden="true" />建造{getBuildingDisplayName(catalog, building.id)}
            </button>
            {missingTechs.length > 0 && <small>需研究：{missingTechs.map((tech) => getTechDisplayName(catalog, tech)).join('、')}</small>}
            {recipeTechOptions.length > 0 && <small>配方需任选研究：{recipeTechOptions.map((tech) => getTechDisplayName(catalog, tech)).join(' / ')}</small>}
          </div>)}
          {!buildOptions.length && <p className="production-planner__hint">此配方暂无可直接建造的生产设施。</p>}
        </div>
      </> : <p className="production-planner__hint">{catalog ? '没有匹配的配方。' : '正在同步配方目录…'}</p>}
    </details>
  </section>;
}
