const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');
const original = Module._load;
Module._load = function(request, ...rest) {
  if (request === 'electron') return {BrowserWindow: class {}, dialog: {}, shell: {}};
  return original.call(this, request, ...rest);
};
const {ProjectService} = require('../dist-electron/main/projectService');
Module._load = original;

test('application icons are excluded from template assets and folder tree; user templates stay visible', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-icons-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const files = ['assets/hero-icons/200.png','assets/skill-icons/1004.png','assets/soul-icons/300027.png',
    'assets/templates/game.png','assets/templates/hero-icons/custom.png','assets/reference/sample.png'];
  for (const file of files) {fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),'test image');}
  fs.mkdirSync(path.join(root,'workflows','entrypoints'),{recursive:true});
  const service = new ProjectService(root);
  assert.deepEqual((await service.listAssets()).map(image=>image.path).sort(), files.slice(3).sort());
  const folders = await service.listContentFolders();
  for (const kind of ['hero','skill','soul']) assert.ok(!folders.includes(`assets/${kind}-icons`));
  assert.ok(folders.includes('assets/templates/hero-icons'));
  assert.ok(folders.includes('workflows/entrypoints'));
  const legacy = 'assets/hero-icons/200.png';
  assert.equal(service.resolveResourceUrl(`onmyoji-resource://project/${legacy}`), path.join(root,legacy));
  assert.equal((await service.readAssetData([legacy]))[0].path, legacy);
  assert.equal(service.resolveResourceUrl('onmyoji-resource://outside/assets/hero-icons/200.png'),undefined);
});
