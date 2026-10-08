import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const vampirePrincessIds = {
  hero: 253,
  basic: '2531',
  passive: '2532',
  ultimate: '2533',
  shield: 'status.hero.253.blood-embrace-shield',
  bleed: 'status.hero.253.blood-mark',
} as const;

const basicRatios = [1.2, 1.26, 1.32, 1.38, 1.5] as const;
const ultimateRatios = [1.31, 1.38, 1.45, 1.52, 1.59] as const;

export function registerVampirePrincess(registry: ContentRegistry): void {
  registry.registerStatus({ id: vampirePrincessIds.shield, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: true, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: vampirePrincessIds.bleed, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 75, handle(context, event) { return tickBloodMark(context, event); } } } });
  registry.registerHero(createVampirePrincessDefinition());
}

export function createVampirePrincessDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: vampirePrincessIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: basicRatios.map(ratio => ({ ratio, costRatio: .1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!actor || !target || actor.hp <= 1) return [];
      const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const source = vampireSource(vampirePrincessIds.basic, actor.unitId);
      const payment = Math.min(actor.hp - 1, actor.hp * Number(parameters.costRatio ?? .1));
      const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1.2),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return [
        { type: 'lose-life', source, targetId: actor.unitId, amount: payment, lifeLossKind: 'direct' },
        { type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical },
      ];
    },
  };
  const ultimate: SkillDefinition = {
    id: vampirePrincessIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, shieldRatio: .2, bleedRatio: .1, bleedAttackCap: 4 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!owner || !target) return [];
      const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const source = vampireSource(vampirePrincessIds.ultimate, owner.unitId);
      const damage = context.calculateDamage({ attack: ownerStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: Number(parameters.ratio ?? 1.31),
        critChance: ownerStats.crit, critDamage: ownerStats.critDamage }, owner, target);
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
        ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
    },
  };
  return {
    id: vampirePrincessIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按技能表接入血袭消耗10%当前生命、血怒每损失1%生命增加4%伤害、鲜血之拥2火单体/伤害20%护盾/目标回合结束生命上限10%伤害（不超过吸血姬攻击400%）；护盾是否可驱散、DOT抵抗细节与实际帧需核对'],
    modifyOutgoingDamage(attacker, _target, amount) {
      if (attacker.heroId !== vampirePrincessIds.hero || !passivesEnabled(attacker)) return amount;
      const lostRatio = Math.max(0, 1 - attacker.hp / Math.max(1, attacker.stats.hp));
      return amount * (1 + lostRatio * 4);
    },
    handlers: { hit: { priority: 42, handle(context, event) { return onVampireHit(context, event); } } },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      const enemies = owner && context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!owner || !enemies?.length) return undefined;
      const priorityTarget = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const skillId = fire >= 2 && owner.hp / Math.max(1, owner.stats.hp) > .2
        ? vampirePrincessIds.ultimate : vampirePrincessIds.basic;
      return { actorId: owner.unitId, skillId, targetIds: [priorityTarget.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function onVampireHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || event.source.id !== vampirePrincessIds.ultimate) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== vampirePrincessIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return;
  const source = vampireSource(vampirePrincessIds.ultimate, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${vampirePrincessIds.shield}:${owner.unitId}`, statusId: vampirePrincessIds.shield,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
      values: { shieldRemaining: Math.max(0, event.amount * .2) } } }];
  commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${vampirePrincessIds.bleed}:${owner.unitId}:${target.unitId}`, statusId: vampirePrincessIds.bleed,
      source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { maxHpRatio: .1, attackCapRatio: 4 } } });
  return commands;
}

function tickBloodMark(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === vampirePrincessIds.bleed).flatMap(status => {
    const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
    if (!owner || owner.hp <= 0) return [];
    const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
    const amount = Math.min(target.stats.hp * Number(status.values?.maxHpRatio ?? .1), attack * Number(status.values?.attackCapRatio ?? 4));
    return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
      amount, lifeLossKind: 'indirect' as const, parentEventId: event.eventId }];
  });
}

function vampireSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
