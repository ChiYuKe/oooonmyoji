/**
 * 主进程 Action 清单解析：`card` 声明必须与参数定义自洽，
 * 并且内置 manifest 能原样通过桌面侧校验（与 Python Registry 同一批文件）。
 *
 * 卡片声明坏掉时宁可报错，也不能让卡片悄悄少一个端点。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseActionCard, parseManifest, loadBuiltinActions } = require('../dist-electron/main/core/catalog.js');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PARAMETERS = {
  template: { type: 'asset', required: true },
  timeout_seconds: { type: 'duration', default: 5 },
  present: { type: 'boolean', default: true },
};

test('parseActionCard 按清单顺序给出端点并保留行选项', () => {
  const rows = parseActionCard('card.demo', {
    rows: [
      { param: 'template', label: '模板' },
      { param: 'timeout_seconds', label: '超时', control: 'number' },
      { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
    ],
  }, PARAMETERS);
  assert.deepEqual(rows, [
    { param: 'template', label: '模板' },
    { param: 'timeout_seconds', label: '超时', control: 'number' },
    { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
  ]);
  // 没声明 card 的清单得到空数组，编辑器据此退回「必填 + 已配置」卡片。
  assert.deepEqual(parseActionCard('card.demo', undefined, PARAMETERS), []);
  // hidden 只对可选参数有意义。
  assert.deepEqual(parseActionCard('card.demo', { rows: [{ param: 'template' }, { param: 'timeout_seconds', hidden: true }] }, PARAMETERS),
    [{ param: 'template' }, { param: 'timeout_seconds', hidden: true }]);
});

test('parseActionCard 拒绝与参数定义不一致的卡片声明', () => {
  const cases = [
    [{ rows: [{ param: 'nope' }] }, /unknown parameter nope/],
    [{ rows: [{ param: 'template' }, { param: 'template' }] }, /declared twice/],
    [{ rows: [{ param: 'template', hidden: true }] }, /required parameter template cannot be hidden/],
    [{ rows: [{ param: 'timeout_seconds' }] }, /must cover required parameters: template/],
    [{ rows: [] }, /must cover required parameters: template/],
    [{ rows: [{ label: '模板' }] }, /non-empty param/],
    [{ rows: [{ param: 'template', control: 'zoom' }] }, /unknown control: zoom/],
  ];
  for (const [card, message] of cases) {
    assert.throws(() => parseActionCard('card.demo', card, PARAMETERS), message, JSON.stringify(card));
  }
  // 形状错误由 JSON Schema 拦在 parseManifest 之前。
  assert.throws(() => parseManifest({
    schema_version: 2, name: 'card.demo', entry: 'builtin:X',
    parameters: PARAMETERS, card: { rows: [{ param: 'template' }], extra: 1 },
  }), /must NOT have additional properties/);
});

test('内置 manifest 全部能通过桌面侧解析并带上卡片端点', () => {
  const { actions, errors } = loadBuiltinActions(PROJECT_ROOT);
  assert.deepEqual(errors, []);
  assert.ok(actions.length >= 20, `内置 Action 数量异常：${actions.length}`);
  const byName = new Map(actions.map((action) => [action.name, action]));
  const waitTemplate = byName.get('vision.wait_template');
  assert.deepEqual(waitTemplate.card.map((row) => row.param),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
  assert.deepEqual(waitTemplate.card.map((row) => row.label),
    ['模板', '超时', '存在性', '识别区域', '匹配阈值', '多尺度搜索']);
  assert.equal(waitTemplate.card.find((row) => row.param === 'present').on_label, '等待出现');
  // 有参数的 Action 都声明了卡片；没参数的（core.capture）留空。
  const noCard = actions.filter((action) => !action.card.length).map((action) => action.name);
  assert.deepEqual(noCard, ['core.capture']);
  for (const action of actions) {
    for (const row of action.card) {
      assert.ok(action.parameters[row.param], `${action.name}: ${row.param}`);
    }
  }
  // 声明同样能从磁盘原始 JSON 复现：validate 命令与编辑器看到的是同一份清单。
  const raw = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'oooonmyoji', 'actions', 'manifests', 'vision.wait_template.json'), 'utf8'));
  assert.deepEqual(parseManifest(raw).card, waitTemplate.card);
});
