// 生成无需安装 Node/Python 的 Windows 解压即用目录。
// 保留仓库目录层级，让嵌入式 Python 的 _pth 同时找到 src 与运行依赖。
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(desktopRoot, '..');
const releaseRoot = path.join(desktopRoot, 'release');
const cpuOnly = process.argv.includes('--cpu-only');
const thin = process.argv.includes('--thin');
const outputName = thin ? 'AutoFlowStudio-initial-stage' : cpuOnly ? 'AutoFlowStudio-installer-stage' : 'AutoFlowStudio-win-x64';
const outputRoot = path.join(releaseRoot, outputName);
const resourcesRoot = path.join(outputRoot, 'resources');

function requirePath(target, label) {
  if (!fs.existsSync(target)) throw new Error(`${label}不存在：${target}`);
  return target;
}

function copy(source, target, filter) {
  requirePath(source, '打包来源');
  if (filter && !filter(source)) return;
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) copy(path.join(source, entry), path.join(target, entry), filter);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyContents(source, target, filter) {
  requirePath(source, '打包来源');
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    copy(path.join(source, entry), path.join(target, entry), filter);
  }
}

function copyRuntimePackage(packageName, appRoot, copied = new Set()) {
  if (copied.has(packageName)) return;
  copied.add(packageName);
  const source = path.join(desktopRoot, 'node_modules', ...packageName.split('/'));
  const packageFile = path.join(source, 'package.json');
  requirePath(packageFile, `Node 运行依赖 ${packageName}`);
  const target = path.join(appRoot, 'node_modules', ...packageName.split('/'));
  copy(source, target, projectFilter);
  const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    copyRuntimePackage(dependency, appRoot, copied);
  }
}

function projectFilter(source) {
  const name = path.basename(source);
  return name !== '__pycache__' && name !== '.pytest_cache' && !name.endsWith('.pyc');
}

function runtimeFilter(source) {
  const name = path.basename(source).toLowerCase();
  if (name === '__pycache__' || name === '.pytest_cache' || name === '.mypy_cache' || name === '.ruff_cache') return false;
  if (name.endsWith('.pyc')) return false;
  // 发布运行时不携带开发检查器；业务依赖与 Paddle/CUDA 二进制全部保留。
  if (cpuOnly && (name === 'nvidia' || name.startsWith('nvidia_'))) return false;
  return !['_pytest', 'pytest', 'mypy', 'mypyc', 'ruff'].includes(name)
    && !name.startsWith('pytest-') && !name.startsWith('mypy-') && !name.startsWith('ruff-');
}

function directorySize(root) {
  let total = 0;
  if (!fs.existsSync(root)) return total;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    total += entry.isDirectory() ? directorySize(file) : fs.statSync(file).size;
  }
  return total;
}

if (!outputRoot.startsWith(`${releaseRoot}${path.sep}`)) throw new Error('拒绝清理 release 目录以外的路径');
fs.rmSync(outputRoot, { recursive: true, force: true });

// Electron 本体；resources/app 是 Electron 支持的未压缩应用目录。
copyContents(path.join(desktopRoot, 'node_modules', 'electron', 'dist'), outputRoot);
fs.mkdirSync(resourcesRoot, { recursive: true });
const electronExe = path.join(outputRoot, 'electron.exe');
const productExe = path.join(outputRoot, 'AutoFlow Studio.exe');
requirePath(electronExe, 'Electron 可执行文件');
fs.renameSync(electronExe, productExe);
fs.rmSync(path.join(resourcesRoot, 'default_app.asar'), { force: true });

const appRoot = path.join(resourcesRoot, 'app');
fs.mkdirSync(appRoot, { recursive: true });
copy(path.join(desktopRoot, 'dist-electron'), path.join(appRoot, 'dist-electron'));
copy(path.join(desktopRoot, 'dist', 'renderer'), path.join(appRoot, 'dist', 'renderer'));
fs.writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify({
  name: 'onmyoji-studio',
  productName: 'AutoFlow Studio',
  version: require(path.join(desktopRoot, 'package.json')).version,
  main: 'dist-electron/main/main.js',
  dependencies: { ajv: require(path.join(desktopRoot, 'node_modules', 'ajv', 'package.json')).version },
  private: true,
}, null, 2)}\n`);
// TypeScript 主进程不会像 Vite 渲染器那样内联依赖，必须带上 AJV 及其传递依赖。
copyRuntimePackage('ajv', appRoot);

// 用户可编辑项目内容。只发通用配置，绝不复制开发机 config.json 中的本地路径。
for (const folder of ['assets', 'plugins', 'src', 'workflows']) {
  copy(path.join(projectRoot, folder), path.join(resourcesRoot, folder), projectFilter);
}
fs.mkdirSync(path.join(resourcesRoot, 'config'), { recursive: true });
const exampleConfig = path.join(projectRoot, 'config', 'config.example.json');
copy(exampleConfig, path.join(resourcesRoot, 'config', 'config.example.json'));
const portableConfig = JSON.parse(fs.readFileSync(exampleConfig, 'utf8'));
// 默认关闭 GPU，避免接收者没有兼容显卡时无法启动；有 NVIDIA 环境时可在设置中开启。
if (portableConfig.ocr && typeof portableConfig.ocr === 'object') portableConfig.ocr.use_gpu = false;
fs.writeFileSync(
  path.join(resourcesRoot, 'config', 'config.json'),
  `${JSON.stringify(portableConfig, null, 2)}\n`,
  'utf8',
);
for (const file of ['README.md', 'LICENSE']) copy(path.join(projectRoot, file), path.join(resourcesRoot, file));
for (const folder of ['artifacts', 'logs']) fs.mkdirSync(path.join(resourcesRoot, folder), { recursive: true });

// 初始安装版只带资源清单；Python/OCR 在首次启动时下载到用户数据目录。
if (!thin) {
  copy(path.join(projectRoot, 'tools', 'python312-embed'), path.join(resourcesRoot, 'tools', 'python312-embed'));
  copy(path.join(projectRoot, '.venv', 'Lib', 'site-packages'), path.join(resourcesRoot, '.venv', 'Lib', 'site-packages'), runtimeFilter);
} else {
  copy(
    path.join(releaseRoot, 'runtime-assets', 'runtime-manifest.json'),
    path.join(resourcesRoot, 'runtime-manifest.json'),
  );
}

// PaddleX 模型缓存存在时一起带走，避免接收者首次 OCR 再下载；不可读时安全跳过。
const modelCache = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.paddlex') : '';
if (!thin && modelCache && fs.existsSync(modelCache)) {
  try { copy(modelCache, path.join(resourcesRoot, '.paddlex')); } catch (error) {
    console.warn(`OCR 模型缓存未打包：${error instanceof Error ? error.message : String(error)}`);
  }
}

const guide = [
  'AutoFlow Studio Windows 解压即用版',
  '',
  '1. 保持本目录结构不变，双击“AutoFlow Studio.exe”。',
  '2. 先启动 MuMu 模拟器；默认会自动发现实例。',
  '3. 如自动发现失败，编辑 resources\\config\\config.json，填写 mumu_path/adb_path。',
  '4. 工作流与素材在 resources\\workflows 和 resources\\assets，请整体备份后再升级。',
  '5. Windows SmartScreen 首次可能提示未知发布者，这是当前版本尚未做代码签名。',
  ...(cpuOnly ? ['6. 此安装版使用兼容性更好的 CPU OCR，不包含约 3 GB 的 NVIDIA 运行库。'] : []),
  ...(thin ? ['6. 首次启动会自动从 GitHub Release 下载并校验 OCR 运行资源。'] : []),
].join('\r\n');
fs.writeFileSync(path.join(outputRoot, '使用说明.txt'), `${guide}\r\n`, 'utf8');

const bytes = directorySize(outputRoot);
console.log(`已生成：${outputRoot}`);
console.log(`目录大小：${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
