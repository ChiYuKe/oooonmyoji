const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePythonRuntime, pythonUtf8Environment } = require('../dist-electron/main/core/runtimeInstances.js');

test('随包 Python 优先于 venv，接收者不需要安装 Python', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-python-'));
  const bundled = path.join(root, 'tools', 'python312-embed', 'python.exe');
  const venv = path.join(root, '.venv', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(bundled), {recursive: true});
  fs.mkdirSync(path.dirname(venv), {recursive: true});
  fs.writeFileSync(bundled, '');
  fs.writeFileSync(venv, '');
  assert.equal(resolvePythonRuntime(root, {}), bundled);
});

test('首次初始化下载的运行环境优先于安装目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-project-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-runtime-'));
  const downloaded = path.join(runtime, 'tools', 'python312-embed', 'python.exe');
  fs.mkdirSync(path.dirname(downloaded), {recursive: true});
  fs.mkdirSync(path.join(runtime, '.paddlex'));
  fs.writeFileSync(downloaded, '');
  assert.equal(resolvePythonRuntime(root, {ONMYOJI_RUNTIME_ROOT: runtime}), downloaded);
  const environment = pythonUtf8Environment({ONMYOJI_RUNTIME_ROOT: runtime}, root);
  assert.equal(environment.PADDLE_PDX_CACHE_HOME, path.join(runtime, '.paddlex'));
});

test('Python 路径支持显式覆盖并隔离用户 site-packages', () => {
  const configured = path.resolve('custom-python.exe');
  assert.equal(resolvePythonRuntime('missing-project', {ONMYOJI_PYTHON: configured}), configured);
  const environment = pythonUtf8Environment({PATH: 'test'});
  assert.equal(environment.PYTHONUTF8, '1');
  assert.equal(environment.PYTHONNOUSERSITE, '1');
});

test('随包模型缓存存在时固定 PaddleX 缓存目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-model-cache-'));
  fs.mkdirSync(path.join(root, '.paddlex'));
  const environment = pythonUtf8Environment({}, root);
  assert.equal(environment.PADDLE_PDX_CACHE_HOME, path.join(root, '.paddlex'));
});
