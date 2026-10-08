import type { ContentRegistry } from './registry';
import { attemptControl } from '../mechanics/control';
import { soulsEnabled } from '../core/soul-eligibility';
import type { SourceRef } from '../core/types';

export const debuffSoulIds = {
  boxOfWonders: 'soul:300008',
  charm: 'soul:300035',
  stun: 'status.soul.300008.stun',
  silence: 'status.soul.300008.silence',
  confusion: 'status.soul.300008.confusion',
  healingReduction: 'status.soul.300008.healing-reduction',
} as const;

/** 魍魉之匣 rolls one of four post-hit effects; control resolution is handled by the battle scheduler. */
export function registerDebuffSouls(registry: ContentRegistry): void {
  for (const [statusId, controlType] of [[debuffSoulIds.stun, '眩晕'], [debuffSoulIds.silence, '沉默'],
    [debuffSoulIds.confusion, '混乱']] as const) {
    registry.registerStatus({ id: statusId, mechanicsCoverage: 'verified',
      category: 'control', dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
      ...(controlType === '沉默' ? { preventsSkill: true } : { preventsAction: true }) });
  }
  registry.registerStatus({ id: debuffSoulIds.healingReduction, mechanicsCoverage: 'verified', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerSoul({ id: debuffSoulIds.boxOfWonders, mechanicsCoverage: 'partial', handlers: {
    hit: { priority: 165, handle(context, event) {
      if (event.type !== 'damage' || !event.source.unitId) return;
      const wearer = context.getUnit(event.source.unitId);
      const target = context.getUnit(event.targetId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== debuffSoulIds.boxOfWonders || !soulsEnabled(wearer)
        || !target || target.hp <= 0 || context.random() >= .25) return;
      const effect = Math.floor(context.random() * 4);
      if (effect === 3) {
        const source: SourceRef = { kind: 'soul', id: debuffSoulIds.boxOfWonders, unitId: wearer.unitId };
        return [{ type: 'add-status', source, targetId: target.unitId,
          instance: { instanceId: `${debuffSoulIds.healingReduction}:${event.eventId}`, statusId: debuffSoulIds.healingReduction,
            source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -.4 }] }, parentEventId: event.eventId }];
      }
      const controls = [debuffSoulIds.stun, debuffSoulIds.silence, debuffSoulIds.confusion] as const;
      const controlTypes = ['眩晕', '沉默', '混乱'] as const;
      const source: SourceRef = { kind: 'soul', id: debuffSoulIds.boxOfWonders, unitId: wearer.unitId };
      const control = attemptControl(context, { attemptId: `${controls[effect]}:${event.eventId}`, source,
        targetId: target.unitId, statusId: controls[effect]!, controlType: controlTypes[effect]!, baseChance: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
      return control ? [control] : [];
    } },
  } });

  registry.registerSoul({ id: debuffSoulIds.charm, mechanicsCoverage: 'partial', handlers: {
    hit: { priority: 166, handle(context, event) {
      if (event.type !== 'damage' || !event.source.unitId) return;
      const wearer = context.getUnit(event.source.unitId);
      const target = context.getUnit(event.targetId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== debuffSoulIds.charm || !soulsEnabled(wearer)
        || !target || target.hp <= 0 || context.random() >= .25) return;
      const source: SourceRef = { kind: 'soul', id: debuffSoulIds.charm, unitId: wearer.unitId };
      const control = attemptControl(context, { attemptId: `${debuffSoulIds.confusion}:charm:${event.eventId}`, source,
        targetId: target.unitId, statusId: debuffSoulIds.confusion, controlType: '混乱', baseChance: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
      return control ? [control] : [];
    } },
  } });
}
