// Diagnostic replay: compare identical samples, changing only the old skull death guard.
const fs = require('node:fs');
const path = require('node:path');
const engine = '../dist-test-renderer/renderer/features/duel/engine/';
const { createBattleState } = require(engine + 'simulation/input-adapter.js');
const { createMigratedContentRegistry } = require(engine + 'content/register-migrated-content.js');
const { runBattle } = require(engine + 'simulation/run-battle.js');
const input = require('../tests/fixtures/duel-10am-lineup.json');
const sampleCount = Number(process.argv[2] ?? 10);
const baseSeed = Number(process.argv[3] ?? 1);
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 1000)
  throw new Error('Sample count must be 1..1000');
if (!Number.isInteger(baseSeed) || baseSeed < 1) throw new Error('Seed must be a positive integer');
const rows = [];
for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
  const pair = { sampleIndex };
  for (const priorRule of [true, false]) {
    const registry = createMigratedContentRegistry();
    if (priorRule) {
      // Counterfactual in this diagnostic registry only: restore the previous unconditional guard.
      const hero = registry.getHero(585);
      const handle = hero.handlers['unit-defeated'].handle;
      hero.handlers['unit-defeated'].handle = (context, event) => handle(context,
        event.type === 'unit-defeated' && context.getUnit(event.unitId)?.heroId === 585
          ? { ...event, defeatCause: 'life-loss' } : event);
    }
    const result = runBattle(createBattleState(input), registry, { seed: baseSeed, sampleIndex, actionLimit: 600 });
    pair[priorRule ? 'priorRule' : 'fixedRule'] = { seed: result.seed, winner: result.winner, reason: result.reason,
      skullRevives: result.events.filter(event => event.type === 'unit-revived' && event.unitId === 'red:2:585').length };
  }
  rows.push(pair);
}
const output = path.resolve(__dirname, '../out/ten-match');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, `winrate-paired-${baseSeed}-${sampleCount}.json`), JSON.stringify(rows, null, 2));
for (const rule of ['priorRule', 'fixedRule']) {
  const blue = rows.filter(row => row[rule].winner === 'blue').length;
  const red = rows.filter(row => row[rule].winner === 'red').length;
  console.log(`${rule}: blue=${blue}/${sampleCount}, red=${red}/${sampleCount}, draw=${sampleCount - blue - red}`);
}
