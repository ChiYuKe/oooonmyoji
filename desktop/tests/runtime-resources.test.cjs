const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {RuntimeResourceManager} = require('../dist-electron/main/runtimeResources.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-resources-'));
  const project = path.join(root, 'project');
  const data = path.join(root, 'data');
  const manifest = path.join(project, 'runtime-manifest.json');
  fs.mkdirSync(project, {recursive: true});
  fs.writeFileSync(manifest, JSON.stringify({
    schemaVersion: 2,
    platform: 'win32-x64',
    variants: [
      {id:'cpu',label:'CPU 通用版',description:'CPU',accelerator:'cpu',version:'test-1',url:'https://github.com/example/project/releases/download/runtime/cpu.zip',sha256:'a'.repeat(64),size:123},
      {id:'gpu',label:'GPU 加速版',description:'GPU',accelerator:'nvidia',version:'test-1',url:'https://github.com/example/project/releases/download/runtime/gpu.zip',sha256:'b'.repeat(64),size:456},
    ],
  }));
  return {manager: new RuntimeResourceManager(project, data, manifest, () => ({supported:true,message:'Test GPU'})), data, project, manifest};
}

test('缺少资源时进入首次初始化，版本与 Python 都齐全后跳过下载', () => {
  const {manager} = fixture();
  const initial = manager.status();
  assert.equal(initial.ready, false);
  assert.equal(initial.activeVariant, 'cpu');
  assert.deepEqual(initial.variants.map(item => [item.id,item.ready,item.supported,item.downloadBytes]), [
    ['cpu',false,true,123],['gpu',false,true,456],
  ]);
  const python = path.join(manager.runtimeRoot, 'tools', 'python312-embed', 'python.exe');
  fs.mkdirSync(path.dirname(python), {recursive: true});
  fs.writeFileSync(python, '');
  for (const packageName of ['paddle', 'paddlex']) {
    const init = path.join(manager.runtimeRoot, '.venv', 'Lib', 'site-packages', packageName, '__init__.py');
    fs.mkdirSync(path.dirname(init), {recursive: true});
    fs.writeFileSync(init, '');
  }
  fs.mkdirSync(path.join(manager.runtimeRoot, '.paddlex', 'official_models'), {recursive: true});
  fs.writeFileSync(path.join(manager.runtimeRoot, '.resource-ready.json'), JSON.stringify({version: 'test-1',variant:'cpu'}));
  assert.equal(manager.status().ready, true);
});

test('资源清单只接受 GitHub HTTPS 下载和完整 SHA-256', () => {
  const {manager,manifest} = fixture();
  fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 2, platform: 'win32-x64', variants:[{id:'cpu',label:'CPU',description:'',accelerator:'cpu',version:'x',url:'http://invalid.test/a.zip',sha256:'x',size:1}]}));
  assert.throws(() => manager.status(), /资源清单无效/);
});

test('下载、哈希校验、解压和项目路径写入形成完整初始化事务', async () => {
  const item = fixture();
  const source = path.join(item.data, 'source');
  const pythonDir = path.join(source, 'tools', 'python312-embed');
  fs.mkdirSync(pythonDir, {recursive: true});
  for (const packageName of ['paddle', 'paddlex']) {
    const init = path.join(source, '.venv', 'Lib', 'site-packages', packageName, '__init__.py');
    fs.mkdirSync(path.dirname(init), {recursive: true});
    fs.writeFileSync(init, '');
  }
  fs.mkdirSync(path.join(source, '.paddlex', 'official_models'), {recursive: true});
  fs.writeFileSync(path.join(pythonDir, 'python.exe'), 'placeholder');
  fs.writeFileSync(path.join(pythonDir, 'python312._pth'), 'python312.zip\n.\n..\\..\\.venv\\Lib\\site-packages\nimport site\n');
  const archive = path.join(item.data, 'fixture.zip');
  execFileSync('tar.exe', ['-a', '-cf', archive, 'tools', '.venv', '.paddlex'], {cwd: source});
  const body = fs.readFileSync(archive);
  const catalog=JSON.parse(fs.readFileSync(item.manifest,'utf8'));
  Object.assign(catalog.variants[0],{sha256:createHash('sha256').update(body).digest('hex'),size:body.length});
  fs.writeFileSync(item.manifest,JSON.stringify(catalog));
  const phases = [];
  await item.manager.install('cpu', async () => new Response(body), (event) => phases.push(event.phase));
  assert.equal(item.manager.status().variants.find(item=>item.id==='cpu').ready, true);
  item.manager.activate('cpu');
  assert.equal(item.manager.status().ready, true);
  const pth = fs.readFileSync(path.join(item.manager.runtimeRoot, 'tools', 'python312-embed', 'python312._pth'), 'utf8');
  assert.match(pth, new RegExp(item.project.replaceAll('\\', '\\\\')));
  assert.ok(phases.includes('verifying'));
  assert.ok(phases.includes('extracting'));
  assert.equal(phases.at(-1), 'ready');
});

test('GPU 分片按顺序下载并叠加到同一运行环境', async () => {
  const item=fixture();
  const base=path.join(item.data,'base');
  const overlay=path.join(item.data,'overlay');
  fs.mkdirSync(path.join(base,'tools','python312-embed'),{recursive:true});
  fs.writeFileSync(path.join(base,'tools','python312-embed','python.exe'),'');
  fs.writeFileSync(path.join(base,'tools','python312-embed','python312._pth'),'python312.zip\nimport site\n');
  for(const name of ['paddle','paddlex']){
    const init=path.join(base,'.venv','Lib','site-packages',name,'__init__.py');
    fs.mkdirSync(path.dirname(init),{recursive:true}); fs.writeFileSync(init,'');
  }
  fs.mkdirSync(path.join(base,'.paddlex','official_models'),{recursive:true});
  const marker=path.join(overlay,'.venv','Lib','site-packages','nvidia','cudnn','bin','cudnn.dll');
  fs.mkdirSync(path.dirname(marker),{recursive:true}); fs.writeFileSync(marker,'gpu');
  const archives=[path.join(item.data,'base.zip'),path.join(item.data,'overlay.zip')];
  execFileSync('tar.exe',['-a','-cf',archives[0],'tools','.venv','.paddlex'],{cwd:base});
  execFileSync('tar.exe',['-a','-cf',archives[1],'.venv'],{cwd:overlay});
  const bodies=archives.map(filename=>fs.readFileSync(filename));
  fs.writeFileSync(item.manifest,JSON.stringify({schemaVersion:2,platform:'win32-x64',variants:[{
    id:'gpu',label:'GPU',description:'GPU',accelerator:'nvidia',version:'test-1',artifacts:bodies.map((body,index)=>({
      url:`https://github.com/example/project/releases/download/runtime/part-${index}.zip`,sha256:createHash('sha256').update(body).digest('hex'),size:body.length,
    })),
  }]}));
  let index=0;
  await item.manager.install('gpu',async()=>new Response(bodies[index++]),()=>{});
  item.manager.activate('gpu');
  assert.equal(fs.readFileSync(path.join(item.manager.runtimeRoot,'.venv','Lib','site-packages','nvidia','cudnn','bin','cudnn.dll'),'utf8'),'gpu');
  assert.equal(item.manager.status().ready,true);
});

test('CPU 与 GPU 可共存、切换，且不能删除当前环境', () => {
  const {manager}=fixture();
  for(const id of ['cpu','gpu']){
    const root=path.join(path.dirname(manager.runtimeRoot),id);
    fs.mkdirSync(path.join(root,'tools','python312-embed'),{recursive:true});
    fs.writeFileSync(path.join(root,'tools','python312-embed','python.exe'),'');
    for(const name of ['paddle','paddlex']){
      const init=path.join(root,'.venv','Lib','site-packages',name,'__init__.py');
      fs.mkdirSync(path.dirname(init),{recursive:true}); fs.writeFileSync(init,'');
    }
    fs.mkdirSync(path.join(root,'.paddlex','official_models'),{recursive:true});
    fs.writeFileSync(path.join(root,'.resource-ready.json'),JSON.stringify({version:'test-1',variant:id}));
  }
  manager.activate('gpu');
  assert.equal(manager.status().activeVariant,'gpu');
  assert.equal(path.basename(manager.runtimeRoot),'gpu');
  assert.throws(()=>manager.remove('gpu'),/当前正在使用/);
  manager.activate('cpu');
  manager.remove('gpu');
  assert.equal(manager.status().variants.find(item=>item.id==='gpu').ready,false);
});

test('旧版单资源清单继续按 CPU 环境读取', () => {
  const item=fixture();
  fs.writeFileSync(item.manifest,JSON.stringify({schemaVersion:1,version:'legacy',platform:'win32-x64',url:'https://github.com/example/project/releases/download/runtime/legacy.zip',sha256:'a'.repeat(64),size:12}));
  const status=item.manager.status();
  assert.deepEqual(status.variants.map(value=>value.id),['cpu']);
  assert.equal(status.variants[0].version,'legacy');
});
