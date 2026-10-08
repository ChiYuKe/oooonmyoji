import generated from './game-skill-data.generated.json';

export type GameSkillRow = Readonly<Record<string, unknown>>;
const rows: Readonly<Record<string, GameSkillRow>> = generated.rows;
export const gameSkillCoverage = generated.coverage;
const ranks = new Map<string, number>();
for (const key of Object.keys(rows)) {
  const [id, level, awake] = key.split(':');
  const variant = `${id}:${awake}`;
  ranks.set(variant, Math.max(ranks.get(variant) ?? 0, Number(level)));
}

/** Battle-wide fallback ranks mean "up to this rank"; native per-skill maxima can be lower. */
export function battleSkillRow(skillId: string | number, level: number, awakeFilter?: number,
  monster = false): GameSkillRow | undefined {
  const variants = awakeFilter === undefined ? monster ? [2, -1] : [-1, 1] : [awakeFilter];
  for (const awake of variants) {
    const maxRank = ranks.get(`${skillId}:${awake}`);
    if (maxRank !== undefined) return gameSkillRow(skillId, Math.min(level, maxRank), awake);
  }
  return undefined;
}

/** Sparse level/awake variants inherit only the explicitly recorded _proto_key base. */
export function gameSkillRow(skillId: string | number, level: number, awakeFilter = -1): GameSkillRow | undefined {
  const key = `${skillId}:${level}:${awakeFilter}`;
  const visited = new Set<string>();
  const resolve = (rowKey: string): GameSkillRow | undefined => {
    const row = rows[rowKey];
    if (!row || visited.has(rowKey)) return undefined;
    visited.add(rowKey);
    const baseKey = Array.isArray(row._proto_key) ? row._proto_key.join(':') : undefined;
    const base = baseKey && baseKey !== rowKey ? resolve(baseKey) : undefined;
    return base ? { ...base, ...row } : row;
  };
  return resolve(key);
}

export function skillNumber(row: GameSkillRow | undefined, field: string): number | undefined {
  const value = row?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
