/**
 * 工作流画布入口：安装显式桥接后启动编辑器组装。
 *
 * 画布全部业务模块已迁移为 TS；本文件只负责桥接、拖拽排序安装与编辑器启动。
 */
import { createCanvasBridge } from './bridge';
import { installChildOrderDnd } from './interactions/child-order-dnd';
import { startCanvasEditor } from './editor';

const bridge = createCanvasBridge();
window.__canvasBridge = bridge;
installChildOrderDnd((message) => bridge.post(message));
startCanvasEditor(bridge);
