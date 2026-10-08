import type { ContentRegistry } from './registry';
import type { BattleState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';
import { effectiveStats } from '../mechanics/stats';

export const damageScalingSoulIds = {
  reed: 'soul:300055',
  heartEye: 'soul:300022',
  roofTile: 'soul:300020',
  madBone: 'soul:300048',
  hiddenIntent: 'soul:300086',
  hiddenIntentCounter: 'status.soul.300086.counter',
  netCut: 'soul:300026',
} as const;

/** Conditional outgoing multipliers whose rules are fully expressed by the generic damage hook. */
export function registerDamageScalingSouls(registry: ContentRegistry): void {
  registry.registerStatus({ id: damageScalingSoulIds.hiddenIntentCounter, mechanicsCoverage: 'verified', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({ id: damageScalingSoulIds.reed, mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, _target, amount, kind) {
      return soulsEnabled(attacker) && kind === 'normal' && attacker.hp >= attacker.stats.hp ? amount * 1.45 : amount;
    } });

  registry.registerSoul({ id: damageScalingSoulIds.heartEye, mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, target, amount, kind) {
      if (!soulsEnabled(attacker) || kind !== 'normal') return amount;
      const lostRatio = Math.max(0, 1 - target.hp / Math.max(1, target.stats.hp));
      return amount * (1 + Math.floor(lostRatio / .15) * .1);
    } });

  registry.registerSoul({ id: damageScalingSoulIds.roofTile, mechanicsCoverage: 'partial',
    modifyOutgoingDamage(attacker, target, amount, kind) {
      const controlled = target.statuses.some(status => status.values?.controlType !== undefined);
      return soulsEnabled(attacker) && kind === 'normal' && controlled ? amount * 1.45 : amount;
    } });

  registry.registerSoul({ id: damageScalingSoulIds.madBone, mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, _target, amount, kind, state?: Readonly<BattleState>) {
      if (!soulsEnabled(attacker) || kind !== 'normal') return amount;
      const fire = Math.max(0, state?.resources[attacker.side]?.fire ?? 0);
      return amount * (1 + fire * .08);
    } });

  registry.registerSoul({ id: damageScalingSoulIds.hiddenIntent, mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, target, amount, kind) {
      if (!soulsEnabled(attacker) || kind !== 'normal') return amount;
      const progress = attacker.statuses.find(status => status.statusId === damageScalingSoulIds.hiddenIntentCounter
        && status.values?.targetId === target.unitId)?.values?.completedHits;
      const completedHits = typeof progress === 'number' ? progress : 0;
      return amount * (1 + ((completedHits % 3) + 1) * .2);
    },
    handlers: {
      hit: { priority: 145, handle(context, event) {
        if (event.type !== 'damage' || event.damageKind !== 'normal' || !event.source.unitId) return;
        const wearer = context.getUnit(event.source.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== damageScalingSoulIds.hiddenIntent || !soulsEnabled(wearer)) return;
        const previous = wearer.statuses.find(status => status.statusId === damageScalingSoulIds.hiddenIntentCounter
          && status.source.unitId === wearer.unitId);
        const sameTarget = previous?.values?.targetId === event.targetId;
        const completedHits = sameTarget && typeof previous?.values?.completedHits === 'number'
          ? (previous.values.completedHits + 1) % 3 : 1;
        const source = { kind: 'soul' as const, id: damageScalingSoulIds.hiddenIntent, unitId: wearer.unitId };
        return [{ type: 'add-status', source, targetId: wearer.unitId,
          instance: { instanceId: `${damageScalingSoulIds.hiddenIntentCounter}:${wearer.unitId}`,
            statusId: damageScalingSoulIds.hiddenIntentCounter, source, stacks: 1, duration: { kind: 'permanent' },
            values: { targetId: event.targetId, completedHits } }, parentEventId: event.eventId }];
      } },
    },
  });

  registry.registerSoul({ id: damageScalingSoulIds.netCut, mechanicsCoverage: 'partial',
    modifyOutgoingDamage(attacker, target, amount, kind, _state, random) {
      if (!soulsEnabled(attacker) || kind !== 'normal' || !random || random() >= .5) return amount;
      const defense = effectiveStats(target).defense;
      const currentFactor = 300 / (300 + defense);
      const reducedFactor = 300 / (300 + defense * .55);
      return amount * reducedFactor / Math.max(Number.EPSILON, currentFactor);
    } });
}
