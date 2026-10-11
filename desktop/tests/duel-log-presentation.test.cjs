const { test } = require('node:test');
const assert = require('node:assert/strict');
const root = '../dist-test-renderer/renderer/features/duel/engine/';
const { presentBattleEvents, presentBattleLogEntries } = require(root + 'presentation/events.js');
const { describeBattleLogEntry, battleLogOriginLabel } = require(root + 'presentation/log-entry.js');
const { simulateBattle, simulateBattleProgressive, simulateBattleSampleDetails } = require(root + 'battle-engine.js');
const names = { wind: '蓝方·初翎山风', sea: '红方·海坊主', skull: '红方·荒骷髅' };
const label = id => names[id] ?? id;
const skill = (unitId, id) => ({ name: id === '3573' ? '岚' : id === '2472' ? '祝福之水' : undefined, passive: id === '2472' });
function event(type, id, source, extra = {}) {
  return { type, eventId: id, phase: 'effect-resolution', source, actionId: 4, ...extra };
}
const wind = { kind: 'skill', id: '3573', unitId: 'wind' };
function fixture() {
  return [event('turn-started', 'start', wind, { phase: 'turn-start', unitId: 'wind' }),
    event('action-declared', 'action', { kind: 'unit', id: '357', unitId: 'wind' },
      { phase: 'action-selection', intent: { actorId: 'wind', skillId: '3573', targetIds: ['sea'], shape: 'single' } }),
    event('damage', 'hit', wind, { targetId: 'sea', damageKind: 'normal', amount: 644, hpLost: 644, mitigated: 0, isCritical: false }),
    event('healing', 'heal', { kind: 'skill', id: '2472', unitId: 'sea' }, { targetId: 'sea', amount: 644, requestedAmount: 644, hpGained: 644 }),
    event('health-restored', 'restore', { kind: 'status', id: 'status.hero.585.ping-iron-wall', unitId: 'skull' },
      { targetId: 'skull', amount: 3482, hpGained: 3482 }),
    event('resource-meter-advanced', 'meter', { kind: 'system', id: 'pvp' }, { side: 'blue', resourceId: 'fire', progressBefore: 0, progressAfter: 1, supplied: 0 }),
    event('turn-ended', 'end', wind, { phase: 'turn-end', unitId: 'wind' }),
    event('action-gauge-changed', 'push', { kind: 'skill', id: '3572', unitId: 'wind' }, { unitId: 'wind', before: 0, after: 20 }),
    event('damage', 'ice', { kind: 'skill', id: '3624', unitId: 'skull' },
      { targetId: 'sea', damageKind: 'indirect', amount: 4331, hpLost: 4331, mitigated: 0, isCritical: false })];
}

test('技能伤害、敌方被动回血和状态恢复有独立来源，仍按发生顺序显示', () => {
  const entries = presentBattleLogEntries(fixture(), label, skill);
  assert.deepEqual(entries.map(e => e.text), presentBattleEvents(fixture(), label));
  assert.deepEqual(entries.map(e => e.event.eventId), fixture().map(e => e.eventId));
  assert.equal(entries[2].origin.direct, true);
  assert.equal(battleLogOriginLabel(entries[2]), '本次技能 · 蓝方·初翎山风 「岚」');
  assert.equal(entries[3].origin.kind, 'passive');
  assert.equal(battleLogOriginLabel(entries[3]), '被动 · 红方·海坊主 「祝福之水」');
  assert.equal(battleLogOriginLabel(entries[4]), '状态触发 · 红方·荒骷髅 磐之铁壁');
  assert.equal(describeBattleLogEntry(entries[3]).label, '治疗');
  assert.equal(describeBattleLogEntry(entries[4]).label, '生命恢复');
});

test('自然回火进度与式神行动条不再使用同一种标签', () => {
  const entries = presentBattleLogEntries(fixture(), label, skill);
  assert.match(entries[5].text, /鬼火回火进度：0→1格/);
  assert.doesNotMatch(entries[5].text, /行动条/);
  assert.equal(describeBattleLogEntry(entries[5]).kind, 'resource');
  assert.equal(describeBattleLogEntry(entries[7]).kind, 'gauge');
  assert.equal(describeBattleLogEntry(entries[7]).label, '行动条');
});

test('回合结束产生的伤害单独标记，间接伤害不会显示成真实伤害', () => {
  const entries = presentBattleLogEntries(fixture(), label, skill);
  assert.equal(entries[2].stage, 'action');
  assert.equal(entries[7].stage, 'turn-end');
  assert.equal(entries[8].stage, 'turn-end');
  assert.match(entries[8].text, /间接伤害/);
  assert.equal(describeBattleLogEntry(entries[8]).label, '间接伤害');
  const indirectLifeLoss = presentBattleLogEntries([event('life-lost', 'lost', wind,
    { targetId: 'sea', amount: 15, hpLost: 15, lifeLossKind: 'indirect' })], label)[0];
  assert.equal(describeBattleLogEntry(indirectLifeLoss).label, '间接伤害');
});

test('御魂显示名称，禁止复活和治疗转盾不会被归为普通治疗', () => {
  const entries = presentBattleLogEntries([
    event('damage', 'needle', { kind: 'soul', id: 'soul:300036', unitId: 'wind' },
      { targetId: 'sea', damageKind: 'true', amount: 100, hpLost: 100, mitigated: 0, isCritical: false }),
    event('revive-blocked', 'block', wind, { unitId: 'sea', protectionStatusId: 'test' }),
    event('healing-converted', 'convert', wind, { targetId: 'sea', requestedAmount: 100, shieldAmount: 100, shieldStatusId: 'core.shield' })], label);
  assert.equal(battleLogOriginLabel(entries[0]), '御魂 · 蓝方·初翎山风 针女');
  assert.equal(describeBattleLogEntry(entries[0]).label, '真实伤害');
  assert.equal(describeBattleLogEntry(entries[1]).label, '禁止复活');
  assert.equal(describeBattleLogEntry(entries[2]).kind, 'shield');
});

test('数值和目标相同的两条回血保留各自事件身份，Worker 传递不丢来源', () => {
  const base = fixture()[3];
  const other = { ...base, eventId: 'other-heal', source: { kind: 'soul', id: 'soul:300036', unitId: 'skull' } };
  const entries = structuredClone(presentBattleLogEntries([base, other], label, skill));
  assert.equal(entries[0].text, entries[1].text);
  assert.notEqual(entries[0].event.eventId, entries[1].event.eventId);
  assert.notEqual(entries[0].origin.kind, entries[1].origin.kind);
});

test('切换样例及分批模拟返回相同的结构化日志，技能表被动类型可识别', async () => {
  const panel = { hp: 100, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const input = { blue: [{ heroId: 247, fourSuit: '', skillLevel: 5, panel: { ...panel, hp: 1000, attack: 10 } }],
    red: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel: { ...panel, speed: 90 } }] };
  const result = simulateBattle(input, 1);
  const sample = simulateBattleSampleDetails(input, 0);
  const progressive = await simulateBattleProgressive(input, 1, 0, () => {}, () => false);
  assert.deepEqual(sample.sampleLogEntries, result.sampleLogEntries);
  assert.deepEqual(progressive.sampleLogEntries, result.sampleLogEntries);
  assert.deepEqual(sample.sampleLogEntries.map(e => e.text), sample.sampleLog);
  assert.ok(result.sampleLogEntries.some(e => e.origin.kind === 'passive' && e.origin.label.includes('祝福之水')));
});
