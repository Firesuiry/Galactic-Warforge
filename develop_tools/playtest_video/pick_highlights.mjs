// 从多个 session 的 events.jsonl 挑选高光时刻，生成 highlights.json
// 用法: node pick_highlights.mjs <session_dir1> [session_dir2 ...] [--out highlights.json]
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx > 0 ? argv[outIdx + 1] : null;
const dirs = argv.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);
const OUT_FILE = OUT ?? `${dirs[0]}/highlights.json`;

const sessions = dirs.map((dir) => {
  const events = fs.readFileSync(`${dir}/events.jsonl`, 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const segs = [];
  for (const e of events) {
    if (e.kind !== 'segment') continue;
    const m = e.label.match(/分段 (\d+)/);
    if (!m) continue;
    const idx = Number(m[1]);
    if (e.label.includes('开始')) segs[idx] = { start: e.t };
    if (e.label.includes('结束') && segs[idx]) segs[idx].end = e.t;
  }
  return { dir, events, segs };
});

// 规则：s = session 序号（按命令行参数顺序）；pre 为相对事件点提前秒数
// 新开局产业链（参考戴森球）：勘察→远征→矿机→熔炉→装配→矩阵→研究→物流→武器→终幕
const WANT = [
  { s: 0, match: { kind: 'action', re: /登录/ }, pre: -4, dur: 10, caption: '建立指挥链路' },
  { s: 0, match: { kind: 'visit', re: /银河星图/ }, pre: -2, dur: 12, caption: '浩瀚银河，等待探索' },
  { s: 0, match: { kind: 'milestone', re: /进入出生行星/ }, pre: -3, dur: 12, caption: '降落出生行星：只有一座分析基站' },
  { s: 0, match: { kind: 'action', re: /扫描银河/ }, pre: -2, dur: 8, caption: '扫描银河，点亮星图' },
  { s: 0, match: { kind: 'milestone', re: /勘察锁定铁矿带/ }, pre: -4, dur: 10, caption: '勘察全图，锁定铁铜矿带' },
  { s: 0, match: { kind: 'milestone', re: /执行体远征抵达铁矿带/ }, pre: -6, dur: 12, caption: '执行体远征，挺进矿区' },
  { s: 0, match: { kind: 'action', re: /建造 mining_machine.*成功/ }, pre: -8, dur: 14, caption: '第一台采矿机压上矿脉' },
  { s: 0, match: { kind: 'beat', re: /矿机采集特写/ }, pre: -2, dur: 10, caption: '矿机作业，矿石滚滚而出' },
  { s: 0, match: { kind: 'milestone', re: /磁铁×2产出/ }, pre: -8, dur: 12, caption: '电弧熔炉点火，磁铁出炉' },
  { s: 0, match: { kind: 'milestone', re: /执行体转进铜矿带/ }, pre: -4, dur: 8, caption: '转进铜矿带' },
  { s: 0, match: { kind: 'milestone', re: /铜块×2产出/ }, pre: -8, dur: 10, caption: '铜块冶炼上线' },
  { s: 0, match: { kind: 'action', re: /建造 assembling_machine_mk1.*成功/ }, pre: -8, dur: 12, caption: '装配枢纽落成' },
  { s: 0, match: { kind: 'milestone', re: /产业链传送带全线贯通/ }, pre: -10, dur: 14, caption: '传送带全线贯通，货流奔涌' },
  { s: 0, match: { kind: 'milestone', re: /磁线圈×2产出/ }, pre: -6, dur: 10, caption: '磁线圈下线' },
  { s: 0, match: { kind: 'milestone', re: /电路板×2产出/ }, pre: -6, dur: 8, caption: '电路板下线' },
  { s: 0, match: { kind: 'milestone', re: /电磁矩阵×1下线/ }, pre: -6, dur: 10, caption: '第一块电磁矩阵自产下线' },
  { s: 0, match: { kind: 'milestone', re: /电磁矩阵×5送入研究站/ }, pre: -4, dur: 10, caption: '矩阵装填，研究站就绪' },
  { s: 0, match: { kind: 'milestone', re: /electromagnetism 研究完成/ }, pre: -5, dur: 10, caption: '电磁学突破：首门科技解锁' },
  { s: 0, match: { kind: 'milestone', re: /basic_logistics_system 研究完成/ }, pre: -5, dur: 8, caption: '基础物流系统解锁' },
  { s: 0, match: { kind: 'action', re: /建造 depot_mk1.*成功/ }, pre: -8, dur: 10, caption: '储物仓落地，物流成网' },
  { s: 0, match: { kind: 'milestone', re: /automatic_metallurgy 研究完成/ }, pre: -5, dur: 8, caption: '自动化冶金解锁' },
  { s: 0, match: { kind: 'milestone', re: /weapon_system 研究完成/ }, pre: -5, dur: 8, caption: '武器系统解锁' },
  { s: 0, match: { kind: 'action', re: /建造 gauss_turret.*成功/ }, pre: -8, dur: 12, caption: '高斯炮塔守卫基地' },
  { s: 0, match: { kind: 'action', re: /量产 worker/ }, pre: -3, dur: 10, caption: '量产工程单位' },
  { s: 0, match: { kind: 'action', re: /量产 soldier/ }, pre: -3, dur: 10, caption: '量产作战单位' },
  { s: 0, match: { kind: 'milestone', re: /锁定富矿带/ }, pre: -4, dur: 10, caption: '侦察富矿带，谋划外扩' },
  { s: 0, match: { kind: 'visit', re: /终幕·恒星系/ }, pre: -2, dur: 10, caption: '回望恒星系' },
  { s: 0, match: { kind: 'visit', re: /终幕·银河/ }, pre: -2, dur: 12, caption: '从一座基站，到一片工业前哨' },
];

const clips = [];
for (const w of WANT) {
  const session = sessions[w.s];
  if (!session) { console.log(`跳过（无 session ${w.s}）: ${w.caption}`); continue; }
  const e = session.events.find((ev) => ev.kind === w.match.kind && w.match.re.test(ev.label));
  if (!e) { console.log('未找到镜头:', w.caption); continue; }
  const segIdx = session.segs.findIndex((s) => s && e.t >= s.start && e.t <= (s.end ?? Infinity));
  if (segIdx < 0) { console.log('事件不在任何分段内:', w.caption, e.t); continue; }
  clips.push({ session: session.dir, seg: segIdx, t: e.t + (w.pre ?? 0), dur: w.dur, caption: w.caption });
}

const out = {
  title: ['SiliconWorld 硅基世界', '真实试玩实录 · 从荒星基站到工业前哨'],
  end: ['硅基世界', '命令下达，世界运转'],
  clips,
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
console.log(`已生成 ${OUT_FILE}: ${clips.length} 个镜头`);
