/**
 * UI 组件库展示页入口：安装组件库后加载展示脚本。
 * 展示页必须与 src/canvas/ui/elements.ts 的组件保持一致（见 UI_LIBRARY.md）。
 */
import { createUi } from './elements';

window.UI = createUi();

const script = document.createElement('script');
script.src = '/legacy/ui-showcase.js';
document.body.appendChild(script);
