// Run via npm test (builds the desktop output first).
// 共享工作流规则样例：与 tests/test_workflow_rules_contract.py 使用同一份 cases.json，
// 校验编辑器诊断覆盖两端共同规则。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateWorkflow } = require('../dist-electron/shared/workflow/index.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'workflow-rules', 'cases.json'), 'utf8'));

const catalog = {
  byName: (name) => {
    const spec = fixture.actions[name];
    if (!spec) return undefined;
    return {
      inputSchema: spec.input_schema,
      outputSchema: spec.output_schema,
      parameters: {},
      retrySafe: Boolean(spec.retry_safe),
    };
  },
  names: () => Object.keys(fixture.actions),
};

for (const item of fixture.cases) {
  test(`共享规则样例：${item.name}`, () => {
    const issues = validateWorkflow(item.workflow, catalog);
    if (item.valid) {
      assert.deepEqual(issues, []);
      return;
    }
    assert.ok(issues.length > 0, 'invalid case must produce diagnostics');
    const codes = new Set(issues.map((issue) => issue.code));
    for (const code of item.desktop_codes ?? []) {
      assert.ok(codes.has(code), `缺少诊断 ${code}：${JSON.stringify(issues)}`);
    }
  });
}
