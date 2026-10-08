#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function importRows(source, decodedFile, capturedFile) {
  const rows = {}, sources = [], runtimeAnchorConflicts = [];
  let runtimeAnchorCount = 0;
  const tables = [
    ['table_DATA_SKILL.json', 'merge'], ['qianji_rows.json', 'merge'],
    ...(decodedFile ? [[path.resolve(decodedFile), 'merge']] : []),
    ...(capturedFile ? [[path.resolve(capturedFile), 'runtime-truth']] : []),
  ];
  for (const [filename, mode] of tables) {
    const file = path.isAbsolute(filename) ? filename : path.join(source, filename);
    if (!fs.existsSync(file)) continue;
    const table = JSON.parse(fs.readFileSync(file, 'utf8'));
    sources.push(path.basename(filename));
    for (const [key, value] of Object.entries(table)) {
      const match = /^[([]\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*[)\]]$/.exec(key);
      if (!match || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid skill row: ${filename}: ${key}`);
      const canonical = match.slice(1).map(Number).join(':');
      if (mode === 'runtime-truth') {
        runtimeAnchorCount++;
        const previous = rows[canonical];
        if (previous) for (const [field, actual] of Object.entries(value)) {
          if (field === '_proto_key' || !(field in previous) || JSON.stringify(previous[field]) === JSON.stringify(actual)) continue;
          runtimeAnchorConflicts.push({ key: canonical, field, previous: previous[field], captured: actual });
        }
        // Live client-decoded rows have the authoritative (skillId, level, awake) key.
        rows[canonical] = value;
      } else {
        rows[canonical] = { ...rows[canonical], ...value };
      }
    }
  }
  if (!sources.length) throw new Error('No decoded skill rows found');
  const heroes = JSON.parse(fs.readFileSync(path.join(source, 'table_DATA_HERO.json'), 'utf8'));
  const ids = new Set(Object.keys(rows).map(key => Number(key.split(':')[0])));
  const requiredIds = [...new Set(Object.values(heroes).flatMap(hero => hero.skill ?? []).map(Number).filter(id => id > 0))].sort((a, b) => a - b);
  return { schemaVersion: 1, source: sources, rows, coverage: { rowCount: Object.keys(rows).length, skillCount: ids.size,
    requiredSkillCount: requiredIds.length, missingSkillIds: requiredIds.filter(id => !ids.has(id)),
    complete: requiredIds.every(id => ids.has(id)) && ids.size >= 1500,
    runtimeAnchorCount,
    runtimeAnchorConflictCount: runtimeAnchorConflicts.length, runtimeAnchorConflicts } };
}

module.exports = { importRows };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/import-duel-skill-rows.cjs <client export directory> [decoded rows.json] [live captured rows.json]');
  const result = importRows(path.resolve(process.argv[2]), process.argv[3], process.argv[4]);
  fs.writeFileSync(path.resolve(__dirname, '../src/shared/game-skill-data.generated.json'), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ rows: result.coverage.rowCount, skills: result.coverage.skillCount,
    required: result.coverage.requiredSkillCount, missing: result.coverage.missingSkillIds.length, complete: result.coverage.complete,
    runtimeAnchors: result.coverage.runtimeAnchorCount, anchorConflicts: result.coverage.runtimeAnchorConflictCount }));
}
