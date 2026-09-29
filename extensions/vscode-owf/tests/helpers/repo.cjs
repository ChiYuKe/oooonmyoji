/**
 * 仓库路径与夹具读取：测试要跨仓库访问 `workflows/`、`tests/fixtures/` 和桌面端产物，
 * 这里把「怎么找」集中一处，避免每个测试文件各自拼路径。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 仓库根：`extensions/vscode-owf/tests/helpers` 往上四层。 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** 扩展根目录。 */
const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');

/** 桌面端预编译产物（`npm run build:electron` 生成），用于逐字比对。 */
const CANONICAL_HEADLESS = path.join(
  REPO_ROOT,
  'desktop',
  'dist-electron',
  'shared',
  'workflow',
  'index.js',
);

/** 收集仓库里所有 `.owf`（排除 release / node_modules / 构建产物）。 */
function allWorkflowFiles() {
  /** @type {string[]} */
  const out = [];
  const skip = new Set(['node_modules', 'release', 'dist', 'dist-electron', '.git', '.venv']);

  /** @param {string} dir 目录。 */
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.owf')) {
        out.push(path.join(dir, entry.name));
      }
    }
  };

  for (const dir of ['workflows', 'tests/fixtures', 'artifacts', path.join('extensions', 'vscode-owf', 'tests', 'fixtures')]) {
    const abs = path.join(REPO_ROOT, dir);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out.sort();
}

/** 读 `tests/fixtures/graph-rules/cases.json` 里的契约用例。 */
function contractCases() {
  const file = path.join(REPO_ROOT, 'tests', 'fixtures', 'graph-rules', 'cases.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).cases || [];
}

/** 读一个真实工作流（统一成 LF，便于逐字比对）。 */
function readWorkflow(name) {
  const file = path.join(REPO_ROOT, 'workflows', name);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** 读一个共享 DSL 夹具（`tests/fixtures/dsl`，统一成 LF）。 */
function readFixture(name) {
  const file = path.join(REPO_ROOT, 'tests', 'fixtures', 'dsl', name);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

module.exports = { REPO_ROOT, EXTENSION_ROOT, CANONICAL_HEADLESS, allWorkflowFiles, contractCases, readWorkflow, readFixture };
