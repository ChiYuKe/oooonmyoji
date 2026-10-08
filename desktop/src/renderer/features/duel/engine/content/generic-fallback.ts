import { heroSkillsCatalog } from '../../../../../shared/hero-skills-data';
import type { HeroDefinition } from '../core/definitions';
import { createBasicAttackSkill } from './common-skills';
import type { BattleContext } from '../core/types';
import type { ContentRegistry } from './registry';

/** Keeps unsupported roster entries simulatable with a clearly diagnosed generic basic attack. */
export function registerGenericFallbackHeroes(registry: ContentRegistry): void {
  for (const heroId of Object.keys(heroSkillsCatalog.heroes).map(Number).sort((left, right) => left - right)) {
    if (registry.getHero(heroId)) continue;
    registry.registerHero(createGenericFallbackHero(heroId));
  }
}

function createGenericFallbackHero(heroId: number): HeroDefinition {
  // Keep fallback basic actions on the client's stable skill ID so cross-content assists can resolve them.
  const basicId = String(heroSkillsCatalog.heroes[heroId]?.skills[0]?.id ?? `fallback.hero.${heroId}.basic`);
  return { id: heroId, skills: [createBasicAttackSkill(basicId, [1])], aiCoverage: 'unsupported', mechanicsCoverage: 'unsupported',
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const target = lowestHealthEnemy(context, actor); if (!target) return undefined;
      return { actorId: unitId, skillId: basicId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function lowestHealthEnemy(context: BattleContext, actor: NonNullable<ReturnType<BattleContext['getUnit']>>) {
  return context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    .slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
}
