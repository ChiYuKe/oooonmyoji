// 从已构建的桌面端生成 CPU 兼容版目录，再交给 electron-builder 制作 NSIS 安装程序。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const stageRoot = path.join(desktopRoot, 'release', 'OnmyojiStudio-installer-stage');
const builderCli = path.join(desktopRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const builderConfig = path.join(desktopRoot, 'electron-builder.yml');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [path.join(__dirname, 'package-windows-portable.cjs'), '--cpu-only']);

const bundledPython = path.join(stageRoot, 'resources', 'tools', 'python312-embed', 'python.exe');
run(bundledPython, ['-c', 'import cv2, paddle, paddlex, jsonschema; import src.oooonmyoji; print("CPU installer runtime OK")']);

run(process.execPath, [
  builderCli,
  '--win', 'nsis',
  '--x64',
  '--prepackaged', stageRoot,
  '--config', builderConfig,
]);

const installerRoot = path.join(desktopRoot, 'release', 'installer');
const installer = fs.readdirSync(installerRoot).find((name) => name.endsWith('.exe'));
if (!installer) throw new Error('安装程序未生成');
const installerPath = path.join(installerRoot, installer);
console.log(`安装程序：${installerPath}`);
console.log(`文件大小：${(fs.statSync(installerPath).size / 1024 / 1024 / 1024).toFixed(2)} GB`);
