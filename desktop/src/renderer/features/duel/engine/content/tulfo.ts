import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const tulfoIds = {
  soul: 'soul:300076',
  activation: 'status.soul.300076.activation',
  blessing: 'status.soul.300076.blessing',
} as const;

/** 涂佛 triggers after a basic attack or an interrupted turn and buffs the living team. */
export function registerTulfo(registry: ContentRegistry): void {
  registry.registerStatus({ id: tulfoIds.activation, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'keep' });
  registry.registerStatus({ id: tulfoIds.blessing, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerSoul({ id: tulfoIds.soul, mechanicsCoverage: 'verified', handlers: {
    'attack-end': { priority: 130, handle(context, event) {
      if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
      const wearer = context.getUnit(event.source.unitId);
      if (!wearer || wearer.soulId !== tulfoIds.soul || !soulsEnabled(wearer)) return;
      return [activationCommand(wearer.unitId, event.eventId)];
    } },
    'action-validation': { priority: 130, handle(context, event) {
      if (event.type !== 'action-skipped' || event.reason !== 'interrupted') return;
      const wearer = context.getUnit(event.actorId);
      if (!wearer || wearer.soulId !== tulfoIds.soul || !soulsEnabled(wearer)) return;
      return [activationCommand(wearer.unitId, event.eventId)];
    } },
    'turn-start': { priority: 130, handle(context, event) {
      if (event.type !== 'turn-started') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer?.statuses.some(status => status.statusId === tulfoIds.activation)) return;
      return [{ type: 'remove-statuses', source: soulSource(wearer.unitId), targetId: wearer.unitId,
        statusIds: [tulfoIds.activation], reason: 'consumed' }];
    } },
    'turn-end': { priority: 130, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== tulfoIds.soul || !soulsEnabled(wearer)
        || !wearer.statuses.some(status => status.statusId === tulfoIds.activation)) return;
      const source = soulSource(wearer.unitId);
      const commands: EffectCommand[] = context.getLivingUnits(wearer.side).map(ally => blessingCommand(ally.unitId,
        ally.unitId === wearer.unitId ? .3 : .15, event.eventId, source));
      commands.push({ type: 'remove-statuses', source, targetId: wearer.unitId, statusIds: [tulfoIds.activation], reason: 'consumed' });
      return commands;
    } },
  } });
}

function activationCommand(unitId: string, parentEventId: string): EffectCommand {
  const source = soulSource(unitId);
  const marker: StatusInstance = { instanceId: `${tulfoIds.activation}:${unitId}`, statusId: tulfoIds.activation,
    source, stacks: 1, duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: unitId, instance: marker, parentEventId };
}

function blessingCommand(unitId: string, bonus: number, parentEventId: string, source: SourceRef): EffectCommand {
  const instance: StatusInstance = { instanceId: `${tulfoIds.blessing}:${source.unitId}:${unitId}`,
    statusId: tulfoIds.blessing, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'resist', operation: 'percent', amount: bonus }, { stat: 'damage', operation: 'percent', amount: bonus }] };
  return { type: 'add-status', source, targetId: unitId, instance, parentEventId };
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: tulfoIds.soul, unitId };
}
