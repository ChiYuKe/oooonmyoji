#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/import-luandou-points.cjs <directory containing table_HERO_MAKE.json>');
  process.exit(2);
}

const sourcePath = path.resolve(sourceDir, 'table_HERO_MAKE.json');
const outputPath = path.resolve(__dirname, '../src/shared/luandou-points-data.ts');
const rows = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const rules = Array.from({ length: 8 }, (_, slot) => {
  const row = rows[String(slot)];
  if (!row || row.id !== slot || typeof row.attr !== 'string'
    || !Number.isFinite(row.max_add_point) || !Number.isFinite(row.add_attr)) {
    throw new Error(`Invalid HERO_MAKE row ${slot} in ${sourcePath}`);
  }
  return { slot, stat: row.attr, maxPoints: row.max_add_point, perPoint: row.add_attr };
});

const sourceLabel = path.basename(path.resolve(sourceDir));
const output = `// Generated from ${sourceLabel}/table_HERO_MAKE.json. Re-run scripts/import-luandou-points.cjs after refreshing the game export.\n`
  + `export const luandouPointRules = ${JSON.stringify(rules, null, 2)} as const;\n`;
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Imported ${rules.length} HERO_MAKE slots to ${path.relative(process.cwd(), outputPath)}`);
