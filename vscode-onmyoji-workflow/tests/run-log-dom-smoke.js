/* Minimal DOM smoke test for the dedicated run log webview. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) { const add = force === undefined ? !this.values.has(value) : force; if (add) this.values.add(value); else this.values.delete(value); return add; }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.classList = new ClassList(); this.dataset = {};
    this.textContent = ''; this._listeners = {}; this.checked = false; this.scrollTop = 0; this.src = ''; this.alt = '';
  }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  set innerHTML(_value) { this.children = []; this.textContent = ''; }
  get innerHTML() { return ''; }
  get scrollHeight() { return this.children.length * 60 + this.textContent.length; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); }
  setAttribute(name, value) { this[name] = String(value); }
}

const ids = [
  'workflow-name', 'run-meta', 'status-label', 'elapsed', 'completed-count', 'failed-count', 'current-step',
  'source-tabs',
  'reward-summary', 'reward-totals', 'reward-battles',
  'tab-steps', 'tab-engine', 'auto-scroll', 'btn-stop', 'btn-clear', 'steps-view', 'engine-view', 'empty-state',
  'cap-note',
  'step-list', 'engine-output', 'lightbox', 'lightbox-close', 'lightbox-image',
];
const elements = Object.fromEntries(ids.map((id) => [id, new Element(id === 'auto-scroll' ? 'input' : 'div')]));
elements['auto-scroll'].checked = true;
const filters = ['tasks', 'all', 'failed'].map((name) => { const item = new Element('button'); item.dataset.filter = name; return item; });
const body = new Element('body');
const documentStub = {
  body,
  getElementById: (id) => elements[id],
  createElement: (tag) => new Element(tag),
  querySelectorAll: (selector) => selector === '#filters button' ? filters : [],
};
const windowStub = { _listeners: {}, addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); } };
const posted = [];
const vscodeStub = { postMessage(message) { posted.push(message); } };
const fire = (element, type, values = {}) => { for (const listener of element._listeners[type] || []) listener({ target: element, ...values }); };
const send = (data) => { for (const listener of windowStub._listeners.message || []) listener({ data }); };
const childWithClass = (element, className) => element.children.find((child) => child.classList.contains(className));
const descendantsWithClass = (element, className) => {
  const found = [];
  for (const child of element.children) {
    if (child.classList.contains(className)) found.push(child);
    found.push(...descendantsWithClass(child, className));
  }
  return found;
};

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'run-log.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub,
  setInterval: () => 1, Date, Number, String, Math, console,
}, { filename: 'run-log.js' });

let passed = 0;
const check = (name, condition) => { if (!condition) throw new Error(name); passed += 1; };
check('初始化请求日志数据', posted.some((message) => message.type === 'ready'));

send({
  type: 'init',
  descriptor: { workflow: 'mumu_1_souls_loop.json', instance: 'mumu-1', startedAt: Date.now(), status: 'starting' },
  engineOutput: '\u001b[31mengine line\u001b[0m\n',
  events: [
    { type: 'run_started', run_id: 'run-1', instance_id: 'mumu-1', status: 'running', ts: 100 },
    { type: 'step', step_id: 'root', ts: 100.1, step: { status: 'running', execution_index: 0, node_kind: 'root' } },
    { type: 'step', step_id: 'tap_ready', ts: 100.2, step: { status: 'running', name: '点击准备', execution_index: 1, node_kind: 'task', action: 'input.tap_match', params: { match: { template: 'assets/templates/souls/ready.png' }, revalidate: true } } },
    { type: 'step', step_id: 'tap_ready', ts: 100.3, step: { status: 'succeeded', name: '点击准备', execution_index: 1, node_kind: 'task', action: 'input.tap_match', duration_ms: 123.4, params: { match: { template: 'assets/templates/souls/ready.png' }, revalidate: true }, output: { x: 1774, y: 891, offset_x: 2, offset_y: -1, interval_seconds: 0.2, revalidated: true } } },
  ],
});

check('显示工作流与实例', elements['workflow-name'].textContent === 'mumu_1_souls_loop.json' && elements['run-meta'].textContent.includes('mumu-1'));
check('默认只显示 Task 时间线', elements['step-list'].children.length === 1 && elements['step-list'].children[0].dataset.stepId === 'tap_ready');
check('任务标题只显示节点名称', elements['step-list'].children[0].children[1].children[0].children[0].textContent === '点击准备');
const tapRow = elements['step-list'].children[0];
check('点击节点显示动作目标和实际结果', childWithClass(tapRow.children[1], 'step-operation').textContent === '点击匹配位置：ready.png'
  && childWithClass(tapRow.children[1], 'step-facts').children.some((child) => child.textContent === '实际坐标 (1774, 891)'));
check('完成状态与实际耗时同时显示', tapRow.children[2].children[0].textContent === '已完成' && tapRow.children[2].children[1].textContent === '123 ms');
check('完整参数与输出可以展开查看', descendantsWithClass(tapRow, 'detail-value').some((child) => child.textContent.includes('"revalidate": true'))
  && descendantsWithClass(tapRow, 'detail-value').some((child) => child.textContent.includes('"x": 1774')));
check('汇总成功任务数量', elements['completed-count'].textContent === '1');
check('引擎输出移除 ANSI 控制码', elements['engine-output'].textContent === 'engine line\n');
check('未超限时隐藏行数提示', elements['cap-note'].classList.contains('hidden'));

send({ type: 'runEvent', event: {
  type: 'reward_stats', run_id: 'run-1', battle_index: 1, layer: 1, status: 'succeeded', ts: 100.8, screenshot: 'reward.png',
  items: [{ id: 'soul_hanafuda', name: '御魂花札', quantity: 2 }, { id: 'coin', name: '金币', quantity: 1683 }],
  material_totals: { soul_hanafuda: { name: '御魂花札', quantity: 2 }, coin: { name: '金币', quantity: 1683 } },
} });
const rewardRow = elements['step-list'].children.find((item) => item.classList.contains('reward'));
check('逐局材料统计进入任务时间线', Boolean(rewardRow) && rewardRow.children[1].children.some((child) => child.textContent.includes('御魂花札 ×2')));
check('顶部显示本次累计材料', !elements['reward-summary'].classList.contains('hidden') && elements['reward-totals'].children.length === 2 && elements['reward-battles'].textContent === '1 局');
check('奖励统计不改变已完成任务计数', elements['completed-count'].textContent === '1');

send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_floor_direct', ts: 100.9, step: { status: 'running', execution_index: 2, node_kind: 'task', action: 'vision.wait_template' } } });
check('旧事件缺少名称时不显示内部 ID', elements['current-step'].textContent === '未命名任务');
send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_floor_direct', ts: 101, step: { status: 'failed', started_at: 100.9, execution_index: 2, node_kind: 'task', action: 'vision.wait_template', duration_ms: 100, error: 'timeout' } } });
check('Selector 分支恢复前仍暂记失败', elements['failed-count'].textContent === '1');
send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_floor_direct', ts: 101.1, step: { status: 'branch_miss', original_status: 'failed', recovered_by: 'settlement', started_at: 100.9, execution_index: 2, node_kind: 'task', action: 'vision.wait_template', duration_ms: 100, error: 'timeout' } } });
const branchMissRows = elements['step-list'].children.filter((item) => item.dataset.stepId === 'wait_floor_direct');
check('恢复失败合并为分支跳过', branchMissRows.length === 1 && branchMissRows[0].classList.contains('branch_miss') && branchMissRows[0].children[2].children[0].textContent === '分支跳过');
check('分支跳过显示语义原因并保留耗时', childWithClass(branchMissRows[0].children[1], 'step-note').textContent.includes('跳过原因')
  && branchMissRows[0].children[2].children[1].textContent === '100 ms');
check('分支未命中不计入失败数', elements['failed-count'].textContent === '0');

send({ type: 'runEvent', event: { type: 'run_started', run_id: 'run-2', status: 'running', ts: 101.2 } });
send({ type: 'runEvent', event: { type: 'step', run_id: 'run-2', step_id: 'task_1', ts: 101.3, step: { status: 'running', workflow_id: 'task_in_souls', workflow_path: ['task_in_souls'], execution_index: 3, node_kind: 'task', action: 'vision.match_template' } } });
send({ type: 'runEvent', event: { type: 'step', run_id: 'run-2', step_id: 'task_1', ts: 101.4, step: { status: 'failed', workflow_id: 'task_in_souls', workflow_path: ['task_in_souls'], started_at: 101.3, execution_index: 3, node_kind: 'task', action: 'vision.match_template', duration_ms: 100, error_category: 'not_matched', error: 'template not matched' } } });
send({ type: 'runEvent', event: { type: 'step', run_id: 'run-2', step_id: 'task_1', ts: 101.5, step: { status: 'branch_miss', original_status: 'failed', recovered_by: 'selector_1', workflow_id: 'task_in_souls', workflow_path: ['task_in_souls'], started_at: 101.3, execution_index: 3, node_kind: 'task', action: 'vision.match_template', duration_ms: 100, error_category: 'not_matched', error: 'template not matched' } } });
const recoveredMatchRows = elements['step-list'].children.filter((item) => item.dataset.stepId === 'task_1');
check('模板未匹配恢复后只保留一条分支跳过记录', recoveredMatchRows.length === 1
  && recoveredMatchRows[0].classList.contains('branch_miss')
  && recoveredMatchRows[0].children[2].children[0].textContent === '分支跳过'
  && elements['failed-count'].textContent === '0');

send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_victory', ts: 102, step: { status: 'running', execution_index: 3, node_kind: 'task', action: 'vision.wait_template' } } });
send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_victory', ts: 103, step: { status: 'failed', started_at: 102, execution_index: 3, node_kind: 'task', action: 'vision.wait_template', duration_ms: 1000, error: 'timeout' } } });
fire(filters[2], 'click');
check('失败筛选只保留失败节点', elements['step-list'].children.length === 1 && elements['step-list'].children[0].dataset.stepId === 'wait_victory');
check('失败计数与错误详情更新', elements['failed-count'].textContent === '1' && elements['step-list'].children[0].children[1].children.some((child) => child.textContent === '失败原因：timeout'));

send({
  type: 'init',
  descriptor: { workflow: 'parent.json', instance: 'mumu-0', startedAt: Date.now(), status: 'running' },
  events: [
    { type: 'run_started', run_id: 'match-run', instance_id: 'mumu-0', status: 'running', ts: 150 },
    { type: 'step', step_id: 'match_ok', ts: 151, step: { status: 'succeeded', name: '检查准备按钮', workflow_id: 'parent', workflow_path: ['parent'], workflow_depth: 0, execution_index: 1, node_kind: 'task', action: 'vision.match_template', duration_ms: 18, params: { template: 'assets/templates/souls/ready.png', roi: [1500, 700, 400, 300], threshold: 0.85 }, output: [{ template: 'assets/templates/souls/ready.png', confidence: 0.963, threshold: 0.85, roi: [1500, 700, 400, 300] }] } },
    { type: 'step', step_id: 'match_miss', ts: 152, step: { status: 'failed', name: '检查结束按钮', workflow_id: 'child', workflow_path: ['parent', 'child'], workflow_depth: 1, execution_index: 1, node_kind: 'task', action: 'vision.match_template', duration_ms: 21, params: { template: 'assets/templates/souls/end.png', threshold: 0.9 }, output: [], error_category: 'not_matched', error: 'template not matched' } },
  ],
});
fire(filters[0], 'click');
const matchedRow = elements['step-list'].children.find((item) => item.dataset.stepId === 'match_ok');
const missedRow = elements['step-list'].children.find((item) => item.dataset.stepId === 'match_miss');
check('模板结果区分已匹配和未匹配', matchedRow.classList.contains('matched') && missedRow.classList.contains('not_matched')
  && matchedRow.children[2].children[0].textContent === '已匹配' && missedRow.children[2].children[0].textContent === '未匹配');
check('模板节点显示目标、ROI、阈值和置信度', childWithClass(matchedRow.children[1], 'step-operation').textContent === '匹配模板：ready.png'
  && childWithClass(matchedRow.children[1], 'step-facts').children.map((child) => child.textContent).join('|').includes('ROI [1500, 700, 400, 300]')
  && childWithClass(matchedRow.children[1], 'step-facts').children.map((child) => child.textContent).join('|').includes('最高匹配 96.3%'));
check('匹配状态不会遮住节点耗时', matchedRow.children[2].children[0].textContent === '已匹配' && matchedRow.children[2].children[1].textContent === '18 ms');
check('子工作流节点显示调用路径且不与主流程节点混淆', missedRow.children[1].children[0].children.some((child) => child.classList.contains('step-workflow') && child.textContent === 'parent > child'));
check('未匹配计入失败而匹配计入完成', elements['completed-count'].textContent === '1' && elements['failed-count'].textContent === '1');

send({
  type: 'init',
  descriptor: { workflow: 'parent.json', instance: 'mumu-0', startedAt: Date.now(), status: 'running' },
  events: [
    { type: 'run_started', run_id: 'nested-run', instance_id: 'mumu-0', status: 'running', ts: 160 },
    { type: 'step', step_id: 'run_child', ts: 160.1, step: { status: 'running', name: '进入御魂挑战界面', workflow_id: 'parent', workflow_path: ['parent'], workflow_depth: 0, execution_index: 1, node_kind: 'task', action: 'workflow.run' } },
    { type: 'step', step_id: 'probe', ts: 160.2, step: { status: 'failed', name: '看到御魂挑战', workflow_id: 'child', workflow_path: ['parent', 'child'], workflow_depth: 1, started_at: 160.15, execution_index: 1, node_kind: 'task', action: 'vision.match_template', duration_ms: 50, error_category: 'not_matched', error: 'template not matched' } },
    { type: 'step', step_id: 'wait', ts: 160.4, step: { status: 'failed', name: '匹配御魂选项', workflow_id: 'child', workflow_path: ['parent', 'child'], workflow_depth: 1, started_at: 160.25, execution_index: 2, node_kind: 'task', action: 'vision.wait_template', duration_ms: 150, error: 'timeout' } },
    { type: 'step', step_id: 'run_child', ts: 160.5, step: { status: 'failed', name: '进入御魂挑战界面', workflow_id: 'parent', workflow_path: ['parent'], workflow_depth: 0, started_at: 160.1, execution_index: 1, node_kind: 'task', action: 'workflow.run', duration_ms: 400, error: 'subworkflow child failed', output: { workflow: 'child.json', status: 'failed' } } },
    { type: 'step', step_id: 'run_child', ts: 160.6, step: { status: 'branch_miss', original_status: 'failed', recovered_by: 'choose', recovered_by_name: '选择进入方式', name: '进入御魂挑战界面', workflow_id: 'parent', workflow_path: ['parent'], workflow_depth: 0, started_at: 160.1, execution_index: 1, node_kind: 'task', action: 'workflow.run', duration_ms: 400, params: { workflow: 'child.json' }, error: 'subworkflow child failed', output: { workflow: 'child.json', status: 'failed' } } },
  ],
});
const nestedRows = elements['step-list'].children.filter((item) => ['run_child', 'probe', 'wait'].includes(item.dataset.stepId));
check('外层子工作流分支恢复会降级全部失败后代', nestedRows.length === 3
  && nestedRows.every((item) => item.classList.contains('branch_miss'))
  && elements['failed-count'].textContent === '0');
check('分支跳过不显示原始失败文案', nestedRows.every((item) => !item.children[1].children.some((child) => child.classList.contains('step-error'))));
check('子工作流节点显示调用目标和选择器名称', childWithClass(nestedRows[0].children[1], 'step-operation').textContent === '运行子工作流：child'
  && childWithClass(nestedRows[0].children[1], 'step-note').textContent.includes('选择进入方式'));

send({
  type: 'init',
  descriptor: {
    workflow: '组队御魂', instance: '2 个实例', startedAt: Date.now(), status: 'starting',
    sources: [
      { id: 'leader', label: '队长', workflow: 'leader.json', instance: 'mumu-0', startedAt: Date.now(), status: 'starting' },
      { id: 'member', label: '队员', workflow: 'member.json', instance: 'mumu-1', startedAt: Date.now(), status: 'starting' },
    ],
  },
  events: [
    { log_source: 'leader', type: 'run_started', run_id: 'leader-1', instance_id: 'mumu-0', status: 'running', ts: 200 },
    { log_source: 'leader', type: 'step', step_id: 'leader_task', ts: 201, step: { status: 'succeeded', execution_index: 1, node_kind: 'task', action: 'core.log', duration_ms: 20 } },
    { log_source: 'leader', type: 'reward_stats', battle_index: 1, status: 'succeeded', ts: 202, items: [{ id: 'coin', name: '金币', quantity: 10 }], material_totals: { coin: { name: '金币', quantity: 10 } } },
    { log_source: 'member', type: 'run_started', run_id: 'member-1', instance_id: 'mumu-1', status: 'running', ts: 200 },
    { log_source: 'member', type: 'step', step_id: 'member_task_1', ts: 201, step: { status: 'succeeded', execution_index: 1, node_kind: 'task', action: 'core.log', duration_ms: 20 } },
    { log_source: 'member', type: 'step', step_id: 'member_task_2', ts: 202, step: { status: 'succeeded', execution_index: 2, node_kind: 'task', action: 'core.log', duration_ms: 20 } },
    { log_source: 'member', type: 'reward_stats', battle_index: 1, status: 'succeeded', ts: 203, items: [{ id: 'coin', name: '金币', quantity: 20 }], material_totals: { coin: { name: '金币', quantity: 20 } } },
  ],
});
check('组队日志显示队长和队员页签', !elements['source-tabs'].classList.contains('hidden') && elements['source-tabs'].children.length === 2);
check('默认只统计队长数据', elements['completed-count'].textContent === '1' && elements['workflow-name'].textContent.includes('队长'));
fire(elements['source-tabs'].children[1], 'click');
check('切换队员后显示独立任务统计', elements['completed-count'].textContent === '2' && elements['workflow-name'].textContent.includes('队员'));
check('队员材料累计与队长分离', elements['reward-totals'].children[0].children[1].textContent === '×20');

send({
  type: 'init',
  descriptor: {
    workflow: 'three.json', instance: '3 个实例', startedAt: Date.now(), status: 'failed',
    sources: [
      { id: 'zero', label: 'mumu-0', workflow: 'zero.json', instance: 'mumu-0', startedAt: Date.now(), status: 'failed' },
      { id: 'one', label: 'mumu-1', workflow: 'one.json', instance: 'mumu-1', startedAt: Date.now(), status: 'failed' },
      { id: 'two', label: 'mumu-2', workflow: 'two.json', instance: 'mumu-2', startedAt: Date.now(), status: 'failed' },
    ],
  },
  events: [],
  engineOutput: '无法启动：未发现运行实例 mumu-2\n',
  processResult: { code: 2, signal: null, stopped: false },
});
check('打开已失败运行时不会永久显示正在启动', elements['status-label'].textContent === '失败'
  && elements['source-tabs'].children.every((item) => item.children[0].classList.contains('failed')));
check('启动期失败且没有步骤时自动显示引擎错误', windowStub.__runLog.state.view === 'engine'
  && elements['engine-output'].textContent.includes('未发现运行实例 mumu-2'));

send({
  type: 'init',
  descriptor: {
    workflow: 'two.json', instance: '2 个实例', startedAt: Date.now(), status: 'starting',
    sources: [
      { id: 'zero', label: 'mumu-0', workflow: 'zero.json', instance: 'mumu-0', startedAt: Date.now(), status: 'starting' },
      { id: 'one', label: 'mumu-1', workflow: 'one.json', instance: 'mumu-1', startedAt: Date.now(), status: 'starting' },
    ],
  },
  events: [], engineOutput: '',
});
check('下一次运行按当前 runs 数量清掉旧页签', elements['source-tabs'].children.length === 2);

fire(elements['btn-stop'], 'click');
fire(elements['btn-clear'], 'click');
check('停止与清空命令可用', posted.some((message) => message.type === 'stopWorkflow') && posted.some((message) => message.type === 'clear'));

send({
  type: 'init',
  descriptor: { workflow: 'once.json', instance: 'mumu-0', startedAt: Date.now(), status: 'running' },
  events: [
    { type: 'run_started', run_id: 'once-run', instance_id: 'mumu-0', status: 'running', ts: 250 },
    { type: 'step', step_id: 'once_task', ts: 251, step: { status: 'succeeded', execution_index: 1, node_kind: 'task', action: 'core.log', duration_ms: 12 } },
    { type: 'step', step_id: 'once_task', ts: 252, step: { status: 'succeeded', started_at: 251.8, execution_index: 1, node_kind: 'task', action: 'core.log', decorator: 'do_once', duration_ms: 1 } },
  ],
});
const onceRows = elements['step-list'].children.filter((item) => item.dataset.stepId === 'once_task');
const onceSkipRow = onceRows.find((item) => {
  const facts = childWithClass(item.children[1], 'step-facts');
  return facts !== undefined && facts.children.map((child) => child.textContent).join('|').includes('Do Once');
});
check('Do Once 跳过行显示事实而不计入重复', onceRows.length === 2 && onceSkipRow !== undefined
  && elements['completed-count'].textContent === '2');

send({
  type: 'init',
  descriptor: { workflow: 'soak.json', instance: 'mumu-0', startedAt: Date.now(), status: 'running' },
  events: [
    { type: 'run_started', run_id: 'soak-run', instance_id: 'mumu-0', status: 'running', ts: 300 },
    ...Array.from({ length: 305 }, (_, index) => ({
      type: 'step', step_id: `soak_${index}`, ts: 301 + index / 10,
      step: { status: 'succeeded', name: `任务 ${index}`, execution_index: index + 1, node_kind: 'task', action: 'core.log', duration_ms: 5 },
    })),
  ],
});
check('超出行数上限只渲染最新 300 行', elements['step-list'].children.length === 300);
check('行数提示显示总数', !elements['cap-note'].classList.contains('hidden') && elements['cap-note'].textContent === '仅显示最新 300 行 · 共 305 条');
check('超限后统计仍按全部行计算', elements['completed-count'].textContent === '305');
fire(filters[2], 'click');
check('筛选后行数不超过上限且未超限时隐藏提示', elements['step-list'].children.length === 0 && elements['cap-note'].classList.contains('hidden'));

console.log(`RUN LOG DOM SMOKE OK (${passed} checks)`);
