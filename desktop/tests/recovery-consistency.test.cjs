// Run via npm test (builds the renderer test output first).
// 阶段 7：恢复与一致性的接线契约。
// - 打开文档时先问「要不要恢复未保存内容」，选了才用恢复副本；
// - 磁盘被外部改写 + 本地有未保存修改时三选（对比 / 保留本地 / 使用磁盘版本）；
// - 写盘成功后清掉恢复副本；
// - 画布每次改动都留档。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('打开文档时先解析恢复副本：与磁盘不同才标记为未保存', () => {
  const source = read('src/renderer/document-lifecycle.ts');
  assert.match(source, /resolveRecovery\?\(uri: string, diskText: string\): Promise<string \| null>/);
  const load = source.slice(source.indexOf('async function loadWorkflow('), source.indexOf('async function reloadDocuments('));
  assert.match(load, /if \(!tab\.text && deps\.resolveRecovery\)/, '只有还没有内存副本时才问');
  assert.match(load, /const recovered = await deps\.resolveRecovery\(uri, documentText\)/);
  assert.match(load, /if \(recovered && recovered !== documentText\) \{\s*documentText = recovered;\s*tab\.dirty = true;/, '恢复副本算未保存修改');
  assert.match(load, /let documentText = tab\.text \|\| init\.document\.text;/, '内存副本优先于磁盘');
});

test('外部改写 + 本地未保存：三选后按结果保留本地或重新读盘', () => {
  const source = read('src/renderer/document-lifecycle.ts');
  assert.match(source, /resolveExternalChange\?\(uri: string\): Promise<'local' \| 'disk'>/);
  const reload = source.slice(source.indexOf('async function reloadDocuments('), source.indexOf('const documentLoads = new Map'));
  assert.match(reload, /if \(tab\.dirty\) \{[\s\S]*?const choice = deps\.resolveExternalChange \? await deps\.resolveExternalChange\(uri\) : 'local';/);
  assert.match(reload, /if \(choice !== 'disk'\) \{\s*skipped\.push\(uri\);\s*continue;/, '保留本地 → 报成跳过（照旧提示）');
  assert.match(reload, /workspace\.cancelAutoSave\(uri\);\s*workspace\.setDocumentText\(uri, ''\);/, '使用磁盘版本 → 丢掉内存副本重新读盘');
  assert.match(reload, /runtime\.init = undefined;/, '并让运行时缓存失效');
});

test('恢复副本：每次改动留档、写盘即清、按文档隔离', () => {
  const host = read('src/renderer/editor-host.ts');
  assert.match(host, /recordRecovery\?: \(uri: string, text: string, dirty: boolean\) => void/);
  assert.match(host, /recordRecovery\?\.\(targetUri, text, message\.dirty !== false\)/, '正文变化即留档（带脏标记）');
  const workspace = read('src/renderer/workspace.ts');
  assert.match(workspace, /onDocumentSaved\?: \(uri: string\) => void/);
  assert.match(workspace, /deps\.onDocumentSaved\?\.\(uri\);/, '写盘成功回调');
  const main = read('src/renderer/main.ts');
  assert.match(main, /onDocumentSaved: \(uri\) => recovery\.clear\(uri\)/, '落盘即清恢复副本');
  assert.match(main, /recordRecovery: \(uri, text, dirty\) => recovery\.record\(uri, text, dirty\)/);
  assert.match(main, /const recovery = createRecoveryStore\(\);/, '恢复库在壳层只建一份');
  assert.match(main, /const recoveryAsked = new Set<string>\(\);/, '同一文档一次会话只问一次');
});

test('崩溃恢复与外部变化都用统一确认弹窗，并给出对比正文', () => {
  const main = read('src/renderer/main.ts');
  const recovery = main.slice(main.indexOf('async function resolveRecoveryDraft'), main.indexOf('async function resolveExternalChangeDraft'));
  assert.match(recovery, /title: '发现未保存的恢复副本'/);
  assert.match(recovery, /confirmLabel: '恢复未保存内容'/);
  assert.match(recovery, /cancelLabel: '用磁盘版本'/);
  assert.match(recovery, /recovery\.clear\(uri\)/, '用户放弃恢复时清掉副本');
  assert.match(recovery, /summarizeTextDiff\(snapshot\.text, diskText, 5\)/, '弹窗里先给差异摘要');

  const external = main.slice(main.indexOf('async function resolveExternalChangeDraft'), main.indexOf('const editorHost = createEditorHost('));
  assert.match(external, /extra: \{ label: '对比', value: 'compare' \}/, '第三个动作是「对比」');
  assert.match(external, /confirmLabel: '使用磁盘版本'/);
  assert.match(external, /cancelLabel: '保留本地'/);
  assert.match(external, /danger: true/, '用磁盘版会覆盖本地，按危险操作呈现');
  assert.match(external, /for \(;;\)/, '选「对比」后留在弹窗里继续选');

  // 差异摘要本身：行数变化 + 前几处不同。
  assert.match(main, /function summarizeTextDiff\(localText: string, diskText: string, limit = 8\)/);
  assert.match(main, /- \$\{at\}  磁盘：/);
  assert.match(main, /\+ \$\{at\}  本地：/);
});

test('三选与恢复都是「先问再做」：不会静默覆盖任何一边', () => {
  const lifecycle = read('src/renderer/document-lifecycle.ts');
  // 加载路径：只有用户选择恢复时才替换正文。
  assert.match(lifecycle, /const recovered = await deps\.resolveRecovery/);
  assert.doesNotMatch(lifecycle, /documentText = recovery\./, '生命周期不认识恢复库本身，只认注入的选择器');
  // 外部改写：本地未保存时一定经过选择器。
  assert.match(lifecycle, /const choice = deps\.resolveExternalChange \? await deps\.resolveExternalChange\(uri\) : 'local';/);
  const main = read('src/renderer/main.ts');
  assert.match(main, /resolveExternalChange: \(uri\) => resolveExternalChangeDraft\(uri\)/);
  assert.match(main, /resolveRecovery: \(uri, diskText\) => resolveRecoveryDraft\(uri, diskText\)/);
});

test('阶段 8：菜单与快捷键指向同一条命令', () => {
  const shortcuts = read('public/shortcuts/shortcuts.js');
  assert.match(shortcuts, /editor\.viewportBack[^\n]*alt\+arrowleft/);
  assert.match(shortcuts, /editor\.viewportForward[^\n]*alt\+arrowright/);
  assert.match(shortcuts, /editor\.nextIssue[^\n]*'f8'/);
  assert.match(shortcuts, /editor\.previousIssue[^\n]*'shift\+f8'/);
  const bridge = read('src/canvas/interactions/input-bridge.ts');
  assert.match(bridge, /matchesShortcut\(event, 'editor\.viewportBack'\)[^\n]*executeEditorCommand\('viewportBack'\)/);
  assert.match(bridge, /matchesShortcut\(event, 'editor\.viewportForward'\)[^\n]*executeEditorCommand\('viewportForward'\)/);
  const editor = read('src/canvas/editor.ts');
  assert.match(editor, /label: '画布后退 \(Alt\+←\)'/, '右键菜单标出同样的键');
  assert.match(editor, /label: '画布前进 \(Alt\+→\)'/);
  assert.match(editor, /label: '重建布局（只动坐标）'/);
  const toolbar = read('src/canvas/toolbar.ts');
  assert.match(toolbar, /label: '下一个问题 \(F8\)'/);
  assert.match(toolbar, /label: '上一个问题 \(Shift\+F8\)'/);
  assert.match(toolbar, /label: '重建布局（只动坐标）'/);
});
