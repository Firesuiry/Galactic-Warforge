// 试玩介绍视频配音脚本
// 1) 按 narration.json 逐段调用 TTS（MiniMax 协议，sync t2a_v2），音频缓存到 dub/ 目录
// 2) 按 assemble/ 下 clip-*.mp4 的实际时长累积出每段的绝对起始时间
// 3) 用 ffmpeg 把旁白按时间轴叠到 silent.mp4 上，混入压低音量的 BGM，输出最终 mp4
//
// 用法:
//   TTS_TOKEN=sk-xxx node dub_video.mjs narration.json \
//     [--work .run/video-playtest] [--out 输出.mp4] [--skip-tts]
//
// TTS_TOKEN 从环境变量读取，不要写进仓库。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TTS_URL = 'https://api.cursorai.art/minimax/v1/t2a_v2';
const TOKEN = process.env.TTS_TOKEN;
const BGM = 'docs/remotion/public/audio/bgm/ambient-bed.mp3';

const narrFile = process.argv[2];
if (!narrFile) throw new Error('用法: TTS_TOKEN=xxx node dub_video.mjs <narration.json> [--work dir] [--out x.mp4] [--skip-tts]');
function argVal(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
}
const WORK = argVal('--work', '.run/video-playtest');
const OUT_FILE = argVal('--out', `${WORK}/siliconworld-试玩介绍-配音版.mp4`);
const SKIP_TTS = process.argv.includes('--skip-tts');
const DUB_DIR = `${WORK}/dub`;
fs.mkdirSync(DUB_DIR, { recursive: true });

const narration = JSON.parse(fs.readFileSync(narrFile, 'utf8'));
const ASSEMBLE = `${WORK}/assemble`;
const SILENT = `${ASSEMBLE}/silent.mp4`;

function ffprobeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file]).toString().trim();
  const d = Number(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`无法读取时长: ${file}`);
  return d;
}

// ---------- 1. 配对镜头文件与文案，计算时间轴 ----------
const clipFiles = fs.readdirSync(ASSEMBLE)
  .filter((f) => /^clip-\d+.*\.mp4$/.test(f)).sort()
  .map((f) => `${ASSEMBLE}/${f}`);
if (clipFiles.length !== narration.segments.length) {
  throw new Error(`镜头数(${clipFiles.length})与配音段数(${narration.segments.length})不一致`);
}
let cursor = 0;
const timeline = clipFiles.map((file, i) => {
  const dur = ffprobeDuration(file);
  const seg = { idx: i, file, start: cursor, dur, text: narration.segments[i].text };
  cursor += dur;
  return seg;
});
const totalDur = cursor;
console.log(`共 ${timeline.length} 段，总时长 ${totalDur.toFixed(1)}s`);

// ---------- 2. TTS 合成（带缓存与重试） ----------
async function tts(text, outFile) {
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) return 'cache';
  if (!TOKEN) throw new Error('缺少 TTS_TOKEN 环境变量');
  const body = {
    model: 'speech-2.8-hd',
    text,
    stream: false,
    voice_setting: { voice_id: narration.voice_id, speed: narration.speed ?? 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
  };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      const data = await resp.json();
      if (data?.base_resp?.status_code !== 0 || !data?.data?.audio) {
        throw new Error(`TTS 返回错误: ${JSON.stringify(data?.base_resp ?? data).slice(0, 300)}`);
      }
      fs.writeFileSync(outFile, Buffer.from(data.data.audio, 'hex'));
      return 'ok';
    } catch (e) {
      lastErr = e;
      console.log(`  重试 ${attempt}/3: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

if (!SKIP_TTS) {
  for (const seg of timeline) {
    const outFile = `${DUB_DIR}/seg-${String(seg.idx).padStart(2, '0')}.mp3`;
    const how = await tts(seg.text, outFile);
    console.log(`tts[${seg.idx}] ${how} ${ffprobeDuration(outFile).toFixed(1)}s/${seg.dur.toFixed(1)}s  ${seg.text}`);
  }
}

// ---------- 3. 混音：旁白按时间轴对齐 + BGM 垫底 ----------
// 旁白超长时先用 atempo 微压；起始时间留 0.25s 呼吸感
const inputs = ['-i', SILENT, '-i', BGM];
let inputCount = 2; // 0=silent.mp4, 1=BGM
const filters = [];
const mixLabels = [];
timeline.forEach((seg, i) => {
  const audio = `${DUB_DIR}/seg-${String(seg.idx).padStart(2, '0')}.mp3`;
  if (!fs.existsSync(audio)) { console.log(`跳过（无音频）: seg ${seg.idx}`); return; }
  const inIdx = inputCount++;
  inputs.push('-i', audio);
  const aDur = ffprobeDuration(audio);
  const budget = seg.dur - 0.3;
  // highpass 去掉 TTS 可能带的低频隆隆声，对人声无影响
  let chain = `[${inIdx}:a]highpass=f=80,`;
  if (aDur > budget) {
    const ratio = Math.min(aDur / budget, 1.8);
    chain += `atempo=${ratio.toFixed(3)},`;
    console.log(`  seg${seg.idx} 旁白 ${aDur.toFixed(1)}s 超出预算 ${budget.toFixed(1)}s，atempo=${ratio.toFixed(2)}`);
  }
  const delayMs = Math.round((seg.start + 0.25) * 1000);
  chain += `adelay=${delayMs}|${delayMs}[n${i}]`;
  filters.push(chain);
  mixLabels.push(`[n${i}]`);
});
// BGM 是 60~600Hz 低频 drone：0.10 音量下安静段底噪达 -52dB RMS，听感像电流声。
// 处理：aloop 采样级无缝循环（替代 -stream_loop，消除每 51.7s 的解码接缝凹陷），
// highpass 去次声/DC，音量压到 0.04（安静段底噪降到约 -61dB RMS，垫而不噪），保留淡入淡出。
filters.push(`[1:a]aloop=loop=-1:size=3000000,highpass=f=45,volume=0.04,afade=t=in:st=0:d=2,afade=t=out:st=${(totalDur - 3).toFixed(1)}:d=3[bgm]`);
mixLabels.push('[bgm]');
filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
// 视频淡入淡出（与原版一致）
filters.push(`[0:v]fade=t=in:st=0:d=1.2,fade=t=out:st=${(totalDur - 1.5).toFixed(1)}:d=1.5[vout]`);

execFileSync('ffmpeg', ['-y', ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', '[vout]', '-map', '[aout]', '-t', totalDur.toFixed(2),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT_FILE], { stdio: 'inherit' });

console.log(`完成: ${OUT_FILE} (${ffprobeDuration(OUT_FILE).toFixed(0)}s)`);
