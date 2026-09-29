// 把桌面端图标写入 Windows 可执行文件资源，供任务管理器和任务栏读取。
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { convertIcon } = require('app-builder-lib/out/util/iconConverter');

const desktopRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(desktopRoot, '..');
const iconSource = path.join(projectRoot, 'icon.png');
const executable = process.argv[2];

async function main() {
  if (!executable) throw new Error('缺少需要写入图标的 Windows 可执行文件路径');
  const conversion = await convertIcon({
    sources: [iconSource],
    fallbackSources: [],
    roots: [projectRoot],
    format: 'ico',
    outDir: path.join(desktopRoot, 'release', '.icon-ico'),
  });
  const icon = conversion.icons[0]?.file;
  if (!icon) throw new Error(`无法从图标资源生成 ICO：${iconSource}`);

  const rcedit = path.join(desktopRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const result = spawnSync(rcedit, [executable, '--set-icon', icon], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`写入 Windows 图标失败，退出码：${result.status ?? 'unknown'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
