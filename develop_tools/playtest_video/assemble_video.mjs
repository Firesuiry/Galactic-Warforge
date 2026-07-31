// 试玩精华视频合成（支持多个 session 目录的素材混合）
// 读取 highlights.json（由 pick_highlights.mjs 生成，clips 带 session 字段），
// 从分段录像切 clip、烧录中文字幕、加片头片尾与 BGM，输出 mp4。
// 用法: node assemble_video.mjs <highlights.json> [--out output.mp4]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hlFile = process.argv[2];
if (!hlFile) throw new Error('用法: node assemble_video.mjs <highlights.json> [--out x.mp4]');
const outIdx = process.argv.indexOf('--out');
const highlights = JSON.parse(fs.readFileSync(hlFile, 'utf8'));
const OUT_FILE = outIdx > 0 ? process.argv[outIdx + 1]
  : `${path.dirname(hlFile)}/siliconworld-intro.mp4`;
const BGM = 'docs/remotion/public/audio/bgm/ambient-bed.mp3';
const FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc';
const WORK = `${path.dirname(hlFile)}/assemble`;
fs.mkdirSync(WORK, { recursive: true });

// ---------- 按 session 目录缓存分段边界 ----------
const segBoundsCache = {};
function segBoundsOf(sessionDir) {
  if (segBoundsCache[sessionDir]) return segBoundsCache[sessionDir];
  const events = fs.readFileSync(`${sessionDir}/events.jsonl`, 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const bounds = {};
  for (const e of events) {
    if (e.kind !== 'segment') continue;
    const m = e.label.match(/分段 (\d+)/);
    if (!m) continue;
    const idx = m[1];
    bounds[idx] = bounds[idx] ?? {};
    if (e.label.includes('开始')) bounds[idx].start = e.t;
    if (e.label.includes('结束')) bounds[idx].end = e.t;
  }
  segBoundsCache[sessionDir] = bounds;
  return bounds;
}

function ffprobeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file]).toString().trim();
  let dur = Number(out);
  if (!Number.isFinite(dur) || dur <= 0) {
    // playwright 录的 webm 常缺 duration：重封装一次再测
    const fixed = file.replace(/\.webm$/, '.probe.mkv');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-c', 'copy', fixed]);
    const out2 = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', fixed]).toString().trim();
    dur = Number(out2);
    fs.rmSync(fixed, { force: true });
  }
  return dur;
}

// ---------- 片头/片尾卡片 ----------
function makeCard(file, lines, dur = 3.5) {
  const draws = lines.map((line, i) => {
    const size = i === 0 ? 64 : 34;
    const y = i === 0 ? '(h-text_h)/2-40' : `(h-text_h)/2+${50 + (i - 1) * 52}`;
    return `drawtext=fontfile='${FONT}':text='${line}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
  }).join(',');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x0a0f1e:s=1600x900:r=30',
    '-t', String(dur), '-vf', draws, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', file]);
}

// ---------- 切 clip + 烧字幕 ----------
function cutClip(segFile, offset, dur, caption, outFile) {
  const safeCaption = caption.replace(/'/g, '').replace(/:/g, '：').replace(/\\/g, '');
  const vf = `drawtext=fontfile='${FONT}':text='${safeCaption}':fontcolor=white:fontsize=30:` +
    `box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-72`;
  execFileSync('ffmpeg', ['-y', '-ss', offset.toFixed(2), '-i', segFile, '-t', dur.toFixed(2),
    '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-an', outFile]);
}

const clipFiles = [];

// 片头
const titleCard = `${WORK}/clip-000-title.mp4`;
makeCard(titleCard, highlights.title ?? ['SiliconWorld 硅基世界', '真实试玩实录']);
clipFiles.push(titleCard);

for (const [i, h] of (highlights.clips ?? []).entries()) {
  const sessionDir = h.session;
  const segKey = String(h.seg).padStart(2, '0');
  const segFile = `${sessionDir}/videos/seg-${segKey}.webm`;
  if (!fs.existsSync(segFile)) { console.log(`跳过（缺分段文件）: ${h.caption}`); continue; }
  const bounds = segBoundsOf(sessionDir)[String(h.seg)];
  const segDur = ffprobeDuration(segFile);
  // 事件时间 → 分段内偏移；钳制在有效范围内
  let offset = h.t - (bounds?.start ?? 0) + (h.offset ?? 0);
  const dur = h.dur ?? 12;
  offset = Math.max(0.3, Math.min(offset, segDur - dur - 0.3));
  if (offset + dur > segDur) { console.log(`跳过（越界）: ${h.caption} seg=${h.seg} off=${offset}`); continue; }
  const clipFile = `${WORK}/clip-${String(i + 1).padStart(3, '0')}.mp4`;
  console.log(`cut ${path.basename(sessionDir)}/seg${segKey} @${offset.toFixed(1)}s +${dur}s  ${h.caption}`);
  cutClip(segFile, offset, dur, h.caption, clipFile);
  clipFiles.push(clipFile);
}

// 片尾
const endCard = `${WORK}/clip-999-end.mp4`;
makeCard(endCard, highlights.end ?? ['硅基世界', '命令下达，世界运转'], 3);
clipFiles.push(endCard);

// ---------- 拼接 ----------
const listFile = `${WORK}/concat.txt`;
fs.writeFileSync(listFile, clipFiles.map((f) => `file '${path.resolve(f)}'`).join('\n'));
const silentMp4 = `${WORK}/silent.mp4`;
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silentMp4]);

// ---------- 加 BGM + 淡入淡出 ----------
const totalDur = ffprobeDuration(silentMp4);
execFileSync('ffmpeg', ['-y', '-i', silentMp4, '-stream_loop', '-1', '-i', BGM,
  '-filter_complex',
  `[1:a]volume=0.22,afade=t=in:st=0:d=2,afade=t=out:st=${(totalDur - 3).toFixed(1)}:d=3[a];` +
  `[0:v]fade=t=in:st=0:d=1.2,fade=t=out:st=${(totalDur - 1.5).toFixed(1)}:d=1.5[v]`,
  '-map', '[v]', '-map', '[a]', '-t', totalDur.toFixed(2),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', OUT_FILE]);

console.log(`完成: ${OUT_FILE} (${totalDur.toFixed(0)}s, ${clipFiles.length} 段)`);
