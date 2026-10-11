const { test } = require('node:test');
const assert = require('node:assert/strict');
const root = '../dist-test-renderer/renderer/features/duel/engine/';
const { ContentRegistry } = require(root + 'content/registry.js');
const { runBattle } = require(root + 'simulation/run-battle.js');
const { applyEffectCommands } = require(root + 'core/effects.js');
const { settleEvents } = require(root + 'core/settlement.js');
const { EventDispatcher } = require(root + 'core/event-dispatcher.js');
const { captureTurnStatusExpirySnapshot, advanceStatusDurations } = require(root + 'core/status-lifecycle.js');
const { registerBoneGirl, boneGirlIds } = require(root + 'content/bone-girl.js');
const { registerNineLivedCat, nineLivedCatIds } = require(root + 'content/nine-lived-cat.js');
const { passiveSuppressionStatusId } = require(root + 'core/passive-eligibility.js');
const { createMigratedContentRegistry } = require(root + 'content/register-migrated-content.js');
const { ichigoIds } = require(root + 'content/ichigo.js');
const { cicadaSnowMaidenIds } = require(root + 'content/cicada-snow-maiden.js');
const { kawaArakawaIds } = require(root + 'content/kawa-arakawa.js');
const { jumpingSisterIds } = require(root + 'content/jumping-sister.js');
const { sesshomaruIds } = require(root + 'content/sesshomaru.js');

const source = { kind: 'skill', id: 'test', unitId: 'blue' };
function status(id, owner = 'permanent', remaining = 1, unitId = 'blue', values) {
  return { instanceId: id, statusId: id, source: { ...source, unitId }, stacks: 1,
    duration: owner === 'permanent' ? { kind: 'permanent' } : { kind: 'count', owner, remaining },
    ...(values ? { values } : {}) };
}
function initialState() {
  const unit = (unitId, side, speed) => ({ unitId, side, heroId: 1, skillLevel: 5, hp: 1000, shield: 0,
    actionGauge: 0, resources: {}, statuses: [],
    stats: { hp: 1000, attack: 10, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 } });
  return { units: { blue: unit('blue', 'blue', 100), red: unit('red', 'red', 110) },
    sides: { blue: ['blue'], red: ['red'] }, resources: { blue: { fire: 0 }, red: { fire: 0 } },
    resourceMeters: Object.fromEntries(['blue', 'red'].map(side => [side,
      { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } }])),
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}
function define(registry, id, category = 'buff', extra = {}) {
  registry.registerStatus({ id, category, dispellable: true, sealable: true,
    mechanicsCoverage: 'verified', durationOwner: 'permanent', refreshPolicy: 'replace', ...extra });
}
function idleRegistry(handlers = {}, execute = () => []) {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, mechanicsCoverage: 'verified', aiCoverage: 'verified', handlers,
    skills: [{ id: 'idle', actionKind: 'skill', target: 'self', targetRelation: 'ally', levels: [{}], execute }],
    policy(_context, actorId) { return { actorId, skillId: 'idle', targetIds: [actorId], shape: 'self', targetRelation: 'ally' }; } });
  return registry;
}
function resolve(registry, state, commands, dispatcher = new EventDispatcher(), prefix = 'test-effects') {
  const result = applyEffectCommands(state, commands, 'effect-resolution', prefix, id => registry.getStatus(id));
  return settleEvents(result.state, result.events, dispatcher, () => .5, undefined, id => registry.getStatus(id));
}
function defeat(registry, state, dispatcher, type = 'lose-life', prefix = 'death') {
  return resolve(registry, state, [{ type, source, targetId: 'red', amount: 100000, isCritical: false }], dispatcher, prefix);
}

test('完整战斗按施法者、持有者及整轮分别到期，永久状态保留', () => {
  const registry = idleRegistry(); const state = initialState();
  for (const id of ['source-clock', 'target-clock', 'round-clock', 'permanent']) define(registry, id);
  state.units.red.statuses = [status('source-clock', 'source-turn'), status('target-clock', 'target-turn'),
    status('round-clock', 'round'), status('permanent')];
  const first = runBattle(state, registry, { seed: 1, actionLimit: 1 });
  assert.deepEqual(first.state.units.red.statuses.map(s => s.statusId), ['source-clock', 'round-clock', 'permanent']);
  const result = runBattle(state, registry, { seed: 1, actionLimit: 2 });
  assert.deepEqual(result.events.filter(e => e.type === 'turn-started').map(e => e.unitId), ['red', 'blue']);
  assert.deepEqual(result.state.units.red.statuses.map(s => s.statusId), ['permanent']);
  assert.equal(result.state.counters.round, 2);
  const expired = result.events.filter(e => e.type === 'status-removed');
  assert.deepEqual(expired.map(e => e.statusId), ['target-clock', 'source-clock', 'round-clock']);
  assert.ok(expired.every(e => e.reason === 'expired' && e.statusCategory === 'buff'));
});

test('本回合新施加的施法者时钟不立即扣减，本轮标记在本轮结束到期', () => {
  const registry = idleRegistry({}, (_context, intent) => intent.actorId === 'blue'
    ? ['source-new', 'round-new'].map(id => ({ type: 'add-status', source, targetId: 'red',
      instance: status(id, id === 'source-new' ? 'source-turn' : 'round') })) : []);
  for (const id of ['source-new', 'round-new']) define(registry, id);
  const result = runBattle(initialState(), registry, { seed: 1, actionLimit: 2 });
  assert.deepEqual(result.state.units.red.statuses.map(s => s.statusId), ['source-new']);
  assert.equal(result.state.units.red.statuses[0].duration.remaining, 1);
  assert.ok(result.events.some(e => e.type === 'status-removed' && e.statusId === 'round-new' && e.reason === 'expired'));
});

test('同实例刷新或替换即使共享父事件，也不会被旧回合快照提前扣减', () => {
  for (const policy of ['refresh-duration', 'replace', 'add-stack']) {
    const registry = idleRegistry(); define(registry, 'refresh', 'buff', { refreshPolicy: policy });
    const original = applyEffectCommands(initialState(), [{ type: 'add-status', source, targetId: 'red',
      parentEventId: 'shared-parent', instance: status('refresh', 'source-turn') }], 'effect-resolution', 'original', id => registry.getStatus(id));
    const snapshot = captureTurnStatusExpirySnapshot(original.state, 'blue');
    const refreshed = applyEffectCommands(original.state, [{ type: 'add-status', source, targetId: 'red',
      parentEventId: 'shared-parent', instance: { ...original.state.units.red.statuses[0], duration: { kind: 'count', owner: 'source-turn', remaining: 2 } } }],
    'effect-resolution', 'refresh', id => registry.getStatus(id));
    const currentTurn = advanceStatusDurations(refreshed.state, snapshot);
    assert.equal(currentTurn.state.units.red.statuses[0].duration.remaining, 2, policy);
    const nextTurn = advanceStatusDurations(currentTurn.state, captureTurnStatusExpirySnapshot(currentTurn.state, 'blue'));
    assert.equal(nextTurn.state.units.red.statuses[0].duration.remaining, 1, policy);
  }
});

test('整轮到期触发产生的新状态留到下一轮，移除事件可以驱动内容回调', () => {
  const registry = idleRegistry({ 'status-expiration': { priority: 1, handle(_context, event) {
    if (event.type === 'status-removed' && event.statusId === 'round-original') return [
      { type: 'add-status', source, targetId: 'red', instance: status('round-child', 'round') }];
  } } });
  define(registry, 'round-original'); define(registry, 'round-child');
  const state = initialState(); state.units.red.statuses = [status('round-original', 'round')];
  const firstRound = runBattle(state, registry, { seed: 1, actionLimit: 2 });
  assert.deepEqual(firstRound.state.units.red.statuses.map(s => s.statusId), ['round-child']);
  const secondRound = runBattle(state, registry, { seed: 1, actionLimit: 4 });
  assert.deepEqual(secondRound.state.units.red.statuses, []);
});

for (const scheduling of ['extra-turn', 'assist']) {
  test(`完整战斗 ${scheduling} ${scheduling === 'extra-turn' ? '推进' : '不推进'}施法者及持有者时钟`, () => {
    const registry = idleRegistry({ 'action-end': { priority: 1, handle(context, event) {
      if (event.type === 'action-ended' && !event.scheduling && event.intent?.actorId === 'blue' && context.state.counters.action === 1) return [
        { type: 'schedule-action', source, scheduling, intent: { actorId: 'blue', skillId: 'idle', targetIds: ['blue'], shape: 'self', targetRelation: 'ally' } }];
    } } });
    define(registry, 'source-extra'); define(registry, 'target-extra');
    const state = initialState(); state.units.blue.stats.speed = 120;
    state.units.red.statuses = [status('source-extra', 'source-turn', 2)];
    state.units.blue.statuses = [status('target-extra', 'target-turn', 2)];
    const result = runBattle(state, registry, { seed: 1, actionLimit: 2 });
    assert.equal(result.events.filter(e => e.type === 'action-declared').length, scheduling === 'extra-turn' ? 2 : 3);
    if (scheduling === 'extra-turn') {
      assert.deepEqual(result.state.units.red.statuses, []); assert.deepEqual(result.state.units.blue.statuses, []);
      assert.equal(result.events.filter(e => e.type === 'turn-started').length, 2);
    } else {
      assert.equal(result.state.units.red.statuses[0].duration.remaining, 1);
      assert.equal(result.state.units.blue.statuses[0].duration.remaining, 1);
      assert.equal(result.events.filter(e => e.type === 'turn-started').length, 2);
    }
  });
}

for (const damageType of ['deal-damage', 'lose-life']) {
  test(`${damageType} 致死按 keepOnDie 清理，重复死亡事件不会重复清理，复活不带回减益`, () => {
    const registry = idleRegistry();
    for (const [id, category] of [['ordinary-buff', 'buff'], ['ordinary-debuff', 'debuff'], ['control', 'control'], ['shield', 'shield'], ['unknown', 'other']]) {
      if (id !== 'unknown') define(registry, id, category);
    }
    define(registry, 'retained', 'buff', { keepOnDie: true });
    define(registry, 'retained-control', 'control', { keepOnDie: true });
    const state = initialState(); state.units.red.shield = 10; state.units.red.resources.extHp = 20;
    state.units.red.statuses = ['ordinary-buff', 'ordinary-debuff', 'control', 'shield', 'unknown', 'retained', 'retained-control']
      .map(id => status(id, 'permanent', 1, 'red', id === 'shield' ? { shieldRemaining: 30 } : undefined));
    const result = defeat(registry, state, undefined, damageType);
    assert.equal(result.state.units.red.hp, 0);
    assert.equal(result.state.units.red.shield, 0); assert.equal(result.state.units.red.resources.extHp, 0);
    assert.deepEqual(result.state.units.red.statuses.map(s => s.statusId), ['retained', 'retained-control']);
    const removals = result.events.filter(e => e.type === 'status-removed' && e.reason === 'died');
    // A shield consumed by the fatal hit has already been removed before death cleanup.
    assert.ok(removals.some(e => e.statusId === 'ordinary-debuff' && e.statusCategory === 'debuff'));
    const death = result.events.find(e => e.type === 'unit-defeated');
    assert.ok(removals.every(e => e.parentEventId === death.eventId));
    const duplicate = settleEvents(result.state, [death], new EventDispatcher(), () => .5, undefined, id => registry.getStatus(id));
    assert.equal(duplicate.events.filter(e => e.type === 'status-removed').length, 0);
    const revived = resolve(registry, result.state, [{ type: 'revive', source, targetId: 'red', hp: 500 }]);
    assert.equal(revived.state.units.red.hp, 500);
    assert.deepEqual(revived.state.units.red.statuses.map(s => s.statusId), ['retained', 'retained-control']);
    const again = resolve(registry, revived.state, [{ type: 'add-status', source, targetId: 'red', instance: status('ordinary-debuff') }]);
    assert.ok(defeat(registry, again.state, undefined, damageType, 'second-death').events
      .some(e => e.type === 'status-removed' && e.statusId === 'ordinary-debuff' && e.reason === 'died'));
  });
}

test('死亡回调读取旧状态，新产生的状态在死亡和同步复活后保留', () => {
  for (const revive of [false, true]) {
    const registry = idleRegistry(); define(registry, 'old'); define(registry, 'new');
    const state = initialState(); state.units.red.statuses = [status('old')];
    const dispatcher = new EventDispatcher();
    dispatcher.register({ id: 'defeat-test', phase: 'unit-defeated', priority: 1, handle(context, event) {
      assert.ok(context.getUnit(event.unitId).statuses.some(s => s.statusId === 'old'));
      return [{ type: 'add-status', source, targetId: event.unitId, instance: status('new') },
        ...(revive ? [{ type: 'revive', source, targetId: event.unitId, hp: 200 }] : [])];
    } });
    const result = defeat(registry, state, dispatcher);
    assert.deepEqual(result.state.units.red.statuses.map(s => s.statusId), ['new']);
    assert.equal(result.state.units.red.hp, revive ? 200 : 0);
    assert.equal(result.state.units.red.deathCleanupPending, false);
    assert.equal(result.state.units.red.deathCleanupSnapshot, undefined);
  }
});

test('效果命令内死亡后立即复活也会清理，其他单位身上的施法者状态不连带移除', () => {
  const registry = idleRegistry(); define(registry, 'debuff'); define(registry, 'other-unit');
  const state = initialState(); state.units.red.statuses = [status('debuff')];
  state.units.blue.statuses = [status('other-unit', 'source-turn', 2, 'red')];
  const result = resolve(registry, state, [{ type: 'lose-life', source, targetId: 'red', amount: 1000 },
    { type: 'revive', source, targetId: 'red', hp: 200 }]);
  assert.equal(result.state.units.red.hp, 200); assert.deepEqual(result.state.units.red.statuses, []);
  assert.equal(result.state.units.blue.statuses.length, 1);
  assert.equal(result.events.filter(e => e.type === 'status-removed' && e.reason === 'died').length, 1);
});

for (const [register, ids, stackId] of [[registerBoneGirl, boneGirlIds, boneGirlIds.resentment],
  [registerNineLivedCat, nineLivedCatIds, nineLivedCatIds.lives]]) {
  for (const sealed of [false, true]) {
    test(`${ids.hero} 死亡被动读取层数和封印，sealed=${sealed}`, () => {
      const registry = new ContentRegistry(); register(registry);
      const state = initialState(); state.units.red.heroId = ids.hero;
      state.units.red.statuses = [{ ...status(stackId, 'permanent', 1, 'red'), stacks: 4 },
        ...(sealed ? [status(passiveSuppressionStatusId, 'target-turn')] : [])];
      const dispatcher = new EventDispatcher();
      for (const [phase, handler] of Object.entries(registry.getHero(ids.hero).handlers)) {
        dispatcher.register({ id: `hero:${ids.hero}:${phase}`, phase, ...handler });
      }
      const result = defeat(registry, state, dispatcher);
      assert.equal(result.state.units.red.hp, sealed ? 0 : 200);
      assert.deepEqual(result.state.units.red.statuses, []);
      assert.equal(result.events.some(e => e.type === 'unit-revived'), !sealed);
    });
  }
}

test('游戏明确保留的凝结、禁止复活、灵魂姿态及复活冷却已声明 keepOnDie', () => {
  const registry = createMigratedContentRegistry();
  for (const id of [cicadaSnowMaidenIds.crystallized, cicadaSnowMaidenIds.defenseAura, ichigoIds.noRevive,
    kawaArakawaIds.spirit, jumpingSisterIds.growUp, jumpingSisterIds.reviveCooldown,
    jumpingSisterIds.reviveCount, sesshomaruIds.wound]) {
    assert.equal(registry.getStatus(id)?.keepOnDie, true, id);
  }
  const state = initialState(); state.units.red.statuses = [status(ichigoIds.noRevive)];
  const killed = defeat(registry, state);
  const revived = resolve(registry, killed.state, [{ type: 'revive', source, targetId: 'red', hp: 500 }]);
  assert.equal(revived.state.units.red.hp, 0);
  assert.ok(revived.events.some(e => e.type === 'revive-blocked' && e.protectionStatusId === ichigoIds.noRevive));
});

test('致命保护把生命保在 1 时不触发死亡清理', () => {
  const registry = idleRegistry(); define(registry, 'guard', 'buff', { preventsLethalDamage: true }); define(registry, 'buff');
  const state = initialState(); state.units.red.statuses = [status('guard'), status('buff')];
  const result = defeat(registry, state, undefined, 'deal-damage');
  assert.equal(result.state.units.red.hp, 1);
  assert.ok(result.state.units.red.statuses.some(s => s.statusId === 'buff'));
  assert.ok(!result.events.some(e => e.type === 'unit-defeated' || e.type === 'status-removed' && e.reason === 'died'));
});
