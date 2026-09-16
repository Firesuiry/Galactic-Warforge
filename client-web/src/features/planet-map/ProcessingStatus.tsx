import type { Building } from '@shared/types';

const directions = { north: '北', east: '东', south: '南', west: '西' };
const states = { idle: '等待氢输入', running: '正在分馏', blocked: '出口堵塞', no_power: '供电不足', paused: '已停止', error: '运行异常' };

export function ProcessingStatus({ building }: { building: Building }) {
  const coater = building.spray_coater;
  if (coater) {
    const labels = { ...states, idle: '等待物料', running: '正在喷涂', no_proliferator: '无增产剂 · 物料直通' };
    const sum = (items: typeof coater.input_buffer) => (items ?? []).reduce((total, stack) => total + stack.quantity, 0);
    return <section className="planet-side-section" aria-label="喷涂运行状态">
      <div className="section-title">物料喷涂</div>
      <dl className="planet-kv-list">
        <div><dt>运行情况</dt><dd>{labels[coater.state] ?? coater.state}</dd></div>
        <div><dt>待处理 / 待输出</dt><dd>{sum(coater.input_buffer)} / {sum(coater.output_buffer)}</dd></div>
        <div><dt>累计喷涂物料</dt><dd>{coater.coated_items}</dd></div>
        <div><dt>已消耗增产剂</dt><dd>{coater.consumed_proliferator}</dd></div>
        <div><dt>当前剂量可喷余量</dt><dd>{coater.spray_units}{coater.spray_effect ? ` · ${coater.spray_effect.level} 级` : ''}</dd></div>
        <div><dt>入口与出口</dt><dd>{directions[coater.input_direction]}进物料 · {directions[coater.output_direction]}出物料 · {directions[coater.reagent_direction]}进增产剂</dd></div>
      </dl>
      <p className="muted">可从背包装入增产剂。没有增产剂时物料正常通过；已有有效喷涂的物料不会重复耗剂。</p>
    </section>;
  }
  const state = building.fractionation;
  if (!state) return null;
  const input = (state.input_buffer ?? []).reduce((sum, stack) => sum + stack.quantity, 0);
  const hydrogen = (state.hydrogen_buffer ?? []).reduce((sum, stack) => sum + stack.quantity, 0);
  return <section className="planet-side-section" aria-label="分馏运行状态">
    <div className="section-title">氢循环分馏</div>
    <dl className="planet-kv-list">
      <div><dt>运行情况</dt><dd>{states[state.state] ?? state.state}</dd></div>
      <div><dt>待处理氢</dt><dd>{input} / {state.buffer_capacity}</dd></div>
      <div><dt>待回流氢</dt><dd>{hydrogen} / {state.buffer_capacity}</dd></div>
      <div><dt>待输出重氢</dt><dd>{state.deuterium_buffer} / {state.buffer_capacity}</dd></div>
      <div><dt>累计处理</dt><dd>{state.attempts}</dd></div>
      <div><dt>累计转化</dt><dd>{state.converted}</dd></div>
      <div><dt>累计返回氢</dt><dd>{state.returned_hydrogen}</dd></div>
      <div><dt>最近转化概率</dt><dd>{(state.last_probability * 100).toFixed(2)}%{state.last_spray_level > 0 ? ` · 喷涂 ${state.last_spray_level} 级` : ''}</dd></div>
      <div><dt>入口与出口</dt><dd>{directions[state.input_direction]}进氢 · {directions[state.hydrogen_direction]}出氢 · {directions[state.deuterium_direction]}出重氢</dd></div>
    </dl>
    <p className="muted">基础转化概率为 1%。未转化的氢从回流口返回；用外部传送带接回入口可再次分馏。任一出口满载时暂停。</p>
  </section>;
}
