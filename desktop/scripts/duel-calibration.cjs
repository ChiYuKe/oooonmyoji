#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function rosterInput(match, panels) {
  if (panels) return panels;
  if (match.my_group !== 0 && match.my_group !== 1) throw new Error(`Unknown left-side mapping: ${match.time}`);
  const { heroBaseOf } = require('../dist-test-renderer/shared/hero-base-data.generated.js');
  const fighters = ids => ids.map(heroId => {
    const entry = heroBaseOf(heroId);
    if (!entry) throw new Error(`Missing base panel: hero ${heroId}, match ${match.time}`);
    return { heroId, fourSuit: '', skillLevel: 5, panel: entry.panel ?? entry.base ?? entry };
  });
  // build_guess_dataset.py: left is the user's BET side, not a fixed red/blue side.
  const own = fighters(match.left_heroes), opponent = fighters(match.right_heroes);
  return match.my_group === 0 ? { red: own, blue: opponent } : { blue: own, red: opponent };
}

function evaluate(dataset, predictions) {
  if (!dataset.length) throw new Error('Empty dataset');
  const seen = new Set();
  const bins = Array.from({ length: 10 }, (_, index) => ({ bin: `${index / 10}-${(index + 1) / 10}`, n: 0, sum: 0, positives: 0 }));
  let correct = 0, brier = 0, logloss = 0;
  for (const match of dataset) {
    const key = String(match.time);
    if (seen.has(key)) throw new Error(`Duplicate match time: ${key}`);
    seen.add(key);
    if (!['红方', '蓝方'].includes(match.official_winner)) throw new Error(`Unknown winner: ${key}`);
    const p = predictions[key]?.p_red;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Missing or invalid prediction: ${key}`);
    const y = match.official_winner === '红方' ? 1 : 0;
    correct += Number((p > .5) === (y === 1));
    brier += (p - y) ** 2;
    logloss -= y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++; bin.sum += p; bin.positives += y;
  }
  const n = dataset.length;
  return { n, accuracy: correct / n, brier: brier / n, logloss: logloss / n,
    acceptance: { brier: brier / n < .25, logloss: logloss / n < Math.log(2) },
    calibration: bins.filter(bin => bin.n).map(bin => ({ bin: bin.bin, n: bin.n, mean_p: bin.sum / bin.n, rate: bin.positives / bin.n })) };
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const datasetPath = option('--dataset');
  if (!datasetPath) throw new Error('Usage: node scripts/duel-calibration.cjs --dataset <guess_dataset.json> [--runs 200] [--out out/duel-fidelity] [--inputs <panels-and-souls.json>]');
  const runs = Number(option('--runs', '200'));
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const out = path.resolve(option('--out', path.resolve(__dirname, '../out/duel-fidelity')));
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const inputPath = option('--inputs');
  const inputs = inputPath ? JSON.parse(fs.readFileSync(inputPath, 'utf8')) : undefined;
  const { createBattleState } = require('../dist-test-renderer/renderer/features/duel/engine/simulation/input-adapter.js');
  const { createMigratedContentRegistry } = require('../dist-test-renderer/renderer/features/duel/engine/content/register-migrated-content.js');
  const { runBattle } = require('../dist-test-renderer/renderer/features/duel/engine/simulation/run-battle.js');
  const registry = createMigratedContentRegistry();
  const predictions = {}, diagnostics = {};
  for (const match of dataset) {
    if (inputs && !inputs[String(match.time)]) throw new Error(`Missing explicit input: ${match.time}`);
    const initial = createBattleState(rosterInput(match, inputs?.[String(match.time)]));
    let red = 0, draw = 0, valid = 0, actionLimit = 0, invalid = 0;
    for (let index = 0; index < runs; index++) {
      const result = runBattle(initial, registry, { seed: Number(match.time) >>> 0, sampleIndex: index,
        captureEvents: false, ruleVersion: 'game-fidelity-v2' });
      diagnostics[String(match.time)] ??= result.diagnostics;
      if (result.reason === 'trigger-budget') { invalid++; continue; }
      valid++;
      if (result.reason === 'action-limit') actionLimit++;
      if (result.winner === 'red') red++;
      if (result.winner === 'draw') draw++;
    }
    if (!valid) throw new Error(`All runs invalid: ${match.time}`);
    predictions[String(match.time)] = { p_red: (red + draw / 2) / valid, n_sims: runs, valid_sims: valid,
      draws: draw, invalid_sims: invalid, action_limit_sims: actionLimit };
    console.log(`${match.time}: p_red=${predictions[String(match.time)].p_red.toFixed(4)}, valid=${valid}/${runs}`);
  }
  const report = { ...evaluate(dataset, predictions), ruleVersion: 'game-fidelity-v2', n_sims_per_match: runs,
    inputMode: inputs ? 'explicit-panels-and-souls' : 'base-panels-only',
    limitations: inputs ? [] : ['Historical panels, point allocations, souls and ranks were not captured. Six-star level-40 base panels, no souls, rank 5 are explicit assumptions.'],
    diagnostics };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'guess_dataset.json'), JSON.stringify(dataset, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'predictions.json'), JSON.stringify(predictions, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'validation_report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ n: report.n, accuracy: report.accuracy, brier: report.brier, logloss: report.logloss, acceptance: report.acceptance, inputMode: report.inputMode }));
}

module.exports = { rosterInput, evaluate };
if (require.main === module) main();
