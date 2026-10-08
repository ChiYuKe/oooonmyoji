import { skillResourceCost, type SoulDefinition } from '../core/definitions';
import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const seaMoonFireJadeIds = { soul: 'soul:300083' } as const;

/** Skill-cast cost and damage adjustment for Sea Moon Fire Jade. */
export function registerSeaMoonFireJade(registry: ContentRegistry): void {
  const definition: SoulDefinition = {
    id: seaMoonFireJadeIds.soul,
    mechanicsCoverage: 'verified',
    resolveActionAdjustment(state, actor, skill) {
      if (actor.soulId !== seaMoonFireJadeIds.soul || !soulsEnabled(actor) || skill.actionKind !== 'skill') return undefined;
      const baseCost = skill.resolveResourceCost?.(state, actor) ?? skillResourceCost(skill, actor.skillLevel);
      if (!baseCost || baseCost.amount <= 0) return undefined;
      const available = Math.max(0, state.resources[actor.side]?.[baseCost.resourceId] ?? 0);
      if (available < baseCost.amount + 1) return undefined;
      return { additionalResourceCost: { resourceId: baseCost.resourceId, amount: 1 }, damageMultiplier: 1.4,
        label: '额外消耗1点资源，本次技能伤害提高40%' };
    },
  };
  registry.registerSoul(definition);
}
