const { test } = require('node:test');
const assert = require('node:assert/strict');
const { estimateSoulEnhancementScore: rate } = require('../dist-test-renderer/shared/soul-enhancement-score');
const { SIX_STAR_SUBSTAT_ROLLS: caps } = require('../dist-test-renderer/shared/soul-attribute-limits');
const attr = (name, rolls = 1, yieldFactor = 1) => ({ name, rolls, value: caps[name] * rolls * yieldFactor, label: name, percent: true });
const soul = (attrs) => ({ id: 'mine', position: 1, stars: 6, level: 15, subAttributes: attrs,
  mainAttribute: attr('attackAdditionVal', 1), intrinsicAttributes: [attr('critRateAdditionVal', 1)] });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('five full effective upgrades reach ten; 80% yields reach eight, excluding initial/main/intrinsic values', () => {
  const names = ['attackAdditionRate', 'attackAdditionVal', 'critRateAdditionVal', 'critPowerAdditionVal'];
  for (const factor of [1, .8, .93]) {
    const item = soul(names.map((name, i) => attr(name, i === 0 ? 6 : 1, factor))), before = JSON.stringify(item);
    close(rate(item, { objective: 'damage' }).score, 10 * factor);
    assert.equal(JSON.stringify(item), before);
    item.mainAttribute.value = 486; item.intrinsicAttributes[0].value = .08;
    close(rate(item, { objective: 'damage' }).score, 10 * factor);
  }
});

test('only upgrades in currently useful stats count, with explicit conditions and objective changes', () => {
  const item = soul([attr('attackAdditionRate', 2), attr('speedAdditionVal', 2), attr('debuffResist', 4), attr('maxHpAdditionRate')]);
  close(rate(item, { objective: 'attack' }).score, 2);
  close(rate(item, { objective: 'attack', ranges: { speed: { min: 128 } } }).score, 2);
  assert.deepEqual(rate(item, { objective: 'attack', ranges: { speed: { min: 128 } } }).conditions, ['speedAdditionVal']);
  close(rate(item, { objective: 'resist' }).score, 6);
  close(rate(item, { objective: 'hit' }).score, 0);
  close(rate(item, { objective: 'hp' }).score, 0, 'initial effective stat scores nothing');
});

test('five speed upgrades score zero for damage despite speed bounds, and ten for speed', () => {
  const item = soul([attr('speedAdditionVal', 6), attr('critPowerAdditionVal'), attr('attackAdditionRate'), attr('critRateAdditionVal')]);
  const c = { objective: 'damage', ranges: { speed: { min: 158, max: 180 }, crit: { min: 1 } }, gear: [item], panel: { speed: 163, crit: 1 } };
  close(rate(item, c).score, 0);
  assert.deepEqual(rate(item, c).conditions, ['speedAdditionVal']);
  close(rate(item, { ...c, objective: 'speed' }).score, 10);
});

test('reported slot-one example counts three crit-damage upgrades while keeping speed as a condition', () => {
  const item = soul([attr('maxHpAdditionVal'), attr('defenseAdditionVal'), attr('speedAdditionVal', 3), attr('critPowerAdditionVal', 4)]);
  item.subAttributes[2].value = 7.958049956384778;
  item.subAttributes[3].value = .15226771051013582;
  const result = rate(item, { objective: 'damage', ranges: { speed: { min: 158.1 } } });
  close(result.score, 5.710039144130093);
  assert.deepEqual(result.conditions, ['speedAdditionVal']);
});

test('upper bounds and above-full-crit requirements do not manufacture output reinforcement points', () => {
  const item = soul([attr('critRateAdditionVal', 6), attr('debuffResist'), attr('maxHpAdditionRate'), attr('speedAdditionVal')]);
  const gear = [item, ...Array.from({ length: 3 }, (_, i) => ({ id: `other-${i}`, suitId: 300087, position: i + 2, subAttributes: [] }))];
  item.suitId = 300087;
  const c = { objective: 'damage', panel: { crit: 1.18 }, gear, ranges: { crit: { min: 1.2 }, resist: { max: .5 } } };
  close(rate(item, c).score, 0);
  assert.deepEqual(rate(item, c).conditions, ['critRateAdditionVal', 'debuffResist']);
});

test('fixed-value effective stats use their own per-roll caps; excess crit loses points', () => {
  const flat = soul([attr('attackAdditionVal', 6), attr('debuffResist'), attr('maxHpAdditionRate'), attr('speedAdditionVal')]);
  close(rate(flat, { objective: 'attack' }).score, 10);
  const crit = soul([attr('critRateAdditionVal', 6), attr('debuffResist'), attr('maxHpAdditionRate'), attr('speedAdditionVal')]);
  close(rate(crit, { objective: 'damage', gear: [crit], panel: { crit: 1.18 } }).score, 0);
  close(rate(crit, { objective: 'damage', gear: [crit], panel: { crit: 1.09 } }).score, 5);
  close(rate(crit, { objective: 'crit', gear: [crit], panel: { crit: 1.18 } }).score, 10);
});

test('three initial stats average the unknown added fourth stat without losing the fifth upgrade', () => {
  const item = soul([attr('attackAdditionRate', 5), attr('attackAdditionVal'), attr('critRateAdditionVal'), attr('critPowerAdditionVal')]);
  close(rate(item, { objective: 'damage' }).score, 10);
  assert.match(rate(item, { objective: 'damage' }).note, /四种可能取平均/);
  close(rate(item, { objective: 'attack' }).score, 9);
});

test('bad or incomplete allocation counts are unavailable, not fabricated scores', () => {
  const good = soul([attr('attackAdditionRate', 6), attr('debuffResist'), attr('maxHpAdditionRate'), attr('speedAdditionVal')]);
  for (const change of [s => s.level = 12, s => s.stars = 5, s => s.subAttributes.pop(),
    s => s.subAttributes[0].rolls = 0, s => s.subAttributes[0].value = NaN,
    s => s.subAttributes[0].value *= 1.01, s => s.subAttributes[0].value *= .79,
    s => s.subAttributes[0].rolls = 5.5, s => s.subAttributes[1] = s.subAttributes[0]]) {
    const item = structuredClone(good); change(item); assert.equal(rate(item, { objective: 'damage' }).score, null);
  }
  assert.equal(rate(soul([attr('attackAdditionRate'), attr('debuffResist'), attr('maxHpAdditionRate'), attr('speedAdditionVal')]), { objective: 'attack' }).score, null);
});
