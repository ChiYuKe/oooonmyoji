/**
 * 工作流画布入口：安装显式桥接后启动编辑器组装。
 *
 * 画布全部业务模块已迁移为 TS；本文件只负责桥接、拖拽排序安装与编辑器启动。
 * 编辑器句柄通过 startCanvasEditor 显式返回，子节点排序拖拽经 getEditor 惰性获取。
 */
import { createCanvasBridge } from './bridge';
import { installChildOrderDnd } from './interactions/child-order-dnd';
import { startCanvasEditor, type CanvasEditorHandle } from './editor';

const bridge = createCanvasBridge();
let editor: CanvasEditorHandle | null = null;
installChildOrderDnd((message) => bridge.post(message), () => editor ?? undefined);
editor = startCanvasEditor(bridge);
