const test = require('node:test');
const assert = require('node:assert/strict');
const {planPanelAddition,formatPanelValue} = require('../dist-test-renderer/renderer/soul-panel-table');

test('plan additions use the original calculation base; percentage values are differences in points', () => {
  const base={attack:3242.8,hp:10139.88,defense:396.9,speed:119,crit:.08,critDamage:1.5,hit:0,resist:0};
  const total={attack:7537.15,hp:14174.89,defense:531.28,speed:274.17,crit:.08,critDamage:1.6447,hit:.1099,resist:0};
  const addition=planPanelAddition(total,base);
  assert.equal(formatPanelValue('attack',addition.attack,true),'+4294.35');
  assert.equal(formatPanelValue('speed',addition.speed,true),'+155.17');
  assert.equal(formatPanelValue('critDamage',addition.critDamage,true),'+14.47%');
  assert.equal(formatPanelValue('critDamage',total.critDamage),'164.47%');
  assert.equal(formatPanelValue('crit',addition.crit,true),'+0.00%');
  assert.equal(formatPanelValue('hit',addition.hit,true),'+10.99%');
  assert.equal(base.attack,3242.8);assert.equal(total.attack,7537.15);
});

test('legacy plans without the original base keep unknown additions; values preserve signs and raw crit totals', () => {
  const total={attack:1000,hp:10000,defense:400,speed:110,crit:1.2,critDamage:1.5,hit:0,resist:0};
  assert.ok(Object.values(planPanelAddition(total)).every(value=>value===null));
  assert.equal(formatPanelValue('attack',null,true),'—');
  assert.equal(formatPanelValue('crit',total.crit),'120.00%');
  assert.equal(formatPanelValue('attack',-10,true),'-10.00');
  assert.equal(formatPanelValue('hit',-1e-12,true),'+0.00%');
  assert.equal(formatPanelValue('attack',NaN),'—');
});
