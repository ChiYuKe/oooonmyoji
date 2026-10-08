import type { ContentRegistry } from './registry';
import type { SoulDefinition } from '../core/definitions';
import { soulsEnabled } from '../core/soul-eligibility';

export const clothOfProtectionIds = { soul: 'soul:300009' } as const;

/** 被服 reduces ordinary attack damage by 30%; true damage bypasses this legacy damage multiplier. */
export function registerClothOfProtection(registry: ContentRegistry): void {
  const definition: SoulDefinition = {
    id: clothOfProtectionIds.soul,
    mechanicsCoverage: 'verified',
    modifyIncomingDamage(_attacker, target, amount, kind) {
      return soulsEnabled(target) && kind === 'normal' ? amount * .7 : amount;
    },
  };
  registry.registerSoul(definition);
}
