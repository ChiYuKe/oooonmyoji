const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-windows-portable.cjs'), 'utf8');
const initialScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-initial-installer.cjs'), 'utf8');

test('便携版与安装版携带主进程 AJV 依赖及其传递依赖', () => {
  assert.match(script, /copyRuntimePackage\('ajv', appRoot\)/);
  assert.match(script, /metadata\.dependencies/);
  assert.match(script, /appRoot, 'node_modules'/);
});

test('初始安装资源同时生成 CPU 与可分片下载的 NVIDIA GPU 版本', () => {
  assert.match(initialScript, /schemaVersion:\s*2/);
  assert.match(initialScript, /id:\s*'cpu'/);
  assert.match(initialScript, /id:\s*'gpu'/);
  assert.match(initialScript, /gpuCoreAssetName/);
  assert.match(initialScript, /gpuMathAssetName/);
});
