const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');

test('「御魂配装」注册为工作台可停靠面板（与设置/概览同层），并配了窗口菜单项', () => {
  const docking = read('src/renderer/docking.ts');
  // 面板 id 进入 WorkbenchPanelId 联合类型，定义里带模块元素与默认停靠位置。
  assert.match(docking, /export type WorkbenchPanelId = [^;]*'soulOptimizer'[^;]*SharedDockPanelId;/);
  assert.match(docking, /soulOptimizer:\s*\{\s*title: '御魂配装'/);
  assert.match(docking, /moduleElementId: 'module-soul-optimizer'/);
  assert.match(docking, /reference: 'onmyojiTeamBuilder',\s*direction: 'within'/);
  const html = read('src/renderer/index.html');
  // 模块元素放进工作台模块仓库；窗口菜单里可开关它。
  assert.match(html, /<section id="module-soul-optimizer" class="dock-module soul-optimizer-module" aria-label="御魂配装"><\/section>/);
  assert.match(html, /data-workbench-panel="soulOptimizer"[^>]*><span>御魂配装<\/span>/);
});

test('「配装计算」入口由御魂计算页创建：无快照或未装配面板时禁用，点击时打开配装面板', () => {
  const calculator = read('src/renderer/soul-calculator.ts');
  // 入口按钮仍叫 soul-optimize，放在御魂工具栏排序控件之前；初始禁用。
  assert.match(calculator, /launcher\.id = 'soul-optimize'/);
  assert.match(calculator, /insertBefore\(launcher, root\.querySelector\('\.soul-sort-controls'\)\)/);
  assert.match(calculator, /launcher\.addEventListener\('click', \(\) => optimizer\?\.open\(\)\)/);
  // 快照更新时：推给配装面板，并按下述条件恢复/保持入口可用。
  assert.match(calculator, /optimizer\?\.update\(snapshot, state\.instances, state\.selectedId, refreshing \|\| Boolean\(state\.fetchingId\)\);/);
  assert.match(calculator, /launcher\.disabled = !optimizer \|\| !snapshot\?\.souls\.length;/);
});

test('配装面板本身不再创建模态弹窗：无 dialog/showModal/关闭按钮，自带悬停详情浮窗', () => {
  const view = read('src/renderer/soul-optimizer-view.ts');
  // 根节点是面板 div（可停靠），不是 <dialog>，也没有模态语义。
  assert.match(view, /panel\.className = 'soul-optimizer soul-optimizer-panel'/);
  assert.doesNotMatch(view, /showModal|dialog\.close|data-action="close"|createElement\('dialog'\)/);
  // 面板暴露 update/open/dispose；由停靠布局注入 open 钩子。
  assert.match(view, /interface SoulOptimizerPanel \{[\s\S]*?update\(snapshot\?: SoulSnapshot, instances\?: Array<RuntimeInstance & Partial<SoulInstance>>, selectedInstanceId\?: string, instancePickerDisabled\?: boolean\): void;[\s\S]*?open\(\): void;[\s\S]*?dispose\(\): void;/);
  assert.match(view, /hooks: SoulOptimizerPanelHooks = \{\}/);
  // 面板不可见（被收起/关掉，模块元素回到隐藏仓库）时先关掉模态子弹窗。
  assert.match(view, /new IntersectionObserver\(entries => \{[\s\S]*?picker\.close\(\); planDetail\.close\(\); rangeEditor\.close\(\);/);
  // 悬停详情用面板自己的浮窗，避免依赖隐藏的御魂计算模块。
  assert.match(view, /detailWindowEl\.id = 'soul-optimizer-detail-window'/);
  assert.match(view, /renderSoulDetail\(doc, detail, soul\)/);
});

test('主进程装配：配装面板实例化进模块元素，计算器只拿到控制器；卸载时一起释放', () => {
  const main = read('src/renderer/main.ts');
  assert.match(main, /installSoulOptimizer\(\s*document\.querySelector<HTMLElement>\('#module-soul-optimizer'\)!/);
  assert.match(main, /\{ open: \(\) => workbenchFrame\?\.show\('soulOptimizer'\), community: soulCommunity \},?\s*\)/);
  assert.match(main, /disposeSoulCalculator = installSoulCalculator\([\s\S]*?#team-builder-soul-calculator'\)!, api, soulOptimizer\)/);
  assert.match(main, /disposeSoulOptimizer\?\.\(\);/);
});

test('面板样式铺满停靠区域，去掉弹窗的居中宽度、边框和阴影', () => {
  const css = read('src/renderer/styles.css');
  require('postcss').parse(css);
  assert.match(css, /\.soul-optimizer-panel \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /\.soul-optimizer-panel \.soul-optimizer-body \{ flex: 1 1 auto; \}/);
});

test('面板共享详情渲染：soul-detail-render 提供渲染，soul-calculator 只转发 formatSoulAttribute', () => {
  const render = read('src/renderer/soul-detail-render.ts');
  assert.match(render, /export function renderSoulDetail\(doc: Document, detail: HTMLElement, selected\?: SoulRecord,/);
  assert.match(render, /export function formatSoulAttribute/);
  const calculator = read('src/renderer/soul-calculator.ts');
  assert.match(calculator, /export \{ formatSoulAttribute \} from '\.\/soul-detail-render';/);
});
