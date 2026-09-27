/**
 * 动作/参数/输出字段的中文显示名覆盖：清单里声明的每个内置动作都必须在
 * `ACTION_LABELS` 里有中文名，否则动作下拉会退回裸 `instance.wait_signal` 这种 id，
 * 和旁边「点击匹配项 / input.tap_match」的样式不统一（detail 行也会被吞掉）。
 *
 * 同理，参数与输出字段缺中文名时，详情栏和引用提示会显示原始英文键名。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Labels = require('../dist-test-renderer/canvas/ui/labels.js');

const MANIFESTS = path.join(__dirname, '..', '..', 'src', 'oooonmyoji', 'actions', 'manifests');

function readManifests() {
  return fs.readdirSync(MANIFESTS)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(MANIFESTS, file), 'utf8')));
}

test('每个内置动作都有中文显示名', () => {
  const missing = readManifests()
    .map((manifest) => manifest.name)
    .filter((name) => !Object.prototype.hasOwnProperty.call(Labels.ACTION_LABELS, name));

  assert.deepEqual(missing, [], `这些动作缺少 ACTION_LABELS 中文名，会退回裸 id：${missing.join(', ')}`);
});

test('动作中文名不等于动作 id（防止复制粘贴占位）', () => {
  const identity = Object.entries(Labels.ACTION_LABELS)
    .filter(([name, label]) => name === label)
    .map(([name]) => name);

  assert.deepEqual(identity, []);
});

test('每个动作参数都有中文名', () => {
  const missing = [];
  for (const manifest of readManifests()) {
    for (const param of Object.keys(manifest.parameters || {})) {
      if (Labels.fieldLabel(param) === param) missing.push(`${manifest.name}.${param}`);
    }
  }

  assert.deepEqual(missing, [], `这些参数缺少 FIELD_LABELS 中文名：${missing.join(', ')}`);
});

test('每个动作输出字段都有中文名', () => {
  const missing = [];
  for (const manifest of readManifests()) {
    const properties = (manifest.outputs && manifest.outputs.properties) || {};
    for (const field of Object.keys(properties)) {
      if (Labels.outputFieldLabel(field) === field) missing.push(`${manifest.name}.${field}`);
    }
  }

  assert.deepEqual(missing, [], `这些输出字段缺少中文名：${missing.join(', ')}`);
});
