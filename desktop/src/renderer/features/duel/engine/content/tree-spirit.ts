import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const treeSpiritIds = { soul: 'soul:300024' } as const;

/** 树妖 raises outgoing healing by 20%, or 50% when the recipient starts below 20% HP. */
export function registerTreeSpirit(registry: ContentRegistry): void {
  registry.registerSoul({
    id: treeSpiritIds.soul,
    mechanicsCoverage: 'partial',
    modifyOutgoingHealing(healer, target, amount) {
      if (!soulsEnabled(healer)) return amount;
      const ratio = target.hp / Math.max(1, target.stats.hp);
      return amount * (1 + (ratio < .2 ? .5 : .2));
    },
  });
}
