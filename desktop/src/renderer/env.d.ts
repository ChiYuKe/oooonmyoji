import type { OnmyojiDesktopApi } from '../shared/contracts';

declare global {
  interface Window {
    onmyoji: OnmyojiDesktopApi;
  }
}

export {};
