/**
 * 全息调色板（Pixi 场景侧）：与 src/styles/tokens.css 的设计 token 一一同值。
 * WebGL 场景无法直接消费 CSS 变量，此处保持同步（改 token 时两边一起改）。
 * 语义约定：己方/激活 teal、敌方 danger 红、警告/选中 amber、中立/弱信息 muted。
 */

/** --accent：teal 主色（己方/激活态标记）。 */
export const HOLO_ACCENT = 0x39e6d0;
/** --accent-2：blue 次色（航线/轨道圈等弱信息层）。 */
export const HOLO_ACCENT_2 = 0x5fb0ff;
/** --amber：警告/选中高亮。 */
export const HOLO_AMBER = 0xffb454;
/** --danger：敌方/交战标记。 */
export const HOLO_DANGER = 0xff5757;
/** danger 提亮：敌方行星等着色面（红族语义，区别于描边红）。 */
export const HOLO_DANGER_LIGHT = 0xff8a8a;
/** --text：主文字。 */
export const HOLO_TEXT = 0xe8f1ff;
/** --text-muted：中立/弱信息标记。 */
export const HOLO_TEXT_MUTED = 0x8fa3c8;
/** --bg-1：场景底色。 */
export const HOLO_BG_1 = 0x0a1428;
