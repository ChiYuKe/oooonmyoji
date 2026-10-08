import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import type { ContentRegistry } from './registry';

export const carpSpiritIds = {
  hero: 206,
  basic: '2061',
  bubbleShield: '2062',
  bubblePrison: '2063',
  shield: 'status.hero.206.bubble-shield',
  prison: 'status.hero.206.bubble-prison',
} as const;

export function registerCarpSpirit(registry: ContentRegistry): void {
  registry.registerStatus({ id: carpSpiritIds.shield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: carpSpiritIds.prison, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createCarpSpiritDefinition());
}

export function createCarpSpiritDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: carpSpiritIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.05, 1.1, 1.15].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || !targetStats) return [];
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
        ratio: Number(parameters.ratio ?? 1), critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: carpSource(carpSpiritIds.basic, actor.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    },
  };
  const shield: SkillDefinition = {
    id: carpSpiritIds.bubbleShield, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally', levels: [.12, .14, .16, .18, .18].map((ratio, index) => ({ ratio,
      indirectDamageReduction: index === 4 ? .5 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = carpSource(carpSpiritIds.bubbleShield, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.unitKind === 'summon') return [];
        const instance: StatusInstance = { instanceId: `${carpSpiritIds.shield}:${actor.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
          statusId: carpSpiritIds.shield, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'hit', operation: 'flat', amount: .1 },
            ...(Number(parameters.indirectDamageReduction ?? 0) > 0
              ? [{ stat: 'indirectDamageTaken' as const, operation: 'percent' as const, amount: -Number(parameters.indirectDamageReduction) }]
              : [])],
          values: { shieldRemaining: target.stats.hp * Number(parameters.ratio ?? .12) } };
        return [{ type: 'add-status' as const, source, targetId: target.unitId, instance }];
      });
    },
  };
  const prison: SkillDefinition = {
    id: carpSpiritIds.bubblePrison, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy',
    levels: [
      { shieldRatio: 1.5, damageRatio: 0 }, { shieldRatio: 1.65, damageRatio: .5 }, { shieldRatio: 1.65, damageRatio: .5 },
      { shieldRatio: 1.65, damageRatio: .63 }, { shieldRatio: 1.8, damageRatio: .63 },
    ],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target) return [];
      const source = carpSource(carpSpiritIds.bubblePrison, actor.unitId);
      const control = attemptControl(context, { attemptId: `${carpSpiritIds.prison}:${actor.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
        source, targetId: target.unitId, statusId: carpSpiritIds.prison, controlType: '禁锢', baseChance: 1,
        duration: { kind: 'count', remaining: 2, owner: 'target-turn' } });
      if (!control || control.type !== 'apply-control') return control ? [control] : [];
      return [{ ...control, instance: { ...control.instance,
        modifiers: [{ stat: 'crit', operation: 'flat', amount: -.2 }],
        values: { ...control.instance.values, controlType: '禁锢',
          shieldRemaining: actor.stats.attack * Number(parameters.shieldRatio ?? 1.5),
          followUpRatio: Number(parameters.damageRatio ?? 0) },
      } }];
    },
  };
  return {
    id: carpSpiritIds.hero,
    skills: [basic, shield, prison],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 130, handle(context, event) {
        if (event.type !== 'damage' || event.source.id !== carpSpiritIds.basic || !event.source.unitId) return;
        const actor = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!actor || actor.heroId !== carpSpiritIds.hero || actor.skillLevel < 3 || !target || target.hp <= 0) return;
        const buffs = target.statuses.filter(status => context.getStatusCategory(status.statusId) === 'buff'
          && context.isStatusDispellable(status.statusId));
        if (!buffs.length) return;
        const selected = buffs[Math.floor(context.random() * buffs.length)]!;
        return [{ type: 'dispel-statuses', source: carpSource(carpSpiritIds.basic, actor.unitId), targetId: target.unitId,
          statusIds: [selected.statusId], parentEventId: event.eventId }];
      } },
      'turn-end': { priority: 35, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const target = context.getUnit(event.unitId);
        if (!target || target.hp <= 0) return;
        return target.statuses.filter(status => status.statusId === carpSpiritIds.prison && Number(status.values?.followUpRatio ?? 0) > 0)
          .flatMap(status => {
            const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
            if (!owner) return [];
            return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
              amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * Number(status.values?.followUpRatio),
              lifeLossKind: 'indirect',
              parentEventId: event.eventId }];
          });
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const allShielded = allies.every(ally => ally.unitKind === 'summon'
        || ally.statuses.some(status => status.statusId === carpSpiritIds.shield));
      if (fire >= 3 && !allShielded) return { actorId: unitId, skillId: carpSpiritIds.bubbleShield,
        targetIds: allies.map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      if (fire >= 3 && allShielded) {
        const target = enemies.slice().sort((left, right) => buffPriority(right, context) - buffPriority(left, context)
          || left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
        return { actorId: unitId, skillId: carpSpiritIds.bubblePrison, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: carpSpiritIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function buffPriority(unit: Readonly<import('../core/types').UnitState>, context: BattleContext): number {
  return unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'buff' || context.getStatusCategory(status.statusId) === 'shield').length;
}

function carpSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
