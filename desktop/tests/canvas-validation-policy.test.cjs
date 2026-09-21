// Run via npm test (builds the renderer test output first).
// 阶段 6：校验与保存策略。
// - 编辑器侧提醒（advisories）不进共享校验契约，只服务编辑器；
// - 保存只在「运行时会拒绝的错误」上拦，提醒一律放行；
// - 画布把待确认内容交给宿主，用户坚持保存才回写。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { editorAdvisories } = require('../dist-test-renderer/canvas/model/advisories.js');

test('编辑器提醒：缺说明与未被引用的变量/输入各给一条 warning', () => {
  const issues = editorAdvisories({
    description: '',
    inputs: { 目标: { type: 'asset' }, '阈值 · 初始值': { type: 'number', _autoPublished: true } },
    variables: { 计数: { type: 'integer', default: 0 }, 没用过: { type: 'string', default: '' } },
  }, {
    // 「目标」与「计数」都被引用过；自动镜像输入与「没用过」都没人引用。
    referenceCount: (scope, name) => (
      (scope === 'inputs' && name === '目标') || (scope === 'variables' && name === '计数') ? 2 : 0
    ),
  });
  const codes = issues.map((issue) => `${issue.code}:${issue.path.join('.')}`);
  assert.deepEqual(codes, [
    'missing-description:description',
    'unused-variable:variables.没用过',
  ]);
  for (const issue of issues) {
    assert.equal(issue.severity, 'warning', '全部都是提醒，不阻止保存');
    assert.ok(issue.message, '提醒必须有可读文案');
  }
});

test('有说明、全部变量都被引用时没有任何提醒', () => {
  const issues = editorAdvisories({
    description: '自动刷副本',
    inputs: { 目标: { type: 'asset' } },
    variables: { 计数: { type: 'integer', default: 0 } },
  }, { referenceCount: () => 1 });
  assert.deepEqual(issues, []);
});

test('提醒只读不写：坏输入不抛、不改文档', () => {
  assert.deepEqual(editorAdvisories(null), []);
  assert.deepEqual(editorAdvisories('nope'), []);
  assert.deepEqual(editorAdvisories([]), []);
  const raw = { inputs: 'nope', variables: null };
  const snapshot = JSON.stringify(raw);
  editorAdvisories(raw, { referenceCount: () => 0 });
  assert.equal(JSON.stringify(raw), snapshot, '提醒是纯计算');
  // 没有注入引用统计时只说「缺说明」，不瞎报未使用。
  assert.deepEqual(editorAdvisories({ inputs: { a: { type: 'string' } } }).map((issue) => issue.code), ['missing-description']);
});

test('保存策略：只拦运行时会拒绝的错误，提醒放行', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  const requestSave = editor.slice(editor.indexOf('function requestSave()'), editor.indexOf('function commitSave('));
  assert.match(requestSave, /splitBySeverity\(documentIssueList\(\)\)/, '保存按严重度拆分问题');
  assert.match(requestSave, /if \(!errors\.length\) \{\s*commitSave\(warnings\.length\);\s*return;/, '没有错误就直接保存（提醒只是提示）');
  assert.match(requestSave, /type: 'saveBlockedRequested'/, '有错误时请宿主弹统一确认框');
  // 画布收到宿主的确认结果后由 forceSave 真正写盘（确认框在宿主侧，见下一个用例）。
  assert.match(editor, /forceSave: \(\) => commitSave\(0, splitBySeverity\(documentIssueList\(\)\)\.errors\.length\)/);
  assert.match(editor, /function commitSave\(warnings = 0, forcedErrors = 0\)/, '写盘入口带提醒/强行保存计数');
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/state/editor-command-dispatch.ts'), 'utf8');
  assert.match(dispatch, /command === 'save'\) requestSave\(\)/, 'save 命令走把关入口');
  assert.match(dispatch, /command === 'forceSave'\) forceSave\(\)/);
  const toolbar = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/toolbar.ts'), 'utf8');
  assert.match(toolbar, /deps\.requestSave\(\)/, '工具栏保存按钮走同一条把关入口');
});

test('save 命令：有错误时不直接写盘，先请宿主确认', () => {
  const posted = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}},
    requestSave: () => posted.push('requestSave'),
    forceSave: () => posted.push('forceSave'),
    gotoIssue: (step) => posted.push(`gotoIssue:${step}`),
  });
  dispatch.executeEditorCommand('save');
  dispatch.executeEditorCommand('forceSave');
  dispatch.executeEditorCommand('nextIssue');
  dispatch.executeEditorCommand('previousIssue');
  assert.deepEqual(posted, ['requestSave', 'forceSave', 'gotoIssue:1', 'gotoIssue:-1']);
});

test('宿主侧：保存被拦下时弹统一确认框，只有确认才回发 forceSave', () => {
  const host = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/editor-host.ts'), 'utf8');
  const block = host.slice(host.indexOf("case 'saveBlockedRequested'"), host.indexOf("case 'sidebarStateChanged'"));
  assert.match(block, /showImpactConfirm/, '复用阶段 4 的统一确认弹窗');
  assert.match(block, /saveBlockedRequested/, '消息类型进窄化联合');
  assert.match(block, /command: 'forceSave'/, '确认后回画布写盘');
  assert.match(block, /danger: true/, '强行保存按危险操作呈现');
  const messages = fs.readFileSync(path.join(__dirname, '..', 'src/shared/editor-messages.ts'), 'utf8');
  assert.match(messages, /interface SaveBlockedRequestedMessage/);
  assert.match(messages, /'saveBlockedRequested',/);
  const impact = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/impact-confirm.ts'), 'utf8');
  assert.match(impact, /cancelLabel/, '确认框支持自定义取消文案（返回修改）');
});

test('问题导航：F8 / Shift+F8 接上命令，飞索在问题之间绕行', () => {
  const shortcuts = fs.readFileSync(path.join(__dirname, '..', 'public/shortcuts/shortcuts.js'), 'utf8');
  assert.match(shortcuts, /editor\.nextIssue[^\n]*defaultBinding: 'f8'/);
  assert.match(shortcuts, /editor\.previousIssue[^\n]*defaultBinding: 'shift\+f8'/);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/interactions/input-bridge.ts'), 'utf8');
  assert.match(bridge, /matchesShortcut\(event, 'editor\.nextIssue'\)[^\n]*executeEditorCommand\('nextIssue'\)/);
  assert.match(bridge, /matchesShortcut\(event, 'editor\.previousIssue'\)[^\n]*executeEditorCommand\('previousIssue'\)/);
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  const goto = editor.slice(editor.indexOf('function gotoIssue('), editor.indexOf('function requestSave('));
  assert.match(goto, /issueCursor = \(issueCursor \+ step \+ count\) % count/, '到头绕回另一端');
  assert.match(goto, /focusNode\(target\.nodeId, target\.param\)/, '定位节点时带上参数端点（闪烁那一行）');
  assert.match(goto, /state\.selectedEdge = \{ parent: target\.edgeParent, child: target\.edgeChild \}/, '结构问题选中那条连线');
});
