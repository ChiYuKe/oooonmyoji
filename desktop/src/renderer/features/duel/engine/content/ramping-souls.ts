import type { ContentRegistry } from './registry';
import type { SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const rampingSoulIds = {
  bladeNoBlade: 'soul:300092',
  bladeNoBladeBonus: 'status.soul.300092.damage',
  warriorChief: 'soul:300074',
  warriorChiefStacks: 'status.soul.300074.blade-stacks',
} as const;

/** 回合成长型御魂。无刀取的永久增伤保存在显式状态实例中。 */
export function registerRampingSouls(registry: ContentRegistry): void {
  registry.registerStatus({ id: rampingSoulIds.warriorChiefStacks, mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3 });
  registry.registerStatus({ id: rampingSoulIds.bladeNoBladeBonus, mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({ id: rampingSoulIds.warriorChief, mechanicsCoverage: 'verified', handlers: {
    'turn-end': { priority: 145, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== rampingSoulIds.warriorChief || !soulsEnabled(wearer)) return;
      const current = wearer.statuses.find(status => status.statusId === rampingSoulIds.warriorChiefStacks)?.stacks ?? 0;
      if (current >= 3) return;
      const source: SourceRef = { kind: 'soul', id: rampingSoulIds.warriorChief, unitId: wearer.unitId };
      const instance: StatusInstance = { instanceId: `${rampingSoulIds.warriorChiefStacks}:${wearer.unitId}`,
        statusId: rampingSoulIds.warriorChiefStacks, source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'defenseIgnore', operation: 'flat', amount: 75 }], values: { defenseIgnorePerStack: 75 } };
      return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId }];
    } },
  } });
  registry.registerSoul({ id: rampingSoulIds.bladeNoBlade, mechanicsCoverage: 'verified', handlers: {
    'turn-end': { priority: 145, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== rampingSoulIds.bladeNoBlade || !soulsEnabled(wearer)) return;
      const current = wearer.statuses.find(status => status.statusId === rampingSoulIds.bladeNoBladeBonus
        && status.source.unitId === wearer.unitId)?.modifiers?.find(modifier => modifier.stat === 'damage')?.amount ?? 0;
      const bonus = Math.min(.45, Math.round((current + .15) * 100) / 100);
      if (bonus <= current) return;
      const source: SourceRef = { kind: 'soul', id: rampingSoulIds.bladeNoBlade, unitId: wearer.unitId };
      const instance: StatusInstance = { instanceId: `${rampingSoulIds.bladeNoBladeBonus}:${wearer.unitId}`,
        statusId: rampingSoulIds.bladeNoBladeBonus, source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'damage', operation: 'percent', amount: bonus }], values: { bonus } };
      return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId }];
    } },
  } });
}
