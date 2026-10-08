import { soulCatalog } from '../../../../../shared/soul-catalog-data';
import { heroBaseOf } from '../../../../../shared/hero-base-data.generated';
import { applyLuandouPoints } from '../../../../../shared/luandou-points';
import type { Panel } from '../../../../../shared/soul-optimizer';
import { battleMaxHp } from '../mechanics/battle-hp';
import type { BattleFighterInput, DuelBattleInput, SideId } from '../types';
import type { BattleState, UnitState } from '../core/types';

const emptyPanel: Panel = { hp: 0, attack: 0, defense: 0, speed: 0, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };

/** Converts the existing roster format without changing it; unit identity is separate from hero identity. */
export function createBattleState(input: DuelBattleInput): BattleState {
  const units: Record<string, UnitState> = {};
  const sides: Record<SideId, string[]> = { blue: [], red: [] };
  for (const side of ['blue', 'red'] as const) {
    input[side].forEach((fighter: BattleFighterInput, index) => {
      const heroId = fighter.heroId ?? -1;
      const unitId = `${side}:${index + 1}:${heroId}`;
      const hero = soulCatalog.heroes.find(candidate => candidate.id === heroId);
      const catalogBase = heroBaseOf(heroId)?.base ?? hero?.base;
      const panel = applyLuandouPoints(fighter.panel ?? catalogBase ?? emptyPanel, fighter.points);
      const soul = soulCatalog.suits.find(candidate => String(candidate.id) === fighter.fourSuit);
      // 选卡面板与对局生命的换算集中在 battle-hp；基础生命单独传入供核对。
      const baseHp = catalogBase?.hp ?? (fighter.panel ? 0 : panel.hp);
      const maxHp = battleMaxHp(panel.hp, baseHp).maxHp;
      units[unitId] = {
        unitId,
        heroId,
        unitKind: fighter.unitKind ?? 'shikigami',
        ...(fighter.awakeFilter === undefined ? {} : { awakeFilter: fighter.awakeFilter }),
        ...(fighter.damageAttributes ? { damageAttributes: { ...fighter.damageAttributes } } : {}),
        skillLevel: fighter.skillLevel,
        ...(fighter.skillLevels ? { skillLevels: { ...fighter.skillLevels } } : {}),
        side,
        stats: { ...panel, hp: maxHp },
        hp: maxHp,
        shield: 0,
        actionGauge: 0,
        turnPos: 0,
        ...(soul ? { soulId: `soul:${soul.id}` } : {}),
        statuses: [],
        resources: fighter.extHp === undefined ? {} : { extHp: Math.max(0, fighter.extHp) },
      };
      sides[side].push(unitId);
    });
  }
  return {
    units,
    sides,
    resources: { blue: { fire: 4 }, red: { fire: 4 } },
    resourceMeters: {
      blue: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } },
      red: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } },
    },
    counters: { round: 0, action: 0, attack: 0, hit: 0 },
    ended: false,
    scheduling: { extraTurns: [] },
  };
}
