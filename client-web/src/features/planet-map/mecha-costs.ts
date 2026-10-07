/**
 * 机甲手动采集/手搓的耗能规则（与服务端 gamecore/mecha_jobs.go 一致；服务端未下发这组常量）。
 * 采集每件 10 tick、3 核心能量；手搓每批 = 配方时长 / 20（下限 1）。
 */
export const MECHA_MINE_TICKS_PER_ITEM = 10;
export const MECHA_MINE_ENERGY_PER_ITEM = 3;

export function mechaCraftEnergyPerBatch(recipeDuration: number) {
  return Math.max(1, Math.floor(recipeDuration / 20));
}
