import type { CanvasBridge } from './bridge';
import type { Ui } from './ui/elements';

declare global {
  interface Window {
    /** 画布显式桥接；画布模块从这里取消息通道。 */
    __canvasBridge?: CanvasBridge;
    /** 组件库实例（ui-showcase 展示页与旧展示脚本使用）。 */
    UI?: Ui;
    /** 旧工具条全局对象（toolbar 模块创建，供桥接转发工作流/实例切换）。 */
    __topbar?: {
      setWorkflow(value: string): void;
      setInstance(value: string): void;
    };
    /** 编辑器命令出口（调试与独立窗口转发使用）。 */
    __btEditor?: unknown;
  }
}

export {};
