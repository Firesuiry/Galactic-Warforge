#!/usr/bin/env node
/**
 * 生成鸣谢数据 `client-web/public/assets/credits.json`（客户端「鸣谢」弹窗读它）。
 *
 * 三组来源：
 * - `models`：Sketchfab CC-BY（逐个模型：标题 / 作者 / 模型页 / 许可 / 改动说明），
 *   从 `develop_tools/sketchfab/selection.json` + `raw/` 里的许可记录生成；
 * - `audio`：Kenney / OpenGameArt（CC0），从 `client-web/public/assets/audio/THIRD_PARTY.md` 的来源包表；
 * - `textures`：ambientCG（CC0），从 `client-web/public/assets/textures/materials/THIRD_PARTY.md`。
 *
 * 用法（仓库根）：node develop_tools/three_assets/credits.mjs
 * 依赖 Sketchfab 的 raw/ 许可记录（gitignore，重新下载后可重跑）；缺记录时用 selection.json 的字段兜底。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SKETCHFAB = path.join(ROOT, 'develop_tools/sketchfab');
const OUT = path.join(ROOT, 'client-web/public/assets/credits.json');

const SELECTION = JSON.parse(fs.readFileSync(path.join(SKETCHFAB, 'selection.json'), 'utf8'));

/** Sketchfab 模型的改动说明（CC-BY 要求标注改动）。规整管线统一做的事 + 每个槽位的特殊处理。 */
const CHANGES = '减面到预算、贴图缩到 1K 并去饱和 35% + 均值归一、合并材质、去相机/灯/特效面片、meshopt 压缩、按阵营重上色（底色乘阵营主色、发光件换阵营发光色）';
const EXTRA_CHANGES = {
  'plasma_turret': '整模绕 Y 旋转 90°（炮管朝 +Z）',
  'gauss_turret': '整模绕 Y 旋转 90°（炮管朝 +Z）',
  'anti_air_turret': '整模绕 Y 旋转 180°（炮管朝 +Z）',
  'mecha': '映射表里绕 Y 旋转 90° 对齐正面 +Z',
  'missile_vehicle': '映射表里绕 Y 旋转 90° 对齐正面 +Z',
  'repair_vehicle': '映射表里绕 Y 旋转 180° 对齐正面 +Z',
  'supply_truck': '映射表里绕 Y 旋转 180° 对齐正面 +Z',
};

/**
 * `selection.json` 的 `viewerUrl` 必须是真的模型页：`raw/` 是 gitignore 的，干净克隆上重跑本脚本
 * 读不到许可记录，只能靠 selection.json 兜底。占位符（`/3d-models/none-<uid>`）会产出 404 链接，
 * 这里直接报错，避免悄悄写进产物。
 */
function assertViewerUrl(entry, label) {
  const url = entry.viewerUrl ?? '';
  if (!url || /\/3d-models\/none-/.test(url)) {
    throw new Error(`${label} 的 viewerUrl 是占位符（${url || '(空)'}）：请先用 fetch.py 的许可记录回写 selection.json`);
  }
  return url;
}

function sketchfabModels() {
  const rows = [];
  for (const [type, value] of Object.entries(SELECTION)) {
    const role = value.chosen ?? 'primary';
    if (role === 'none') continue;
    const entry = value[role];
    if (!entry) continue;
    const dir = role === 'primary' ? type : `${type}-${role}`;
    const licenseFile = path.join(SKETCHFAB, 'raw', dir, `${entry.uid}.license.json`);
    const license = fs.existsSync(licenseFile) ? JSON.parse(fs.readFileSync(licenseFile, 'utf8')) : {};
    rows.push({
      type,
      title: entry.name,
      author: entry.author,
      authorUrl: license.author_url ?? entry.authorUrl ?? `https://sketchfab.com/${entry.author}`,
      modelUrl: license.viewerUrl ?? assertViewerUrl(entry, type),
      license: 'CC BY 4.0',
      licenseUrl: license.license_url ?? 'https://creativecommons.org/licenses/by/4.0/',
      changes: [CHANGES, EXTRA_CHANGES[type]].filter(Boolean).join('；'),
    });
  }
  return rows.sort((a, b) => a.type.localeCompare(b.type));
}

/** 音频来源包（与 `public/assets/audio/THIRD_PARTY.md` 的来源包表一致；成品文件逐条映射见该文件）。 */
const AUDIO = [
  ['kenney_sci-fi-sounds', 'Kenney', 'https://kenney.nl/assets/sci-fi-sounds'],
  ['kenney_impact-sounds', 'Kenney', 'https://kenney.nl/assets/impact-sounds'],
  ['kenney_interface-sounds', 'Kenney', 'https://kenney.nl/assets/interface-sounds'],
  ['kenney_ui-audio', 'Kenney', 'https://kenney.nl/assets/ui-audio'],
  ['kenney_digital-audio', 'Kenney', 'https://kenney.nl/assets/digital-audio'],
  ['oga_space_wind', 'aquinn', 'https://opengameart.org/content/space-winds'],
  ['oga_wind', 'Bashar3A', 'https://opengameart.org/content/mild-wind-background-noise'],
  ['oga_factory', 'yd', 'https://opengameart.org/content/factory-ambiance'],
  ['oga_calm', 'Tozan', 'https://opengameart.org/content/deep-space-array'],
  ['oga_tense', 'TinyWorlds', 'https://opengameart.org/content/space-graveyard-ambient-track'],
  ['oga_combat', 'buttons', 'https://opengameart.org/content/last-stand-in-space-looped'],
].map(([pack, author, url]) => ({
  type: pack,
  title: pack,
  author,
  authorUrl: url,
  modelUrl: url,
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  changes: '转码为 Opus 48 kHz + 响度归一',
}));

/** 工业材质贴图（ambientCG，CC0）。 */
const TEXTURES = [
  ['painted_metal', 'Paint004', 'https://ambientcg.com/view?id=Paint004'],
  ['brushed_metal', 'Metal010', 'https://ambientcg.com/view?id=Metal010'],
  ['plate_metal', 'MetalPlates001', 'https://ambientcg.com/view?id=MetalPlates001'],
  ['diamond_plate', 'DiamondPlate004', 'https://ambientcg.com/view?id=DiamondPlate004'],
  ['rubber', 'Rubber001', 'https://ambientcg.com/view?id=Rubber001'],
  ['plastic', 'Plastic013A', 'https://ambientcg.com/view?id=Plastic013A'],
].map(([type, title, url]) => ({
  type,
  title,
  author: 'ambientCG（Lennart Demes）',
  authorUrl: url,
  modelUrl: url,
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  changes: 'JPG 转 webp 1K + 打包 ORM',
}));

const KENNEY = [
  { type: 'city-kit-industrial', title: 'City Kit (Industrial) 2.0', author: 'Kenney', authorUrl: 'https://kenney.nl/assets/city-kit-industrial', modelUrl: 'https://kenney.nl/assets/city-kit-industrial', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', changes: '只用映射表引用的子集' },
  { type: 'space-kit', title: 'Space Kit 2.0', author: 'Kenney', authorUrl: 'https://kenney.nl/assets/space-kit', modelUrl: 'https://kenney.nl/assets/space-kit', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', changes: '只用映射表引用的子集' },
];

const data = {
  note: '本作使用以下第三方素材。CC-BY 素材已按许可标注作者与改动；CC0 素材无需署名，这里一并列出便于核对。',
  groups: [
    { id: 'sketchfab', title: '3D 模型（Sketchfab，CC BY 4.0）', entries: sketchfabModels() },
    { id: 'kenney', title: '3D 模型（Kenney，CC0）', entries: KENNEY },
    { id: 'audio', title: '音频（Kenney / OpenGameArt，CC0）', entries: AUDIO },
    { id: 'textures', title: '工业材质贴图（ambientCG，CC0）', entries: TEXTURES },
  ],
};

fs.writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
const total = data.groups.reduce((sum, group) => sum + group.entries.length, 0);
console.log(`${OUT}  (${data.groups.length} groups, ${total} entries)`);
