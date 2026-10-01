// Run after npm run build:electron; --write backs up and migrates project workflows.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {parseDocument, emitDocument} = require('../dist-electron/shared/workflow/graph-dsl.js');
const {normalizeNodeIdentifiers, remapNodeIdentifiers} = require('../dist-electron/shared/workflow/node-identifiers.js');
const project = path.resolve(__dirname, '../..');
const writing = process.argv.includes('--write');
const backup = path.join(project, 'artifacts', 'node-id-migrations', new Date().toISOString().replace(/[:.]/g, '-'));
function files(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : entry.isFile() && entry.name.endsWith('.owf') ? [target] : [];
  });
}
// Validate every file before writing any changes.
const plans = files(path.join(project, 'workflows')).map(file => {
  const before = fs.readFileSync(file, 'utf8');
  const original = parseDocument(before, path.basename(file));
  const migrated = structuredClone(original);
  const mapping = normalizeNodeIdentifiers(migrated);
  const text = mapping.size ? emitDocument(migrated) : before;
  const parsed = parseDocument(text, path.basename(file));
  const restored = structuredClone(parsed);
  remapNodeIdentifiers(restored, new Map([...mapping].map(([oldId, id]) => [id, oldId])));
  assert.deepEqual(restored, original, `${file}: migration changed data beyond identity`);
  assert.equal(normalizeNodeIdentifiers(parsed).size, 0, `${file}: migration is not idempotent`);
  return {file, before, text, mapping};
}).filter(plan => plan.mapping.size);
if (writing && plans.length) {
  for (const plan of plans) assert.equal(fs.readFileSync(plan.file, 'utf8'), plan.before, 'Workflow changed during migration');
  for (const plan of plans) {
    const target = path.join(backup, path.relative(project, plan.file));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, plan.before, {encoding: 'utf8', flag: 'wx'});
  }
  fs.writeFileSync(path.join(backup, 'mapping.json'), JSON.stringify(plans.map(plan => ({
    file: path.relative(project, plan.file), ids: Object.fromEntries(plan.mapping),
  })), null, 2) + '\n');
  for (const plan of plans) {
    assert.equal(fs.readFileSync(plan.file, 'utf8'), plan.before, 'Workflow changed during migration');
    fs.writeFileSync(plan.file, plan.text, 'utf8');
  }
}
for (const plan of plans) process.stdout.write(`${path.relative(project, plan.file)}: ${plan.mapping.size} IDs ${writing ? 'migrated' : 'to migrate'}\n`);
process.stdout.write(`${plans.length} workflows; inverse identity mapping preserved all original data.\n`);
if (writing && plans.length) process.stdout.write(`Backup: ${backup}\n`);
