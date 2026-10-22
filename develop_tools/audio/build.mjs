#!/usr/bin/env node
/**
 * 音频入库转码（第 23 轮 3A 音频分支）。
 *
 * 源文件不入库：先 `--download` 把 sources.json 里的 zip / 单曲下载并解包到 --source-dir，
 * 再按 outputs 表转码到 client-web/public/assets/audio/，同时生成：
 * - audio-manifest.ts：引擎运行时读的音效 → 变体路径表（懒加载用）；
 * - THIRD_PARTY.md：素材清单（文件 / 来源 URL / 作者 / 许可 / 时长 / 响度实测）；
 * - 终端打印总体积与每个成品的响度实测（验收口径：目标 ±2 LU、总量 ≤ 20 MB）。
 *
 * 响度口径：
 * - SFX −16 LUFS、UI −20 LUFS、声床 −24 LUFS、音乐 −20 LUFS（integrated，EBU R128）；
 * - 短促音（< 3s）先把素材**首尾接成 ≥ 20s 的循环**再做 loudnorm，否则 gated
 *   integrated loudness 在几十毫秒的素材上测不出来（实测直接报 −70 LUFS）；
 * - SFX 另加限幅，峰值不超过 −3 dBFS（短促音的 loudnorm 后峰值可能仍在 −2 上下）。
 *
 * 循环素材（ambient / music）：取中段窗口 → 首尾 1.5s 交叉淡化 → 落成整段循环。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'client-web/public/assets/audio');
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8'));

const SOURCE_DIR = argValue('--source-dir') ?? '/tmp/sw-audio-src';
const ONLY = argValue('--only');
const DOWNLOAD = process.argv.includes('--download');

/** 每条总线的响度目标（LUFS）与是否限幅。 */
const BUS_TARGET = {
  sfx: { lufs: -16, limit: -3 },
  ui: { lufs: -20, limit: -3 },
  ambient: { lufs: -24, limit: -1 },
  music: { lufs: -20, limit: -1 },
};

/** 短于该时长的素材走「首尾接环」测响度。 */
const SHORT_CLIP_SECONDS = 3;
/** 接环总时长（秒）：≥ 20s 才能过 ebur128 的 gated 窗口；再长也不会更准，只更慢。 */
const LOOP_MEASURE_SECONDS = 20;
/** 循环素材取用的段落长度（秒）：声床 30s、音乐 60s，足够长且体积可控。 */
const LOOP_WINDOW = { ambient: 30, music: 60 };
/** 循环素材首尾交叉淡化（秒）。 */
const LOOP_CROSSFADE = 1.5;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

function ffmpeg(args) {
  run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function probeDuration(file) {
  const out = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim());
}

function parseLoudness(text) {
  // 逐帧进度行也带 I:，取最后一条（Summary 块）；峰值取 astats 的样本峰值。
  const integrated = [...text.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const peak = [...text.matchAll(/Peak level dB:\s+(-?[\d.]+)/g)].at(-1);
  return {
    lufs: integrated ? Number(integrated[1]) : NaN,
    peak: peak ? Number(peak[1]) : NaN,
  };
}

/**
 * 集成响度 + 真峰值（dBFS），可带前置滤镜（trim / volume / limiter 等）。
 *
 * 短素材先接成 ≥ 20s 的循环再测（ebur128 的 gated 窗口在 < 3s 素材上直接报 −70 LUFS）。
 * 顺序很关键：**先 aloop 再前置滤镜**——aloop 只接受原始采样，带 volume 时高增益会削顶，
 * 测出来的电平比真实低 2–5 LU（实测）。trim 走输入级 -ss/-t（见 convert），不在这里。
 */
function measureLoudness(input, preFilters = [], trim) {
  const duration = trim ? trim[1] - trim[0] : probeDuration(input);
  // 只有「短素材」才接环测（成品本身也是一段短音，循环听感就是稳态）。
  // 长素材（声床 / 音乐）直接量：接环会改变它们的统计分布，反而失真。
  const loops = duration < SHORT_CLIP_SECONDS ? Math.max(1, Math.ceil(LOOP_MEASURE_SECONDS / Math.max(duration, 0.02))) : 0;
  const chain = [];
  if (loops > 0) chain.push(`aloop=loop=${loops}:size=2000000000`);
  // 峰值按「样本峰值」读：真峰值（TPK）会把 Opus 解码振铃也算进来，比限幅器目标高 1–3 dB。
  chain.push(...preFilters, 'ebur128', 'astats=measure_perchannel=none:measure_overall=Peak_level');
  const inputArgs = trim ? ['-ss', String(trim[0]), '-t', String(trim[1] - trim[0])] : [];
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...inputArgs, '-i', input, '-af', chain.join(','), '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg 响度测量失败 ${input}: ${result.stderr}`);
  }
  return parseLoudness(result.stderr);
}

/** 循环素材的基线响度：对拼接好的循环段（4 路输入 + LOOP_FILTER）量一次。 */
function measureLoopLoudness(loopInputs) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-nostdin', ...loopInputs,
    '-filter_complex', `${LOOP_FILTER};[loop]ebur128,astats=measure_perchannel=none:measure_overall=Peak_level`,
    '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg 循环响度测量失败: ${result.stderr}`);
  }
  return parseLoudness(result.stderr);
}

// ---------- 下载 ----------

function download() {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  for (const [name, pack] of Object.entries(SPEC.packs)) {
    const target = path.join(SOURCE_DIR, name);
    if (fs.existsSync(target)) {
      console.log(`[audio] 已存在 ${name}`);
      continue;
    }
    const file = path.join(SOURCE_DIR, path.basename(new URL(pack.url).pathname));
    console.log(`[audio] 下载 ${pack.url}`);
    run('curl', ['-sL', '--fail', '-o', file, pack.url]);
    if (file.endsWith('.zip')) {
      fs.mkdirSync(target, { recursive: true });
      run('unzip', ['-oq', file, '-d', target]);
    } else {
      // 单曲：源清单里以目录名当「解包后的目录」，文件直接放进去，sources.json 里用 <pack>/<文件>。
      fs.mkdirSync(target, { recursive: true });
      fs.renameSync(file, path.join(target, path.basename(file)));
    }
  }
}

// ---------- 转码 ----------

function resolveSource(spec) {
  if (SPEC.packs[spec]) {
    // 单曲包：取目录里唯一一个音频文件。
    const dir = path.join(SOURCE_DIR, spec);
    const file = fs.readdirSync(dir).find((name) => /\.(ogg|mp3|wav|flac)$/i.test(name));
    if (!file) throw new Error(`源目录 ${spec} 里没有音频文件`);
    return path.join(dir, file);
  }
  return path.join(SOURCE_DIR, spec);
}

/**
 * 循环素材：取中段窗口 → 首尾 1.5s 交叉淡化，落成一段可无缝循环的成品。
 *
 * 做法（one-pass，全部用 -ss/-t 的输入级裁剪，比 filter 里链 atrim 稳）：
 *   L = 窗口长度；xf = 交叉淡化时长
 *   中间段 M = 素材 [start+xf, start+L-xf)，长度 L-2xf（成品开头，也对应循环点的落点）；
 *   头段 H = 素材 [start, start+xf)（交叉淡化时淡入）；
 *   尾段 T = 素材 [start+L-xf, start+L)（交叉淡化时淡出）。
 *   成品 = M + acrossfade(T, H)，总长 (L-2xf) + xf = L-xf：
 *   末尾（H 的末端 = 素材 start+xf）正好接回开头（M 的起点 = 素材 start+xf）。
 *   顺序必须是「中间段在前、交叉淡化段在后」；反过来（交叉淡化在前）每轮会把最后
 *   xf 秒再放一遍，且循环点相位不连续（审查 M3）。
 * 实现用 4 路输入：窗口段（量响度用）/ 窗口头 xf / 窗口尾 xf / 窗口中间段。
 */
function loopArgs(input, windowSeconds) {
  const duration = probeDuration(input);
  const length = Math.min(windowSeconds, duration);
  const start = Math.max(0, (duration - length) / 2);
  const rest = Math.max(0.1, length - 2 * LOOP_CROSSFADE);
  const tailStart = start + rest;
  return [
    '-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', input,
    '-ss', start.toFixed(3), '-t', LOOP_CROSSFADE.toFixed(3), '-i', input,
    '-ss', tailStart.toFixed(3), '-t', LOOP_CROSSFADE.toFixed(3), '-i', input,
    '-ss', (start + LOOP_CROSSFADE).toFixed(3), '-t', rest.toFixed(3), '-i', input,
  ];
}

const LOOP_FILTER =
  `[2:a][1:a]acrossfade=d=${LOOP_CROSSFADE}:c1=tri:c2=tri[mix];` +
  '[3:a][mix]concat=n=2:v=0:a=1[loop]';

/**
 * 循环素材先整段解码成 48 kHz 立体声 WAV 再切：输入级 -ss 对 Vorbis/Opus 会吸附到包
 * 边界（实测 45.020 处切出的尾段只有 1.4899s，且起点样本对不上），交叉淡化段不完整、
 * 循环点相位漂移。WAV 上 -ss/-t 是样本精确的。
 */
function decodeToWav(input, tempDir) {
  const out = path.join(tempDir, `${path.basename(input)}.wav`);
  ffmpeg(['-i', input, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', out]);
  return out;
}

function convert(spec) {
  const outFile = path.join(OUT_DIR, spec.out);
  const input = resolveSource(spec.source);
  const bus = BUS_TARGET[spec.bus];
  const isLoop = spec.bus === 'ambient' || spec.bus === 'music';

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  if (isLoop) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-audio-loop-'));
    const looped = loopArgs(decodeToWav(input, tempDir), LOOP_WINDOW[spec.bus] ?? 30);
    const encodeLoop = (gainDb, limiterDb) => {
      ffmpeg([
        ...looped,
        '-filter_complex',
        // alimiter 默认有 5ms 前瞻延迟，会在循环点注入一段静音（成品首样本≈0，
        // 循环回跳就是一次爆音）；latency=1 让限幅器补偿这段延迟，接缝才连续。
        `${LOOP_FILTER};[loop]volume=${gainDb.toFixed(2)}dB,alimiter=limit=${(10 ** (limiterDb / 20)).toFixed(4)}:level=false:latency=1[out]`,
        '-map', '[out]', '-ar', '48000', '-ac', '2',
        '-c:a', 'libopus', '-b:a', '112k', outFile,
      ]);
    };
    // 循环素材：先按原样量响度，再对成品迭代（与 SFX 同一套：响度误差修正增益、峰值超了压限幅）。
    const base = measureLoopLoudness(looped);
    let gain = bus.lufs - base.lufs;
    let limiterDb = bus.limit;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      encodeLoop(gain, limiterDb);
      const result = measureLoudness(outFile);
      const loudnessError = bus.lufs - result.lufs;
      const peakOver = result.peak - bus.limit;
      if (process.env.AUDIO_DEBUG) {
        console.error(`[debug] ${spec.out} iter${attempt} gain=${gain.toFixed(2)} lim=${limiterDb.toFixed(2)} -> I=${result.lufs} peak=${result.peak}`);
      }
      if (Math.abs(loudnessError) <= 0.5 && peakOver <= 0.1) break;
      gain += loudnessError;
      if (peakOver > 0.1) limiterDb -= peakOver + 0.3;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    return outFile;
  }

  // trim 用输入级 -ss/-t：filter 里的 atrim 会把起点之前的时间戳一并送进下游，
  // alimiter / aloop 在带空洞的时间轴上行为不稳（实测短音接环后电平差 3–5 LU）。
  const filters = [];
  const inputs = ['-i', input];
  if (spec.trim) inputs.unshift('-ss', String(spec.trim[0]), '-t', String(spec.trim[1] - spec.trim[0]));
  // 去首尾静音：很多素材带 0.3–0.5s 的静音头，接环量测会把静音算进积分（响度被拉低 5–10 LU），
  // 游戏里每次播放还多等半秒。阈值 −50 dB、各留 10ms 防切掉起音。
  filters.push(
    'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01',
    'areverse',
  );
  const head = [];

  // 响度归一 + 峰值限制：直接对**成品文件**迭代（编码 → 量成品 → 修正），
  // 因为量测链上的 aloop/volume/alimiter 和最终 Opus 编码后的电平并不完全一致：
  // - 短促音（< 3s）单次 ebur128 报 −70 LUFS，量成品时由 measureLoudness 自动接环；
  // - Opus 编码后解码振铃会把样本峰值再抬 1–3 dB（实测），所以峰值要对成品复核，
  //   超了就把限幅阈值再压同样的量；
  // - 响度误差按「目标 − 成品实测」直接修正增益，限幅器削峰造成的响度损失会在下一轮被补回。
  // 不用 loudnorm：它的 dynamic 模式在短促音上会把电平压到目标以下 2–8 LU。
  // 成品时长（trim 之后）：码率档位按它选。
  const duration = probeDuration(input) - (spec.trim ? spec.trim[1] - spec.trim[0] : 0);
  const encode = (gainDb, limiterDb) => {
    ffmpeg([
      ...inputs,
      '-af', [...filters, `volume=${gainDb.toFixed(2)}dB`, `alimiter=limit=${(10 ** (limiterDb / 20)).toFixed(4)}:level=false`].join(','),
      // 单声道 SFX 64–96 kbps（契约 §2）。Opus 短音的实测码率由「目标码率 + 最小帧
      // 填充」共同决定（0.05s 素材在 56k 目标下仍报 132k），所以按成品时长分档：
      // 极短音（<0.1s）填充占比最高、0.1–0.3s 会略低于目标，其余按 constrained VBR：
      // 成品实测 56–101 kbps（0.05–0.15s 的极短音两端各差 2–8k，见构建日志）。
      '-ar', '48000', '-ac', '1', '-c:a', 'libopus',
      ...(spec.bus === 'ui'
        ? ['-b:a', '48k', '-vbr', 'constrained']
        : duration < 0.1 ? ['-b:a', '48k', '-vbr', 'off']
          : duration < 0.3 ? ['-b:a', '64k', '-vbr', 'off']
            : ['-b:a', '72k', '-vbr', 'constrained']),
      outFile,
    ]);
  };
  let gain = bus.lufs - measureLoudness(input, filters, spec.trim).lufs;
  let limiterDb = bus.limit;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    encode(gain, limiterDb);
    const result = measureLoudness(outFile);
    const loudnessError = bus.lufs - result.lufs;
    const peakOver = result.peak - bus.limit;
    if (process.env.AUDIO_DEBUG) {
      console.error(`[debug] ${spec.out} iter${attempt} gain=${gain.toFixed(2)} lim=${limiterDb.toFixed(2)} -> I=${result.lufs} peak=${result.peak} err=${loudnessError.toFixed(2)} over=${peakOver.toFixed(2)}`);
    }
    if (Math.abs(loudnessError) <= 0.5 && peakOver <= 0.1) break;
    // 超调系数 1.3：限幅器削峰会把响度增量吃掉一部分，等量修正收敛太慢（实测 ~0.3 LU/轮）。
    gain += Math.sign(loudnessError) * Math.max(0.5, Math.abs(loudnessError) * 1.3);
    if (peakOver > 0.1) limiterDb -= peakOver + 0.3;
  }
  return outFile;
}

/**
 * 循环接缝实测（审查 M3 判据）：解码成品为 f32le，比较
 * - 接缝跳变 seam = |末样本 − 首样本|；
 * - 全文件相邻样本差 |x[n+1] − x[n]| 的 p99.99 与最大值。
 * 无缝循环要求接缝跳变不超过相邻样本差最大值的 2 倍（听感上等同一次普通采样跳变）。
 */
function measureLoopSeam(file) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-',
  ], { maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`接缝测量失败 ${file}: ${result.stderr}`);
  const samples = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.length / 4);
  const diffs = new Float32Array(samples.length - 1);
  let maxDiff = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const diff = Math.abs(samples[i] - samples[i - 1]);
    diffs[i - 1] = diff;
    if (diff > maxDiff) maxDiff = diff;
  }
  const sorted = diffs.slice().sort();
  const p9999 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9999))] ?? 0;
  const seam = Math.abs(samples[samples.length - 1] - samples[0]);
  return { seam, maxDiff, p9999, samples: samples.length };
}

// ---------- 主流程 ----------

function main() {
  if (DOWNLOAD) download();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = { sfx: {}, ui: {}, ambient: {}, music: {} };
  const rows = [];
  let totalBytes = 0;

  for (const spec of SPEC.outputs) {
    if (ONLY && !spec.out.includes(ONLY)) continue;
    const variants = [spec.source, ...(spec.variants ?? [])];
    variants.forEach((source, index) => {
      const out = index === 0
        ? spec.out
        : spec.out.replace(/\.ogg$/, `-${index + 1}.ogg`);
      const outFile = convert({ ...spec, source, out, variants: undefined, trim: index === 0 ? spec.trim : undefined });
      const duration = probeDuration(outFile);
      const loudness = measureLoudness(outFile);
      const bytes = fs.statSync(outFile).size;
      totalBytes += bytes;
      const key = path.basename(spec.out, '.ogg');
      (manifest[spec.bus][key] ??= []).push(`/assets/audio/${path.relative(OUT_DIR, outFile)}`);
      rows.push({
        file: path.relative(ROOT, outFile),
        source,
        pack: source.split('/')[0],
        duration,
        lufs: loudness.lufs,
        peak: loudness.peak,
        bytes,
        target: BUS_TARGET[spec.bus].lufs,
        bus: spec.bus,
      });
      console.log(`[audio] ${path.relative(ROOT, outFile)} ${duration.toFixed(2)}s ${loudness.lufs.toFixed(1)} LUFS peak ${loudness.peak.toFixed(1)} dBFS ${(bytes / 1024).toFixed(0)} KB`);
      if (spec.bus === 'ambient' || spec.bus === 'music') {
        const seam = measureLoopSeam(outFile);
        const limit = seam.maxDiff * 2;
        console.log(`[loop] ${path.relative(OUT_DIR, outFile)} 接缝跳变 ${seam.seam.toFixed(4)} / 相邻差 max ${seam.maxDiff.toFixed(4)} p99.99 ${seam.p9999.toFixed(4)} → ${seam.seam <= limit ? 'OK' : 'FAIL'}`);
        if (seam.seam > limit) process.exitCode = 1;
      }
    });
  }

  // 引擎侧清单：直接生成可 import 的 TS 模块（public/ 下的文件不应被 JS import，
  // 打进 bundle 的是这一份；public 里只放成品音频与许可说明）。
  const manifestPath = path.join(ROOT, 'client-web/src/engine/audio-manifest.ts');
  fs.writeFileSync(manifestPath, `// 由 develop_tools/audio/build.mjs 生成，不要手改。\n` +
    `export const AUDIO_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\n`);
  writeThirdParty(rows);
  console.log(`\n[audio] 总体积 ${(totalBytes / 1024 / 1024).toFixed(2)} MB（预算 20 MB）`);
  const offTarget = rows.filter((row) => Math.abs(row.lufs - row.target) > 2);
  if (offTarget.length > 0) {
    console.error(`[audio] 响度超出目标 ±2 LU：${offTarget.map((row) => `${row.file}(${row.lufs})`).join(', ')}`);
    process.exitCode = 1;
  }
}

function writeThirdParty(rows) {
  const packRows = Object.entries(SPEC.packs).map(([name, pack]) => (
    `| ${name} | ${pack.author} | ${pack.license} | ${pack.page} |`
  ));
  const fileRows = rows.map((row) => {
    const pack = SPEC.packs[row.pack];
    const author = pack?.author ?? '?';
    const license = pack?.license ?? '?';
    const page = pack?.page ?? '?';
    return `| \`${path.relative(OUT_DIR, path.join(ROOT, row.file))}\` | ${row.source} | ${author} | ${license} | ${page} | ${row.duration.toFixed(2)} s | ${row.lufs.toFixed(1)} LUFS / ${row.peak.toFixed(1)} dBFS |`;
  });
  const text = `# 音频素材来源与许可

本目录全部音频均由 \`develop_tools/audio/build.mjs\` 从下列来源转码（Opus / 48 kHz）。
源文件不入库；改动 = 转码 + 响度归一（见脚本注释），没有剪辑以外的创作性修改。

## 来源包

| 包 | 作者 | 许可 | 来源页 |
| --- | --- | --- | --- |
${packRows.join('\n')}

CC0 素材无需署名；此处仍列出作者与来源页，便于核对。

## 成品清单

| 文件 | 源文件 | 作者 | 许可 | 来源页 | 时长 | 响度实测 |
| --- | --- | --- | --- | --- | --- | --- |
${fileRows.join('\n')}
`;
  fs.writeFileSync(path.join(OUT_DIR, 'THIRD_PARTY.md'), text);
}

main();
