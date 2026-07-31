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
const WANT = [
  { s: 0, match: { kind: 'action', re: /登录/ }, pre: -4, dur: 10, caption: '建立指挥链路' },
  { s: 0, match: { kind: 'visit', re: /银河星图/ }, pre: -2, dur: 12, caption: '浩瀚银河，等待探索' },
  { s: 0, match: { kind: 'milestone', re: /进入出生行星/ }, pre: -3, dur: 12, caption: '降落出生行星：只有一座分析基站' },
  { s: 0, match: { kind: 'action', re: /扫描银河/ }, pre: -2, dur: 8, caption: '扫描银河，点亮星图' },
  { s: 0, match: { kind: 'action', re: /建造 wind_turbine.*成功/ }, pre: -8, dur: 14, caption: '第一座风力涡轮机' },
  { s: 0, match: { kind: 'action', re: /建造 matrix_lab.*成功/ }, pre: -8, dur: 14, caption: '矩阵研究站落成' },
  { s: 0, match: { kind: 'milestone', re: /研究站通电运行/ }, pre: -4, dur: 8, caption: '电网接通，研究站上线' },
  { s: 0, match: { kind: 'action', re: /装料 electromagnetic_matrix/ }, pre: -4, dur: 10, caption: '为研究站装填电磁矩阵' },
  { s: 0, match: { kind: 'milestone', re: /电磁学研究完成/ }, pre: -5, dur: 10, caption: '电磁学突破：解锁矿机与电网' },
  { s: 0, match: { kind: 'action', re: /建造 tesla_tower.*成功/ }, pre: -8, dur: 12, caption: '特斯拉塔延伸电网' },
  { s: 0, match: { kind: 'action', re: /建造 mining_machine.*成功/ }, pre: -8, dur: 14, caption: '第一台采矿机压上矿脉' },
  { s: 0, match: { kind: 'milestone', re: /矿机开始产出/ }, pre: -4, dur: 10, caption: '资源开始自动增长' },
  { s: 0, match: { kind: 'milestone', re: /basic_logistics_system 研究完成/ }, pre: -5, dur: 8, caption: '基础物流系统解锁' },
  // 扩张篇：外迁与远征
  { s: 1, match: { kind: 'milestone', re: /锁定富矿带/ }, pre: -4, dur: 10, caption: '侦察到富矿带，决定外扩' },
  { s: 1, match: { kind: 'milestone', re: /执行体移动到 \(2,10\)/ }, pre: -6, dur: 12, caption: '执行体长途跋涉，挺进新区' },
  { s: 1, match: { kind: 'action', re: /建造 tesla_tower.*成功/ }, pre: -8, dur: 12, caption: '前哨竖起特斯拉塔' },
  { s: 1, match: { kind: 'milestone', re: /weapon_system 研究完成/ }, pre: -5, dur: 8, caption: '武器系统解锁' },
  // 终局篇：产线贯通与全线投产
  { s: 2, match: { kind: 'milestone', re: /矿产回升|矿产达到/ }, pre: -8, dur: 12, caption: '传送带贯通：矿机解封，矿产滚滚而来' },
  { s: 2, match: { kind: 'action', re: /建造 arc_smelter.*成功/ }, pre: -8, dur: 12, caption: '电弧熔炉点火' },
  { s: 3, match: { kind: 'milestone', re: /第二矿机投产/ }, pre: -8, dur: 12, caption: '第二矿机投建，产能翻倍' },
  { s: 4, match: { kind: 'action', re: /建造 gauss_turret.*成功/ }, pre: -8, dur: 12, caption: '高斯炮塔守卫基地' },
  { s: 3, match: { kind: 'action', re: /量产 worker/ }, pre: -3, dur: 10, caption: '量产工程单位' },
  { s: 3, match: { kind: 'action', re: /量产 soldier/ }, pre: -3, dur: 10, caption: '量产作战单位' },
  { s: 4, match: { kind: 'visit', re: /终幕·恒星系/ }, pre: -2, dur: 10, caption: '回望恒星系' },
  { s: 4, match: { kind: 'visit', re: /终幕·银河/ }, pre: -2, dur: 12, caption: '从一座基站，到一片工业前哨' },
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
