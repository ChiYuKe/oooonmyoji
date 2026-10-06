const { readExpandedHtml, readExpandedCss } = require('../scripts/renderer-templates.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.join(__dirname,'../public/legacy');
const read = file => { const filename = path.join(root, file); if (file.startsWith('src/renderer/') && file.endsWith('.html')) return readExpandedHtml(filename); if (file === 'src/renderer/styles/workbench.css') return readExpandedCss(filename); return fs.readFileSync(filename, 'utf8'); };
const frame = postcss.parse(read('editor-frame.css'));
const properties = selector => {
  const result = {};
  frame.walkRules(selector, rule => {
    assert.equal(rule.parent.type,'root', 'desktop geometry must not inherit legacy layer/media conditions');
    rule.walkDecls(d => {result[d.prop]=d.value;});
  });
  return result;
};

test('desktop canvas always defines one full-height row, including narrow selected-node state', () => {
  // The legacy combined editor retains its stacked layout; only the split desktop embeds override it.
  assert.match(read('workflow-editor.css'),/grid-template-rows: minmax\(0, 58%\) minmax\(0, 42%\)/);
  const canvas=properties('.desktop-canvas-mode #editor-main');
  assert.equal(canvas.display,'grid');
  assert.equal(canvas['grid-template-rows'],'minmax(0, 1fr)');
  assert.equal(canvas['grid-template-columns'],'minmax(0, 1fr)');
  assert.equal(canvas.height,'100%');
  assert.equal(properties('.desktop-canvas-mode #canvas-wrap')['min-height'],'0');
  assert.equal(properties('.desktop-canvas-mode #inspector').display,'none');
  assert.equal(properties('.desktop-canvas-mode #workflow-breadcrumb').position,'absolute');
});

test('排列预览确认条在桌面画布模式下让开悬浮的面包屑条', () => {
  // 面包屑在桌面模式是 30px 高、z-index:5 的悬浮层，压住 z-index:0 的 #canvas-wrap 整棵子树；
  // 确认条若还留在画布内的 top:12px，上边框与按钮上沿的点击都会被它吃掉。
  const declarations = (root, selector) => {
    const result = {};
    root.walkRules(selector, rule => rule.walkDecls(d => {result[d.prop] = d.value;}));
    return result;
  };
  const strip = declarations(postcss.parse(read('workflow-editor.css')), '#workflow-breadcrumb');
  assert.equal(strip['min-height'], '30px');
  const bar = properties('.desktop-canvas-mode #arrange-preview-bar');
  assert(
    parseFloat(bar.top) > parseFloat(strip['min-height']),
    `确认条 top 必须落在 ${strip['min-height']} 的面包屑条之下，当前 ${bar.top}`
  );
  // 旧编辑器布局里面包屑在文档流里，画布从它下面开始，原位置不用动。
  assert.equal(declarations(postcss.parse(read('workflow-editor.css')), '#arrange-preview-bar').top, '12px');
});

test('separate details panel fills its host without reserving a hidden breadcrumb', () => {
  assert.equal(properties('.desktop-details-mode #editor-main').height,'100%');
  assert.equal(properties('.desktop-details-mode #editor-main').display,'block');
  assert.equal(properties('.desktop-details-mode #inspector').height,'100%');
  assert.equal(properties('.desktop-details-mode #canvas-wrap').display,'none');
  assert.match(read('editor-frame.css'),/\.desktop-details-mode #workflow-breadcrumb \{ display: none !important; \}/);
});

test('both frame modes load the explicit desktop layout after all shared styles', () => {
  const html=fs.readFileSync(path.join(__dirname,'../src/renderer/canvas.html'),'utf8');
  const styles=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(styles.at(-1),'/legacy/editor-frame.css');
  assert(!html.includes('<style>'), 'avoid a generic inline main height overriding details mode');
  const bridge=fs.readFileSync(path.join(__dirname,'../src/canvas/bridge.ts'),'utf8');
  assert(bridge.includes('desktop-${mode}-mode'));
});

test('runtime edge preview can be disabled without hiding ordinary structure edges', () => {
  const disabledLine = properties('.runtime-edge-preview-disabled .edge[class*="run-"] .edge-line');
  assert.equal(disabledLine.stroke, 'var(--wire)');
  assert.equal(disabledLine['stroke-dasharray'], 'none');
  assert.equal(properties('.runtime-edge-preview-disabled .edge .edge-flow').display, 'none');
});
