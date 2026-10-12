// Run after npm run build:renderer-tests. Frames use ordinal numbers, not assumed timestamps.
const fs = require('node:fs');
const path = require('node:path');
const engine = '../dist-test-renderer/renderer/features/duel/engine/';
const { createBattleState } = require(engine + 'simulation/input-adapter.js');
const { createMigratedContentRegistry } = require(engine + 'content/register-migrated-content.js');
const { runBattle } = require(engine + 'simulation/run-battle.js');
const { EventDispatcher } = require(engine + 'core/event-dispatcher.js');
const { effectiveStats } = require(engine + 'mechanics/stats.js');
const { soulCatalog } = require('../dist-test-renderer/shared/soul-catalog-data.js');
const input = require('../tests/fixtures/duel-14pm-lineup.json');
const seed = Number(process.argv[2] ?? 1);
if (!Number.isInteger(seed) || seed < 1) throw new Error('Seed must be a positive integer');
const output = path.resolve(__dirname, '../out/fourteen-match');
fs.mkdirSync(output, { recursive: true });
const initial = createBattleState(input);
const gaugeSnapshots = [];
const dispatcher = new EventDispatcher();
for (const phase of ['turn-start', 'turn-end', 'effect-resolution']) dispatcher.register({
  id: `audit-gauge:${phase}`, phase, priority: 1000000,
  handle(context, event) {
    if (!['turn-started', 'turn-ended', 'action-gauge-changed'].includes(event.type)) return [];
    gaugeSnapshots.push({ eventId: event.eventId, eventType: event.type, actionId: event.actionId,
      source: event.source, unitId: event.unitId,
      units: Object.values(context.state.units).map(unit => ({ unitId: unit.unitId, heroId: unit.heroId,
        side: unit.side, hp: unit.hp, gauge: unit.actionGauge, turnPos: unit.turnPos,
        speed: effectiveStats(unit).speed, statuses: unit.statuses.map(status => status.statusId) })) });
    return [];
  },
});
const result = runBattle(initial, createMigratedContentRegistry(), { seed, actionLimit: 600, dispatcher });
const names = id => soulCatalog.heroes.find(hero => hero.id === initial.units[id]?.heroId)?.name ?? id;
const fire = { blue: 4, red: 4 };
const meter = { blue: 0, red: 0 };
let current;
const turns = [];
for (const event of result.events) {
  if (event.type === 'turn-started') {
    current = { ordinal: turns.length + 1, actionId: event.actionId, side: initial.units[event.unitId].side,
      actor: names(event.unitId), unitId: event.unitId, scheduling: event.scheduling ?? 'normal',
      fireBefore: { ...fire }, meterBefore: { ...meter }, actions: [], resourceChanges: [] };
    turns.push(current);
  }
  if (event.type === 'action-declared' && current) current.actions.push({ actor: names(event.intent.actorId),
    skillId: event.intent.skillId, scheduling: event.scheduling ?? 'normal', targets: event.intent.targetIds.map(names) });
  if (event.type === 'resource-changed') {
    fire[event.side] = event.after;
    current?.resourceChanges.push({ side: event.side, source: event.source.id, before: event.before, after: event.after });
  }
  if (event.type === 'resource-meter-advanced' || event.type === 'resource-meter-set') meter[event.side] = event.progressAfter;
  if (current) { current.fireAfter = { ...fire }; current.meterAfter = { ...meter }; }
}
fs.writeFileSync(path.join(output, `sim-${seed}.json`), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(output, `turns-${seed}.json`), JSON.stringify(turns, null, 2));
fs.writeFileSync(path.join(output, `gauges-${seed}.json`), JSON.stringify(gaugeSnapshots, null, 2));
console.log(`seed=${seed}, winner=${result.winner}, reason=${result.reason}`);
for (const turn of turns) console.log(`${turn.ordinal}. ${turn.side} ${turn.actor} [${turn.scheduling}] `
  + `fire=${JSON.stringify(turn.fireBefore)} -> ${JSON.stringify(turn.fireAfter)} `
  + `skills=${turn.actions.map(action => `${action.actor}:${action.skillId}:${action.scheduling}`).join(',')}`);
