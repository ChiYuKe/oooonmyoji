const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const asar = require('@electron/asar');
const project = path.resolve(__dirname, '../..');
const folders = ['hero-icons', 'skill-icons', 'soul-icons'];
const archive = path.join(project, 'resources/onmyoji-icons.asar');

async function buildIconResources() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-icon-pack-'));
  const temporary = path.join(stage, 'onmyoji-icons.asar');
  const source = path.join(stage, 'source');
  let count = 0;
  try {
    for (const folder of folders) {
      const input = path.join(project, 'assets', folder), output = path.join(source, folder);
      if (!fs.existsSync(input)) throw Error('图标源文件目录不存在：' + input);
      fs.mkdirSync(output, { recursive: true });
      for (const name of fs.readdirSync(input).sort()) {
        if (!/^\d+\.png$/.test(name) && name !== 'manifest.json') continue;
        const data = fs.readFileSync(path.join(input, name));
        if (name.endsWith('.png')) {
          if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('图标不是 PNG：' + name);
          count++;
        }
        fs.writeFileSync(path.join(output, name), data);
      }
    }
    await asar.createPackage(source, temporary);
    // Check each packed image against its source before replacing the working archive.
    for (const folder of folders) for (const name of fs.readdirSync(path.join(source, folder))) {
      const original = fs.readFileSync(path.join(source, folder, name));
      if (!asar.extractFile(temporary, folder + '/' + name).equals(original)) throw Error('图标资源包校验失败：' + name);
    }
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.copyFileSync(temporary, archive);
    console.log(`图标资源包：${count} 张图片，${archive}`);
    return { archive, count };
  } finally {
    if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('拒绝清理临时目录之外的路径');
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
module.exports = { buildIconResources, folders, archive };
if (require.main === module) buildIconResources().catch(error => { console.error(error); process.exitCode = 1; });
