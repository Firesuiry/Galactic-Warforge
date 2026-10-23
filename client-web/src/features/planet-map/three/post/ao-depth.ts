/**
 * GTAO 的深度源绑定（审查 P1-3）。
 *
 * `EffectComposer` 构造时把传入的 RT 克隆成 `renderTarget2`（深度纹理也是**克隆**），
 * `RenderPass` 每帧写到当时的 `readBuffer`。本分支的 pass 链每帧 swap 4 次，readBuffer
 * 稳定停在 RT2——构造时绑死 RT1 的深度会让 GTAO 永远读一块全 0 的纹理，AO 全灭。
 *
 * 所以每帧在 `composer.render()` 之前按 `readBuffer` 重绑一次（一次 uniform 赋值，无分配）。
 * 绑定的不变量由单测与 `lightingDebug().passes.aoDepthOnReadBuffer` 守住：swap 次数一变，
 * 这里自动跟着变，不会静默失效。
 */

/** 只依赖用到的两个字段，单测可以用普通对象代替真实的 composer / GTAOPass。 */
interface DepthSource {
  readonly readBuffer: { readonly depthTexture: object | null };
}

interface DepthSink {
  setGBuffer(depthTexture: unknown, normalTexture: unknown): void;
  /** GTAOPass 当前绑定的深度纹理（r186 的公开字段）。 */
  depthTexture?: unknown;
}

/**
 * 把 GTAO 的深度指向 `composer.readBuffer.depthTexture`（RenderPass 本帧写入的那块）。
 *
 * - 已经绑对时直接返回（`setGBuffer` 每帧重设 defines/uniform 虽不重编译，但没必要）。
 * - 没有深度纹理时**不调用** `setGBuffer(undefined)`：r186 的实现会因此每帧新建一个
 *   `normalRenderTarget`（显存泄漏），并退回「自己渲染一遍 GBuffer」的慢路径。
 * - 返回是否绑定成功（false = 当前 RT 没有深度纹理，AO 本帧无有效深度）。
 */
export function bindAoDepth(gtao: DepthSink, composer: DepthSource): boolean {
  const depth = composer.readBuffer.depthTexture;
  if (!depth) return false;
  if (gtao.depthTexture === depth) return true;
  gtao.setGBuffer(depth, undefined);
  return true;
}

/** 绑定是否指向本帧的 readBuffer（调试探针 / 单测断言用）。 */
export function aoDepthBoundToReadBuffer(
  boundDepth: unknown,
  composer: DepthSource,
): boolean {
  return boundDepth !== null && boundDepth !== undefined && boundDepth === composer.readBuffer.depthTexture;
}
