// 生成 GitHub Release 资源包、资源清单和不内置 OCR 的初始安装程序。
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(desktopRoot, 'release');
const cpuStage = path.join(releaseRoot, 'OnmyojiStudio-installer-stage', 'resources');
const gpuStage = path.join(releaseRoot, 'OnmyojiStudio-win-x64', 'resources');
const initialStage = path.join(releaseRoot, 'OnmyojiStudio-initial-stage');
const assetRoot = path.join(releaseRoot, 'runtime-assets');
const version = require(path.join(desktopRoot, 'package.json')).version;
const cpuAssetName = `Onmyoji-Studio-Runtime-win-x64-cpu-${version}.zip`;
const gpuCoreAssetName = `Onmyoji-Studio-Runtime-win-x64-gpu-cu12-core-${version}.zip`;
const gpuMathAssetName = `Onmyoji-Studio-Runtime-win-x64-gpu-cu12-math-${version}.zip`;
const manifestPath = path.join(assetRoot, 'runtime-manifest.json');

function run(command, args, cwd = desktopRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sha256(filename) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let count = 0;
    do {
      count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count > 0) hash.update(buffer.subarray(0, count));
    } while (count > 0);
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

fs.rmSync(assetRoot, { recursive: true, force: true });
fs.mkdirSync(assetRoot, { recursive: true });
run(process.execPath, [path.join(__dirname, 'package-windows-portable.cjs'), '--cpu-only']);
const cpuAssetPath = path.join(assetRoot, cpuAssetName);
run('tar.exe', ['-a', '-cf', cpuAssetPath, 'tools', '.venv', '.paddlex'], cpuStage);
run(process.execPath, [path.join(__dirname, 'package-windows-portable.cjs')]);
const sitePackages = path.join(gpuStage, '.venv', 'Lib', 'site-packages');
const packageNames = fs.readdirSync(sitePackages);
function gpuOverlayPaths(names) {
  return names.flatMap((name) => [
    `.venv/Lib/site-packages/nvidia/${name}`,
    ...packageNames.filter((entry) => entry.startsWith(`nvidia_${name}_`) && entry.endsWith('.dist-info'))
      .map((entry) => `.venv/Lib/site-packages/${entry}`),
  ]);
}
const gpuCoreAssetPath = path.join(assetRoot, gpuCoreAssetName);
const gpuMathAssetPath = path.join(assetRoot, gpuMathAssetName);
run('tar.exe', ['-a', '-cf', gpuCoreAssetPath, ...gpuOverlayPaths(['cublas', 'cudnn'])], gpuStage);
run('tar.exe', ['-a', '-cf', gpuMathAssetPath, ...gpuOverlayPaths(['cuda_runtime', 'cufft', 'curand', 'cusolver', 'cusparse', 'nvjitlink'])], gpuStage);
const manifest = {
  schemaVersion: 2,
  platform: 'win32-x64',
  variants: [
    {
      id: 'cpu', label: 'CPU 通用版', accelerator: 'cpu', version,
      description: '兼容所有 Windows 电脑，稳定且无需独立显卡。',
      artifacts: [{
        url: `https://github.com/ChiYuKe/oooonmyoji/releases/download/runtime-v${version}/${cpuAssetName}`,
        sha256: sha256(cpuAssetPath), size: fs.statSync(cpuAssetPath).size,
      }],
    },
    {
      id: 'gpu', label: 'NVIDIA GPU 加速版', accelerator: 'nvidia', version,
      description: '适合带有 NVIDIA 显卡的电脑，可提升 OCR 处理速度。',
      artifacts: [
        {
          url: `https://github.com/ChiYuKe/oooonmyoji/releases/download/runtime-v${version}/${cpuAssetName}`,
          sha256: sha256(cpuAssetPath), size: fs.statSync(cpuAssetPath).size,
        },
        {
          url: `https://github.com/ChiYuKe/oooonmyoji/releases/download/runtime-v${version}/${gpuCoreAssetName}`,
          sha256: sha256(gpuCoreAssetPath), size: fs.statSync(gpuCoreAssetPath).size,
        },
        {
          url: `https://github.com/ChiYuKe/oooonmyoji/releases/download/runtime-v${version}/${gpuMathAssetName}`,
          sha256: sha256(gpuMathAssetPath), size: fs.statSync(gpuMathAssetPath).size,
        },
      ],
    },
  ],
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
run(process.execPath, [path.join(__dirname, 'package-windows-portable.cjs'), '--thin']);
run(process.execPath, [
  path.join(desktopRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  '--win', 'nsis', '--x64', '--prepackaged', initialStage,
  '--config', path.join(desktopRoot, 'electron-builder-initial.yml'),
]);
console.log(`初始安装包：${path.join(releaseRoot, 'initial-installer')}`);
console.log(`CPU Release 资源：${cpuAssetPath} (${(fs.statSync(cpuAssetPath).size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
console.log(`GPU Release 资源：CPU 基础包 + ${gpuCoreAssetPath} + ${gpuMathAssetPath}`);
console.log(`资源清单：${manifestPath}`);
