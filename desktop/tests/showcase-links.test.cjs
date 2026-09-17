const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(desktopRoot, 'public', relativePath), 'utf8');
}

test('showcase pages link to the current component showcase entry', () => {
  const settings = readPublic('settings/showcase.html');
  const runtimeLog = readPublic('runtime-log/showcase.html');
  const nodeCards = readPublic('legacy/node-cards-showcase.html');

  assert.match(settings, /href="\.\.\/ui-showcase\.html"/);
  assert.match(runtimeLog, /href="\.\.\/ui-showcase\.html"/);
  assert.match(nodeCards, /href="\.\.\/ui-showcase\.html"/);
  assert(fs.existsSync(path.join(desktopRoot, 'src', 'renderer', 'ui-showcase.html')));
  assert.doesNotMatch(runtimeLog, /legacy\/(?:ui\.js|ui-showcase\.html)/);
  assert.match(readPublic('runtime-log/showcase.js'), /function makeButton\(label, onClick\)/);
});

test('desktop help documentation remains available at the project root', () => {
  assert(fs.existsSync(path.resolve(desktopRoot, '..', 'README.md')));
});
