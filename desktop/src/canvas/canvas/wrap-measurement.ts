/**
 * 画布视口测量：缓存 `#canvas-wrap` 的尺寸，只在窗口尺寸变化时重新测量。
 *
 * 为什么必须缓存：读取 `getBoundingClientRect()` 会强制刷新布局，而画布每帧都在写 DOM
 * （挂载卡片、改 transform）。写后立刻读 = 每帧一次强制同步布局，500 节点缩放时
 * 实测能吃掉一半以上的帧时间。
 *
 * 画布尺寸只由面板尺寸决定，而面板尺寸只在窗口/停靠布局变化时改变，因此缓存的安全前提是
 * 「resize 时失效」。这里同时监听 window resize 与容器自身的 ResizeObserver。
 */

export interface WrapSize {
  width: number;
  height: number;
  /** 容器左上角相对视口的位置（世界坐标换算需要）。 */
  left: number;
  top: number;
}

export interface CanvasWrapMeasurement {
  /** 取当前尺寸（必要时重新测量）。 */
  read(): WrapSize;
  /** 强制失效，下一次 read 重新测量。 */
  invalidate(): void;
  /** 已经测量过的尺寸；从未测量过时返回 null。 */
  peek(): WrapSize | null;
  /** 解绑监听（画布销毁）。 */
  dispose(): void;
}

/** 没有 DOM 测量能力时的兜底尺寸（测试替身、SSR）。 */
const FALLBACK: WrapSize = {width: 0, height: 0, left: 0, top: 0};

export function createWrapMeasurement(wrap: {
  getBoundingClientRect?(): { width: number; height: number; left?: number; top?: number };
  clientWidth?: number;
  clientHeight?: number;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}, win: Window | undefined = typeof window === 'undefined' ? undefined : window): CanvasWrapMeasurement {
  let cached: WrapSize | null = null;

  const observer: { disconnect(): void } | null = (() => {
    const ResizeObserverCtor = (globalThis as { ResizeObserver?: new (cb: () => void) => { observe(target: unknown): void; disconnect(): void } }).ResizeObserver;
    if (!ResizeObserverCtor || typeof wrap !== 'object' || wrap === null) return null;
    try {
      const instance = new ResizeObserverCtor(() => { cached = null; });
      instance.observe(wrap);
      return instance;
    } catch {
      return null;
    }
  })();

  function onResize(): void {
    cached = null;
  }
  win?.addEventListener?.('resize', onResize);

  function measure(): WrapSize {
    if (typeof wrap?.getBoundingClientRect === 'function') {
      const rect = wrap.getBoundingClientRect();
      return {
        width: rect.width || wrap.clientWidth || 0,
        height: rect.height || wrap.clientHeight || 0,
        left: typeof rect.left === 'number' ? rect.left : 0,
        top: typeof rect.top === 'number' ? rect.top : 0,
      };
    }
    if (typeof wrap?.clientWidth === 'number' && typeof wrap?.clientHeight === 'number') {
      return {width: wrap.clientWidth, height: wrap.clientHeight, left: 0, top: 0};
    }
    return FALLBACK;
  }

  return {
    read() {
      if (!cached) cached = measure();
      return cached;
    },
    invalidate() {
      cached = null;
    },
    peek() {
      return cached;
    },
    dispose() {
      win?.removeEventListener?.('resize', onResize);
      observer?.disconnect();
      cached = null;
    },
  };
}
