import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PointerPress } from './pointer-press';

/**
 * jsdom 不实现 PointerEvent / setPointerCapture，这里补最小实现：
 * setPointerCapture 可被替换成抛错（浏览器在指针已释放时会抛 NotFoundError）。
 */
function installPointerSupport(options: { captureThrows?: boolean } = {}) {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  const captured = new Set<number>();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value(this: HTMLElement, id: number) {
      if (options.captureThrows) throw new DOMException('InvalidPointerId', 'NotFoundError');
      captured.add(id);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: (id: number) => captured.has(id),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: (id: number) => { captured.delete(id); },
  });
  return captured;
}

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init });
}

describe('PointerPress：按下/抬起与指针捕获收尾', () => {
  let element: HTMLElement;
  let onRelease: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installPointerSupport();
    element = document.createElement('canvas');
    document.body.appendChild(element);
    onRelease = vi.fn();
  });

  afterEach(() => {
    element.remove();
  });

  it('画布内按下抬起：收尾一次且 tap=true，捕获已释放', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    element.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 20 }));
    expect(press.press).toMatchObject({ x: 10, y: 20, moved: false });
    element.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 20 }));
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][1]).toBe(true);
    expect(press.press).toBeNull();
    expect(element.hasPointerCapture(1)).toBe(false);
  });

  it('抬起落在画布外（pointerup 只到 window）：仍然收尾且 tap=true', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    element.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 20 }));
    // pointerup 落在 HUD/建造栏（画布外）：canvas 收不到，只有 window 捕获阶段能看到。
    window.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 20 }));
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][1]).toBe(true);
    expect(press.press).toBeNull();
  });

  it('拖拽（超过阈值）后抬起：tap=false，不会误触发落点', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    element.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 20 }));
    press.markMoved(40, 60);
    window.dispatchEvent(pointer('pointerup', { clientX: 40, clientY: 60 }));
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][1]).toBe(false);
  });

  it('setPointerCapture 抛错（浏览器拒绝/合成事件）：点击仍然收尾落地', () => {
    installPointerSupport({ captureThrows: true });
    const press = new PointerPress(element, onRelease);
    press.attach();
    expect(() => element.dispatchEvent(pointer('pointerdown'))).not.toThrow();
    expect(press.press).not.toBeNull();
    window.dispatchEvent(pointer('pointerup'));
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(press.press).toBeNull();
  });

  it('pointercancel / lostpointercapture / window blur 都清掉按下状态，后续点击不受影响', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    for (const interrupt of [
      () => element.dispatchEvent(pointer('pointercancel')),
      () => element.dispatchEvent(pointer('lostpointercapture')),
      () => window.dispatchEvent(new Event('blur')),
    ]) {
      element.dispatchEvent(pointer('pointerdown', { clientX: 1, clientY: 1 }));
      interrupt();
      expect(press.press).toBeNull();
      expect(onRelease).not.toHaveBeenCalled();
      // 坏状态没有粘住：下一次完整点击照常落地
      element.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      window.dispatchEvent(pointer('pointerup', { clientX: 5, clientY: 5 }));
      expect(onRelease).toHaveBeenCalledTimes(1);
      onRelease.mockClear();
    }
  });

  it('没有按下时的指针抬起不产生落点', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    window.dispatchEvent(pointer('pointerup'));
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('detach 后不再响应任何指针事件（场景销毁）', () => {
    const press = new PointerPress(element, onRelease);
    press.attach();
    element.dispatchEvent(pointer('pointerdown'));
    press.detach();
    window.dispatchEvent(pointer('pointerup'));
    expect(onRelease).not.toHaveBeenCalled();
    expect(press.press).not.toBeNull(); // 状态未清也不影响新实例
  });
});
