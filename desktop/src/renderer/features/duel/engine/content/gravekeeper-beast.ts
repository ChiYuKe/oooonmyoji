import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const gravekeeperBeastIds = { soul: 'soul:300031' } as const;

/** 镇墓兽 adds up to 50% critical damage at zero HP; it does not affect noncritical damage. */
export function registerGravekeeperBeast(registry: ContentRegistry): void {
  registry.registerSoul({
    id: gravekeeperBeastIds.soul,
    mechanicsCoverage: 'verified',
    modifyCriticalDamage(attacker, _target, amount, criticalBaseAmount) {
      if (!soulsEnabled(attacker)) return amount;
      const missingHpRatio = Math.max(0, 1 - attacker.hp / Math.max(1, attacker.stats.hp));
      return amount + criticalBaseAmount * .5 * missingHpRatio;
    },
  });
}
