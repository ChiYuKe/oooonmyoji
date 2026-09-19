import type { Ui } from './ui/elements';
import type { CanvasEditorHandle } from './editor';

declare global {
  interface Window {
    /** 组件库实例（ui-showcase 展示页与旧展示脚本使用）。 */
    UI?: Ui;
    /**
     * 编辑器命令出口：验证脚本（desktop/scripts/verify-*.cjs）与旧展示页
     * 通过它驱动画布。画布模块自身不再读取它，模块间依赖走显式注入。
     */
    __btEditor?: CanvasEditorHandle;
  }
}

export {};
