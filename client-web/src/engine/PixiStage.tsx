/**
 * Pixi Application 的 React 挂载点。
 * - 异步 init（Pixi v8 API），挂载后回调 onReady(app)
 * - 随容器尺寸自适应（resizeTo）
 * - 卸载时销毁；onReady 可返回清理函数
 */

import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';

interface PixiStageProps {
  className?: string;
  /** app 初始化完成后调用；返回值作为清理函数在卸载/重建前执行。 */
  onReady: (app: Application) => void | (() => void);
}

export function PixiStage({ className, onReady }: PixiStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let destroyed = false;
    let ready = false;
    let cleanup: void | (() => void);
    const app = new Application();

    app
      .init({
        resizeTo: container,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      .then(() => {
        if (destroyed) {
          // StrictMode/导航竞态：init 完成前已被卸载。
          // 第一个参数不得为 true——renderer 的 true 会释放全局共享资源，
          // 会误伤同页其他 Application 实例（Pixi 内部随之报 'push' of undefined）。
          app.destroy(false, { children: true });
          return;
        }
        ready = true;
        container.appendChild(app.canvas);
        cleanup = onReadyRef.current(app);
      })
      .catch((error: unknown) => {
        console.error('[PixiStage] init failed', error);
      });

    return () => {
      destroyed = true;
      cleanup?.();
      if (ready) {
        app.destroy(false, { children: true });
      }
    };
  }, []);

  return <div className={className} ref={containerRef} data-testid="pixi-stage" />;
}
