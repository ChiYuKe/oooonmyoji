import type { ContentRegistry } from './registry';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const qingnufangIds = {
  soul: 'soul:300075',
  fatalGuard: 'status.soul.300075.fatal-guard',
  iceSeal: 'status.soul.300075.ice-seal',
} as const;

/** 青女房's first lethal hit clears statuses, restores the wearer, then seals them in one-turn ice. */
export function registerQingnufang(registry: ContentRegistry): void {
  registry.registerStatus({ id: qingnufangIds.fatalGuard, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', preventsLethalDamage: true, requiresSoulEnabled: true });
  registry.registerStatus({ id: qingnufangIds.iceSeal, mechanicsCoverage: 'verified', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true, statusImmunity: 'debuffs' });
  registry.registerSoul({ id: qingnufangIds.soul, mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['首次受到致命伤害时清除自身全部状态/印记并恢复满生命，随后冰封1个自身回合；冰封期间防御提高100%、免疫减益，若结束时存活则再次恢复满生命。御魂封印时不触发。'],
    initialize(context, unitId) {
      const wearer = context.getUnit(unitId);
      if (!wearer || wearer.soulId !== qingnufangIds.soul
        || wearer.statuses.some(status => status.statusId === qingnufangIds.fatalGuard)) return [];
      return [{ type: 'add-status', source: qingnufangSource(unitId), targetId: unitId,
        instance: { instanceId: `${qingnufangIds.fatalGuard}:${unitId}`, statusId: qingnufangIds.fatalGuard,
          source: qingnufangSource(unitId), stacks: 1, duration: { kind: 'permanent' } } }];
    },
    handlers: {
      hit: { priority: 145, handle(context, event) { return enterIceSeal(context, event); } },
      'status-expiration': { priority: 145, handle(context, event) { return recoverAfterIce(context, event); } },
    },
  });
}

function enterIceSeal(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.fatalProtectionStatusId !== qingnufangIds.fatalGuard || !event.targetId) return;
  const wearer = context.getUnit(event.targetId);
  if (!wearer || wearer.hp <= 0 || wearer.soulId !== qingnufangIds.soul || !soulsEnabled(wearer)) return;
  const source = qingnufangSource(wearer.unitId);
  const instanceIds = wearer.statuses.map(status => status.instanceId);
  return [
    ...(instanceIds.length ? [{ type: 'remove-status-instances' as const, source, targetId: wearer.unitId,
      instanceIds, reason: 'consumed' as const, parentEventId: event.eventId }] : []),
    { type: 'restore-health', source, targetId: wearer.unitId, amount: wearer.stats.hp, parentEventId: event.eventId },
    { type: 'add-status', source, targetId: wearer.unitId, instance: {
      instanceId: `${qingnufangIds.iceSeal}:${wearer.unitId}:${event.eventId}`, statusId: qingnufangIds.iceSeal,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'defense', operation: 'percent', amount: 1 }],
    }, parentEventId: event.eventId },
  ];
}

function recoverAfterIce(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== qingnufangIds.iceSeal || event.reason !== 'expired') return;
  const wearer = context.getUnit(event.targetId);
  if (!wearer || wearer.hp <= 0) return;
  return [{ type: 'restore-health', source: qingnufangSource(wearer.unitId), targetId: wearer.unitId,
    amount: wearer.stats.hp, parentEventId: event.eventId }];
}

function qingnufangSource(unitId: string): SourceRef {
  return { kind: 'soul', id: qingnufangIds.soul, unitId };
}

