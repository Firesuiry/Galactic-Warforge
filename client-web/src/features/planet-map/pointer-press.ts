/**
 * 左键「按下」状态与指针捕获：3D 行星地图点击/拖拽判定的基础。
 *
 * 为什么单独成类：canvas 上的 pointerup 只在「按下与抬起都落在 canvas」时才触发。
 * 抬起落在 HUD/建造栏/抽屉、canvas 被重建、指针捕获丢失时，canvas 收不到 pointerup，
 * 按下状态就一直挂着，之后每次按下都被当成「拖拽中」，点击全部失效（试玩 1014 问题 1）。
 *
 * 这里统一收尾，任何异常序列都不会让后续点击粘死：
 * - window 捕获阶段兜底 pointerup（目标在画布外也能收尾）；
 * - pointercancel / lostpointercapture / window blur 一律清状态；
 * - setPointerCapture / releasePointerCapture 失败不抛（jsdom、合成事件、浏览器拒绝捕获）。
 */

export interface PointerPressState {
  /** 最近一次按下/拖动时的指针坐标。 */
  x: number;
  y: number;
  /** 本次按下是否已判定为拖拽（超过阈值后由调用方 markMoved 置位）。 */
  moved: boolean;
}

export class PointerPress {
  private state: PointerPressState | null = null;
  private pointerId: number | null = null;

  constructor(
    private readonly element: HTMLElement,
    /** 收尾回调：tap = 按下后未拖动（是否落点由调用方决定）。 */
    private readonly onRelease: (event: PointerEvent, tap: boolean) => void,
  ) {}

  attach() {
    this.element.addEventListener('pointerdown', this.onDown);
    this.element.addEventListener('pointercancel', this.cancel);
    this.element.addEventListener('lostpointercapture', this.cancel);
    window.addEventListener('pointerup', this.onWindowUp, true);
    window.addEventListener('blur', this.cancel);
  }

  detach() {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointercancel', this.cancel);
    this.element.removeEventListener('lostpointercapture', this.cancel);
    window.removeEventListener('pointerup', this.onWindowUp, true);
    window.removeEventListener('blur', this.cancel);
  }

  /** 当前按下状态（null = 未按下）。 */
  get press(): PointerPressState | null {
    return this.state;
  }

  /** 拖动判定：超过阈值后由调用方调用，记录最新坐标并置 moved。 */
  markMoved(x: number, y: number) {
    if (!this.state) return;
    this.state.moved = true;
    this.state.x = x;
    this.state.y = y;
  }

  private onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.state = { x: event.clientX, y: event.clientY, moved: false };
    this.pointerId = event.pointerId;
    // 捕获失败不能影响点击落地：window 兜底监听会接住 pointerup。
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      this.pointerId = null;
    }
  };

  private onWindowUp = (event: PointerEvent) => {
    if (!this.state) return;
    const tap = !this.state.moved;
    this.reset();
    this.onRelease(event, tap);
  };

  private cancel = () => { this.reset(); };

  private reset() {
    this.state = null;
    const pointerId = this.pointerId;
    this.pointerId = null;
    if (pointerId === null) return;
    try {
      if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    } catch { /* 捕获已丢失，无需释放。 */ }
  }
}
