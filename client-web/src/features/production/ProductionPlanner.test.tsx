import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductionPlanner } from './ProductionPlanner';
import { ironRecipe, makeSmelter, productionCatalog } from './test-fixtures';

describe('ProductionPlanner', () => {
  it('does not infer resource output from a collector running state', () => {
    const base = makeSmelter();
    const collector = makeSmelter({ type: 'mining_machine', production: undefined,
      runtime: { ...base.runtime, functions: { collect: { yield_per_tick: 1 } } } });
    render(<ProductionPlanner catalog={productionCatalog} buildings={{ collector }} playerId="player-1"
      onFocusBuilding={vi.fn()} onBuildRecipe={vi.fn()} />);
    expect(screen.getByText('采集设施就绪')).toBeInTheDocument();
    expect(screen.queryByText('采集中')).not.toBeInTheDocument();
  });

  it('locates a shortage, filters healthy machines, and starts building with the selected recipe', async () => {
    const user = userEvent.setup();
    const onFocusBuilding = vi.fn();
    const onBuildRecipe = vi.fn();
    const empty = makeSmelter({ id: 'empty', storage: {} });
    render(<ProductionPlanner catalog={productionCatalog} buildings={{ empty, healthy: makeSmelter() }} playerId="player-1"
      completedTechs={['smelting']} onFocusBuilding={onFocusBuilding} onBuildRecipe={onBuildRecipe} />);
    expect(screen.getByText('下批缺料')).toBeInTheDocument();
    await user.click(screen.getByLabelText('仅看待检查'));
    expect(screen.queryByText('原料就绪')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '定位建筑 empty' }));
    expect(onFocusBuilding).toHaveBeenCalledWith(empty);
    await user.click(screen.getByRole('button', { name: '建造电弧熔炉' }));
    expect(onBuildRecipe).toHaveBeenCalledWith('arc_smelter', ironRecipe.id);
  });
  it('shows scaled inputs, outputs and byproducts while preventing locked construction', async () => {
    const user = userEvent.setup();
    const onBuildRecipe = vi.fn();
    render(<ProductionPlanner catalog={productionCatalog} playerId="player-1" onFocusBuilding={vi.fn()} onBuildRecipe={onBuildRecipe} />);
    const batches = screen.getByRole('spinbutton', { name: '生产批次' });
    await user.clear(batches);
    await user.type(batches, '5');
    const recipeSection = screen.getByText('副产物 · 需同时转运').closest('.production-planner__recipe')! as HTMLElement;
    expect(within(recipeSection).getByText('×10')).toBeInTheDocument();
    expect(within(recipeSection).getAllByText('×5')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '建造电弧熔炉' })).toBeDisabled();
    expect(onBuildRecipe).not.toHaveBeenCalled();
  });
  it('shows a search empty state without retaining a stale construction action', async () => {
    const user = userEvent.setup();
    render(<ProductionPlanner catalog={productionCatalog} playerId="player-1" completedTechs={['smelting']} onFocusBuilding={vi.fn()} onBuildRecipe={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '搜索生产配方' }), '不存在的配方');
    expect(screen.getByText('没有匹配的配方。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '建造电弧熔炉' })).not.toBeInTheDocument();
  });
});
