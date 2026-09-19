const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {contentRewriteReport} = require('../dist-test-renderer/renderer/content-browser/rewrite-report.js');

/** 构造一次移动/重命名的返回结果，只覆盖本用例关心的字段。 */
function result(overrides = {}) {
  return {
    sourcePath: 'assets/templates/a.png',
    targetPath: 'assets/templates/b.png',
    updatedFiles: 0,
    updatedReferences: 0,
    rewritten: [],
    ...overrides,
  };
}

test('改写明细按处数降序展示，标题与副标题带文件数和处数', () => {
  const report = contentRewriteReport(result({
    targetPath: 'workflows/活动副本2.json',
    updatedFiles: 3,
    updatedReferences: 6,
    rewritten: [
      {path: 'workflows/活动副本.json', references: 2},
      {path: 'assets/templates/rewards/catalog.json', references: 3},
      {path: 'workflows/other.json', references: 1},
    ],
  }), '重命名');

  assert.equal(report.title, '已重命名为 workflows/活动副本2.json');
  assert.equal(report.subtitle, '3 个文件、6 处引用已重定向');
  assert.equal(report.references, 6);
  assert.equal(report.references, report.rows.reduce((total, row) => total + row.references, 0), 'toast 用的合计要和列表一致');
  assert.deepEqual(report.rows, [
    {path: 'assets/templates/rewards/catalog.json', references: 3},
    {path: 'workflows/活动副本.json', references: 2},
    {path: 'workflows/other.json', references: 1},
  ]);
});

test('路径归一化：反斜杠、./ 前缀与重复计数都会合并', () => {
  const report = contentRewriteReport(result({
    rewritten: [
      {path: '.\\workflows\\a.json', references: 1},
      {path: './workflows/a.json', references: 2},
      {path: '  workflows/a.json  ', references: 3},
    ],
  }), '移动');

  assert.equal(report.rows.length, 1);
  assert.deepEqual(report.rows[0], {path: 'workflows/a.json', references: 6});
  assert.equal(report.subtitle, '1 个文件、6 处引用已重定向');
});

test('没有明细（或明细字段缺失/非法）时不产生副标题，调用方只弹 toast', () => {
  assert.deepEqual(contentRewriteReport(result(), '移动').rows, []);
  assert.equal(contentRewriteReport(result(), '移动').subtitle, '');
  assert.equal(contentRewriteReport(result(), '移动').title, '已移动为 assets/templates/b.png');
  // 老版本 IPC 可能没有 rewritten 字段；空路径与非法处数按 1 处计入，绝不生成空路径行。
  const legacy = contentRewriteReport({sourcePath: 'a.png', targetPath: 'c.png', updatedFiles: 1, updatedReferences: 1}, '移动');
  assert.deepEqual(legacy.rows, []);
  assert.equal(legacy.references, 0, '没有明细就不报处数');
  const messy = contentRewriteReport(result({
    rewritten: [null, {path: ''}, {path: 'workflows/x.json'}, {path: 'workflows/y.json', references: -4}],
  }), '重命名');
  assert.deepEqual(messy.rows, [
    {path: 'workflows/x.json', references: 1},
    {path: 'workflows/y.json', references: 1},
  ]);
});

test('内容浏览器在两个入口都用同一个报告函数，且弹窗、样式、浅色主题都已接上', () => {
  const root = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const source = read('src/renderer/content-browser.ts');
  // 重命名与移动都要汇报明细，不能让某条路径只弹 toast。
  assert.equal((source.match(/reportContentRewrite\(result, '重命名', skipped\)/g) || []).length, 1);
  assert.equal((source.match(/reportContentRewrite\(result, '移动', skipped\)/g) || []).length, 1);
  assert.doesNotMatch(source, /const redirectText =/, 'toast 文案已由 reportContentRewrite 统一给出');

  const html = read('src/renderer/index.html');
  for (const id of ['content-rewrite-modal', 'content-rewrite-title', 'content-rewrite-subtitle', 'content-rewrite-list', 'content-rewrite-hint', 'content-rewrite-confirm', 'content-rewrite-close']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} 在 index.html 里应唯一`);
  }

  // 明细列表要能滚动（长引用列表不撑破弹窗），并且浅色主题由生成器派生而不是手写。
  const styles = read('src/renderer/styles.css');
  assert.match(styles, /\.content-rewrite-list \{[^}]*overflow: auto/);
  assert.match(styles, /\.content-rewrite-dialog \{[^}]*flex-direction: column/);
  const light = read('public/theme/workbench-light.css');
  assert.match(light, /\[data-theme="light"\] \.content-rewrite-dialog/);
  const {generate, groups} = require('../scripts/build-light-palette.cjs');
  assert.equal(light, generate(groups.workbench), '浅色适配必须与生成器输出一致');
});

test('主进程返回每个被改写文件的路径与处数，而不是只给计数', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/projectService.ts'), 'utf8');
  assert.match(source, /private rewriteDetails\(plans: RewritePlan\[\]\): ContentRewriteDetail\[\]/);
  assert.equal((source.match(/rewritten: this\.rewriteDetails\(plans\)/g) || []).length, 2, '单文件改名与文件夹改名都要带明细');
  const contracts = fs.readFileSync(path.join(__dirname, '..', 'src/shared/contracts.ts'), 'utf8');
  assert.match(contracts, /export interface ContentRewriteDetail \{[\s\S]*?references: number;[\s\S]*?\}/);
  assert.match(contracts, /rewritten: ContentRewriteDetail\[\]/);
});

test('报告函数把明细铺进列表并打开弹窗，没有明细时只弹 toast', () => {
  // 按函数名切片后在 vm 里跑（与 workbench.test.cjs 对 renderContentBrowser 的做法一致），
  // 断言的是真实支路：行数、路径、处数、toast 文案与弹窗的显隐。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/content-browser.ts'), 'utf8');
  const start = source.indexOf('function reportContentRewrite(');
  assert(start > 0, 'reportContentRewrite 必须存在');
  const js = require('node:module').stripTypeScriptTypes(source.slice(start, source.indexOf('\n}\n', start) + 2));

  const element = () => ({
    className: '', textContent: '', title: '', children: [], hidden: false, attrs: {},
    classList: {add(name) { this[name] = true; }, remove(name) { this[name] = false; }},
    setAttribute(name, value) { this.attrs[name] = value; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    focus() { this.focused = true; },
  });
  const toasts = [], list = element(), modal = element(), confirm = element(), hint = element();
  const ctx = vm.createContext({
    contentRewriteReport, showToast: (message, error) => toasts.push([message, Boolean(error)]),
    contentRewriteTitle: element(), contentRewriteSubtitle: element(), contentRewriteHint: hint,
    contentRewriteList: list, contentRewriteModal: modal, contentRewriteConfirm: confirm,
    document: {createElement: () => element()}, window: {setTimeout: (fn) => fn()},
  });
  vm.runInContext(js, ctx);

  ctx.reportContentRewrite(result({
    targetPath: 'assets/templates/b.png',
    updatedReferences: 3,
    rewritten: [{path: 'workflows/a.json', references: 2}, {path: 'workflows/b.json', references: 1}],
  }), '移动');

  assert.deepEqual(toasts, [['已移动为 assets/templates/b.png，已重定向 3 处引用', false]]);
  assert.equal(modal.classList.hidden, false, '有明细要打开弹窗');
  assert.equal(modal.attrs['aria-hidden'], 'false');
  assert.equal(confirm.focused, true, '打开后焦点落在「知道了」');
  assert.equal(list.children.length, 2);
  assert.deepEqual(list.children.map((row) => row.children.map((cell) => cell.textContent)),
    [['workflows/a.json', '2 处'], ['workflows/b.json', '1 处']]);
  assert.deepEqual(list.children.map((row) => row.className), ['content-rewrite-item', 'content-rewrite-item']);

  // 没有明细时保持原样：只弹一条 toast，不碰弹窗状态。
  modal.classList.hidden = true;
  toasts.length = 0;
  ctx.reportContentRewrite(result(), '移动');
  assert.deepEqual(toasts, [['已移动为 assets/templates/b.png', false]]);
  assert.equal(modal.classList.hidden, true, '没有改写就不弹窗');

  // 有未保存修改的文档没能跟着重载时，弹窗要把它点名：保存它会覆盖刚做的重定向。
  ctx.reportContentRewrite(result({
    updatedReferences: 1,
    rewritten: [{path: 'workflows/a.json', references: 1}],
  }), '移动', ['workflows/entrypoints/new_workflow.json']);
  assert.match(hint.textContent, /1 个文件有未保存修改/);
  assert.match(hint.textContent, /workflows\/entrypoints\/new_workflow\.json/, '要写清是哪个文件');
  assert.match(hint.textContent, /覆盖本次重定向/);
});

test('文件夹改名：内部打开的工作流按新旧前缀搬到新路径，外部文档不动', () => {
  // 同样按函数名切片跑真实支路：路径前缀映射错了会把别的文档搬走或漏搬。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/content-browser.ts'), 'utf8');
  const start = source.indexOf('function relocateFolderDocuments(');
  assert(start > 0, 'relocateFolderDocuments 必须存在');
  const js = require('node:module').stripTypeScriptTypes(source.slice(start, source.indexOf('\n}\n', start) + 2));

  const tabs = [
    {uri: 'file:///p/workflows/活动用/a.json'},
    {uri: 'file:///p/workflows/活动用/sub/b.json'},
    {uri: 'file:///p/workflows/别的/c.json'},
    {uri: 'file:///p/assets/templates/x.png'},
  ];
  const descriptors = {
    'workflows/新活动/a.json': {uri: 'file:///p/workflows/新活动/a.json'},
    'workflows/新活动/sub/b.json': {uri: 'file:///p/workflows/新活动/sub/b.json'},
  };
  const relocated = [];
  const ctx = vm.createContext({
    getWorkflowTabs: () => tabs,
    displayFileUri: (uri) => uri.replace('file:///p/', ''),
    relativeToProject: (value) => value,
    workflowDescriptorForPath: (relative) => descriptors[relative],
    relocateDocument: (oldUri, newUri) => relocated.push([oldUri, newUri]),
  });
  vm.runInContext(js, ctx);

  assert.deepEqual(Array.from(ctx.relocateFolderDocuments('workflows/活动用', 'workflows/新活动')), [
    'file:///p/workflows/新活动/a.json',
    'file:///p/workflows/新活动/sub/b.json',
  ]);
  assert.deepEqual(relocated, [
    ['file:///p/workflows/活动用/a.json', 'file:///p/workflows/新活动/a.json'],
    ['file:///p/workflows/活动用/sub/b.json', 'file:///p/workflows/新活动/sub/b.json'],
  ], '嵌套子目录也要跟着走，前缀相同的兄弟目录不能误伤');
  assert.deepEqual(Array.from(ctx.relocateFolderDocuments('workflows/活动用2', 'workflows/x')), [], '同前缀目录不算在里面');
  assert.deepEqual(Array.from(ctx.relocateFolderDocuments('', 'workflows/x')), [], '空路径不能把整个项目都搬走');

  // 接线：文件夹改名走搬迁，两个入口都要把被改写的文档重新读盘。
  assert.equal((source.match(/const relocated = relocateFolderDocuments\(item\.path, result\.targetPath\)/g) || []).length, 1);
  assert.equal((source.match(/await reloadRewrittenDocuments\(result\.rewritten\.map\(\(detail\) => detail\.path\)\)/g) || []).length, 2,
    '重命名与移动都要把被改写的打开文档重新读盘');
});
