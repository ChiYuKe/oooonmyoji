// Run after npm run build:renderer-tests. Reproducible samples, not an estimate of real win rate.
const fs = require('node:fs');
const path = require('node:path');
const engine = '../dist-test-renderer/renderer/features/duel/engine/';
const { createBattleState } = require(engine + 'simulation/input-adapter.js');
const { createMigratedContentRegistry } = require(engine + 'content/register-migrated-content.js');
const { runBattle } = require(engine + 'simulation/run-battle.js');
const input = require('../tests/fixtures/duel-14pm-lineup.json');
const count = Number(process.argv[2] ?? 10);
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Sample count must be 1..1000');
const rows = [];
for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
  const result = runBattle(createBattleState(input), createMigratedContentRegistry(), { seed: 1, sampleIndex, actionLimit: 600 });
  rows.push({ sampleIndex, seed: result.seed, winner: result.winner, reason: result.reason,
    opening: result.events.filter(event => event.type === 'action-declared' && (event.scheduling ?? 'normal') === 'normal')
      .slice(0, 17).map(event => ({ actor: event.intent.actorId, skill: event.intent.skillId, targets: event.intent.targetIds })) });
}
const output = path.resolve(__dirname, '../out/fourteen-match');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, `samples-final-1-${count}.json`), JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ count, blue: rows.filter(row => row.winner === 'blue').length,
  red: rows.filter(row => row.winner === 'red').length, other: rows.filter(row => !['blue', 'red'].includes(row.winner)).length }));
