const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.join(__dirname,'../public/legacy');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const frame = postcss.parse(read('editor-frame.css'));
const properties = selector => {
  const result = {};
  frame.walkRules(selector, rule => {
    assert.equal(rule.parent.type,'root', 'desktop geometry must not inherit legacy layer/media conditions');
    rule.walkDecls(d => {result[d.prop]=d.value;});
  });
  return result;
};

test('desktop canvas always defines one full-height row, including narrow selected-node state', () => {
  // The legacy combined editor retains its stacked layout; only the split desktop embeds override it.
  assert.match(read('workflow-editor.css'),/grid-template-rows: minmax\(0, 58%\) minmax\(0, 42%\)/);
  const canvas=properties('.desktop-canvas-mode #editor-main');
  assert.equal(canvas.display,'grid');
  assert.equal(canvas['grid-template-rows'],'minmax(0, 1fr)');
  assert.equal(canvas['grid-template-columns'],'minmax(0, 1fr)');
  assert.equal(canvas.height,'calc(100% - 30px)');
  assert.equal(properties('.desktop-canvas-mode #canvas-wrap')['min-height'],'0');
  assert.equal(properties('.desktop-canvas-mode #inspector').display,'none');
});

test('separate details panel fills its host without reserving a hidden breadcrumb', () => {
  assert.equal(properties('.desktop-details-mode #editor-main').height,'100%');
  assert.equal(properties('.desktop-details-mode #editor-main').display,'block');
  assert.equal(properties('.desktop-details-mode #inspector').height,'100%');
  assert.equal(properties('.desktop-details-mode #canvas-wrap').display,'none');
  assert.match(read('editor-frame.css'),/\.desktop-details-mode #workflow-breadcrumb \{ display: none !important; \}/);
});

test('both frame modes load the explicit desktop layout after all shared styles', () => {
  const html=read('editor-frame.html');
  const styles=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(styles.at(-1),'./editor-frame.css');
  assert(!html.includes('<style>'), 'avoid a generic inline main height overriding details mode');
  assert(read('bridge.js').includes('desktop-${frameMode}-mode'));
});
