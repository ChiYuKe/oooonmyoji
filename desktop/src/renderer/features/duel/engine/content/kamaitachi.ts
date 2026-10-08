import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kamaitachiIds = {
  hero: 261,
  basic: '2611',
  passive: '2612',
  ultimate: '2613',
  defenseDown: 'status.hero.261.defense-down',
  stun: 'status.hero.261.stun',
  bleed: 'status.hero.261.max-hp-bleed',
  attackUp: 'status.hero.261.attack-up',
  resistUp: 'status.hero.261.resist-up',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const extraTurnChances = [.1, .15, .2, .25, .3] as const;
const attackBonuses = [.15, .2, .2, .25, .3] as const;
const resistBonuses = [.1, .1, .1, .2, .2] as const;

export function registerKamaitachi(registry: ContentRegistry): void {
  registry.registerStatus({ id: kamaitachiIds.defenseDown, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kamaitachiIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: kamaitachiIds.bleed, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-start': { priority: 75, handle(context, event) { return tickMaxHpBleed(context, event); } } } });
  registry.registerStatus({ id: kamaitachiIds.attackUp, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kamaitachiIds.resistUp, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createKamaitachiDefinition());
}

export function createKamaitachiDefinition(): HeroDefinition {
  return {
    id: kamaitachiIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端数据接入普攻20%随机效果（三选一）、兄弟之绊回合末10%至30%额外回合，以及3火全队攻击/效果抵抗增益、三级起推30%行动条；中毒以外的持续伤害时点和实际增益帧仍需核验'],
    handlers: {
      'turn-end': { priority: 84, handle(context, event) { return extraTurnAtTurnEnd(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: kamaitachiIds.ultimate,
        targetIds: context.getLivingUnits(owner.side).map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: kamaitachiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function createBasic(): SkillDefinition {
  return { id: kamaitachiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio, effectChance: .2, defenseDuration: 2, bleedDuration: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0);
      const attack = actor && context.getEffectiveStats(actor.unitId), defense = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !attack || !defense) return [];
      const damage = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
      const source = kamaitachiSource(kamaitachiIds.basic, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
      const effectIndex = Math.floor(context.random() * 3);
      if (effectIndex === 0) commands.push(...attemptDebuff(context, { source, targetId: target.unitId,
        statusId: kamaitachiIds.defenseDown, baseChance: Number(parameters.effectChance ?? .2),
        duration: { kind: 'count', remaining: Number(parameters.defenseDuration ?? 2), owner: 'target-turn' },
        modifiers: [{ stat: 'defense', operation: 'percent', amount: -.3 }] }));
      else if (effectIndex === 1) {
        const stun = attemptControl(context, { attemptId: `${kamaitachiIds.stun}:${eventKey(context, actor, target)}`,
          source, targetId: target.unitId, statusId: kamaitachiIds.stun, controlType: '眩晕',
          baseChance: Number(parameters.effectChance ?? .2),
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (stun) commands.push(stun);
      } else commands.push(...attemptDebuff(context, { source, targetId: target.unitId,
        statusId: kamaitachiIds.bleed, baseChance: Number(parameters.effectChance ?? .2),
        duration: { kind: 'count', remaining: Number(parameters.bleedDuration ?? 2), owner: 'target-turn' },
        values: { maxHpLossRatio: .05 } }));
      return commands;
    } };
}

function createUltimate(): SkillDefinition {
  return { id: kamaitachiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally',
    levels: attackBonuses.map((attack, index) => ({ attackBonus: attack, resistBonus: resistBonuses[index]!,
      actionGauge: index >= 2 ? 30 : 0, duration: 2 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const source = kamaitachiSource(kamaitachiIds.ultimate, owner.unitId);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side !== owner.side) continue;
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${kamaitachiIds.attackUp}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
          statusId: kamaitachiIds.attackUp, source, stacks: 1,
          duration: { kind: 'count', remaining: Number(parameters.duration ?? 2), owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: Number(parameters.attackBonus ?? .15) }],
        } });
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${kamaitachiIds.resistUp}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
          statusId: kamaitachiIds.resistUp, source, stacks: 1,
          duration: { kind: 'count', remaining: Number(parameters.duration ?? 2), owner: 'target-turn' },
          modifiers: [{ stat: 'resist', operation: 'flat', amount: Number(parameters.resistBonus ?? .1) }],
        } });
        if (Number(parameters.actionGauge ?? 0) > 0) commands.push({ type: 'change-action-gauge', source,
          targetId: target.unitId, amount: Number(parameters.actionGauge) });
      }
      return commands;
    } };
}

function extraTurnAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.hp <= 0 || owner.heroId !== kamaitachiIds.hero || !passivesEnabled(owner)) return;
  const chance = extraTurnChances[Math.max(0, Math.min(4, (owner.skillLevels?.[kamaitachiIds.passive] ?? owner.skillLevel) - 1))]!;
  if (context.random() >= chance) return;
  return [{ type: 'schedule-turn', source: kamaitachiSource(kamaitachiIds.passive, owner.unitId),
    unitId: owner.unitId, scheduling: 'extra-turn', selection: 'action-gauge', parentEventId: event.eventId }];
}

function tickMaxHpBleed(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === kamaitachiIds.bleed).map(status => ({
    type: 'lose-life' as const, source: status.source, targetId: target.unitId,
    amount: target.stats.hp * Number(status.values?.maxHpLossRatio ?? .05),
    lifeLossKind: 'indirect' as const, parentEventId: event.eventId,
  }));
}

function eventKey(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>): string {
  return `${actor.unitId}:${target.unitId}:${context.state.counters.action}:${context.state.counters.hit}`;
}
function kamaitachiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
