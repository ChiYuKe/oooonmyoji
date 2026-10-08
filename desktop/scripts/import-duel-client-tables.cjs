#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/import-duel-client-tables.cjs <directory containing table_*.json exports>');
  process.exit(2);
}

const root = path.resolve(sourceDir);
const outputPath = path.resolve(__dirname, '../src/shared/game-battle-data.generated.json');
const heroFields = ['protoid', 'name', 'atkStarSt', 'hpStarSt', 'attackDelta', 'hpDelta', 'defenseDelta',
  'baseCritRate', 'baseCritPower', 'baseSpeed', 'skill', 'awakeAttr', 'awakeIncAttackDelta', 'awakeIncHpDelta',
  'awakeIncDefenseDelta', 'awakeIncBaseSpeed', 'awakeIncBaseCritRate', 'awakeIncBaseCritPower'];
const buffFields = ['attrList', 'value1', 'value2', 'param1', 'param2', 'param3', 'param4', 'param5', 'buffType',
  'effect', 'keepOnDie', 'disableYuHun', 'disablePassiveSkill', 'guiHuoRecover', 'buffDesc'];
const constantNames = ['DEFENSE_CORRECT_FACTOR', 'AOE_SKILL_TO_SHIELD_DMG_RATE', 'MAX_DAMAGE_LIMIT',
  'MOTION_SLOT_MAX_LEN', 'MOTION_FULL_TURN_MOVE_SPEED', 'BOUT_TIME_OUT', 'GUIHUO_ICON_ADD_VALUES',
  'GUIHUO_POOL_CAPACITY', 'MAX_PLAYER_GUIHUO', 'MAX_SH_GUIHUO', 'YYS_BOUT_ADD_GUIHUO',
  'SS_MONSTER_BOUT_ADD_GUIHUO', 'MAX_GUIHUO_LIMIT', 'CONTINUE_HURT_LIMIT', 'SHIELD_AVERAGE_RADIUS'];

function readTable(candidates, required = true) {
  const filename = candidates.find(candidate => fs.existsSync(path.join(root, candidate)));
  if (!filename) {
    if (required) throw new Error(`Missing table export: ${candidates.join(' or ')}`);
    return undefined;
  }
  const value = JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid table object: ${filename}`);
  return { filename, value };
}

function projectFields(value, fields) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key)));
}

function rowsFrom(table, fields, idName) {
  const rows = [];
  for (const [key, value] of Object.entries(table.value)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = projectFields(value, fields);
    const id = Number(value.protoid ?? value.id ?? key);
    rows.push({ ...(Number.isFinite(id) ? { [idName]: id } : {}), ...row });
  }
  return rows;
}

const heroTable = readTable(['table_DATA_HERO.json']);
const buffTable = readTable(['table_DATA_BUFF.json']);
const soulTable = readTable(['table_EQUIP_SUIT.json']);
const heroMakeTable = readTable(['table_HERO_MAKE.json']);
const constTable = readTable(['table_CONST.json']);
const equipAttr = readTable(['table_EQUIP_ATTR.json', 'table_equip_attr_holder0.json'], false);
const equipUpgrade = readTable(['table_EQUIP_UPGRADE.json', 'table_equip_upgrade_holder0.json'], false);
const randomAttr = readTable(['table_RUNE_RANDOM_ATTR.json', 'table_rune_random_attr_holder0.json'], false);
const starLevel = readTable(['table_STAR_LEVEL.json', 'table_star_level_holder0.json'], false);

const heroes = rowsFrom(heroTable, heroFields, 'id');
const buffs = Object.entries(buffTable.value).flatMap(([key, value]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const match = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/.exec(key);
  if (!match) return [];
  return [{ buffId: Number(match[1]), level: Number(match[2]), ...projectFields(value, buffFields) }];
});
const constants = Object.fromEntries(constantNames.filter(name => {
  const value = constTable.value[name];
  return typeof value === 'number' || typeof value === 'string' || Array.isArray(value);
}).map(name => [name, constTable.value[name]]));
const tableRefs = { heroes: heroTable.filename, buffs: buffTable.filename, souls: soulTable.filename,
  heroMake: heroMakeTable.filename, constants: constTable.filename,
  ...(equipAttr ? { equipAttr: equipAttr.filename } : {}), ...(equipUpgrade ? { equipUpgrade: equipUpgrade.filename } : {}),
  ...(randomAttr ? { randomAttr: randomAttr.filename } : {}), ...(starLevel ? { starLevel: starLevel.filename } : {}) };

const result = {
  schemaVersion: 1,
  source: { tableRefs, rowCounts: { heroes: heroes.length, buffs: buffs.length,
    souls: Object.keys(soulTable.value).length, heroMake: Object.keys(heroMakeTable.value).length,
    constants: Object.keys(constTable.value).length } },
  heroes,
  buffs,
  souls: Object.values(soulTable.value),
  heroMake: Object.values(heroMakeTable.value),
  equipment: {
    ...(equipAttr ? { attr: Object.values(equipAttr.value) } : {}),
    ...(equipUpgrade ? { upgrade: Object.values(equipUpgrade.value) } : {}),
    ...(randomAttr ? { randomAttr: Object.values(randomAttr.value) } : {}),
    ...(starLevel ? { starLevel: Object.values(starLevel.value) } : {}),
  },
  constants,
};

if (heroes.length < 1000 || buffs.length < 7000 || result.source.rowCounts.souls < 50
  || result.source.rowCounts.heroMake !== 8 || constants.DEFENSE_CORRECT_FACTOR !== 300) {
  throw new Error(`Export looks incomplete: ${JSON.stringify(result.source.rowCounts)}`);
}
fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, 'utf8');
console.log(`Imported ${heroes.length} heroes, ${buffs.length} buffs, ${result.source.rowCounts.souls} souls, ${result.source.rowCounts.heroMake} point slots.`);
