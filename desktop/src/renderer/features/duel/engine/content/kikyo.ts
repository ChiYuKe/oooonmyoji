import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kikyoIds = { hero: 319, basic: '3191', passive: '3192', ultimate: '3193', shield: 'status.hero.319.barrier',
  attackUp: 'status.hero.319.barrier-break-attack', sealBuffs: 'status.hero.319.no-buffs', sealPassivesSouls: 'status.hero.319.seal-passives-souls' } as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const ultimateRatios = [2.63, 2.76, 2.89, 3.02, 3.02] as const;

export function registerKikyo(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: kikyoIds.shield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', absorbsCriticalBonus: true },
    { id: kikyoIds.attackUp, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: kikyoIds.sealBuffs, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', preventsBuffApplications: true },
    { id: kikyoIds.sealPassivesSouls, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: kikyoIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio, dispelChance: .5 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== kikyoIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damage(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
    } };
  const ultimate: SkillDefinition = { id: kikyoIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: ultimateRatios.map((ratio, index) => ({ ratio, sealChance: 1, duration: 2, markFromRank: index >= 1 ? 1 : 0,
      bonusIfMarked: 1, sealPassivesAtRank: index >= 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== kikyoIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const level = rank(actor, ultimate.id);
      const hasMark = target.statuses.some(status => status.statusId === kikyoIds.sealBuffs && status.source.unitId === actor.unitId);
      const ratio = Number(parameters.ratio ?? ultimateRatios[level - 1]!) * (hasMark ? 1 + Number(parameters.bonusIfMarked ?? 1) : 1);
      const commands = damage(context, actor, target, ultimate.id, ratio);
      if (Number(parameters.markFromRank ?? (level >= 2 ? 1 : 0)) > 0) commands.push(...attemptDebuff(context, {
        source: kikyoSource(ultimate.id, actor.unitId), targetId: target.unitId, statusId: kikyoIds.sealBuffs,
        baseChance: Number(parameters.sealChance ?? 1), duration: { kind: 'count', remaining: Number(parameters.duration ?? 2), owner: 'target-turn' },
      }));
      return commands;
    } };

  const definition: HeroDefinition = { id: kikyoIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入破魔之箭按等级80%至100%伤害、基础攻击50%驱散1个增益；灵魂结界在自身回合末且被动未封印时获得等同攻击的护盾，护盾可吸收破盾该次攻击的全部溢出伤害且不受暴击加成影响；觉醒盾破后提升30%攻击1回合。破魔之矢耗3火、按等级263%至302%伤害，二级起必定施加2回合禁止获得增益状态，攻击已有同源标记者伤害翻倍；五级起该标记被驱散时封印目标被动与御魂2回合。护盾与被动封印的边界、反制类增益和实战帧序仍需核验。'],
    handlers: {
      hit: { priority: 76, handle(context, event) { return onHit(context, event); } },
      'turn-start': { priority: 76, handle(context, event) { return clearOldShield(context, event); } },
      'turn-end': { priority: 76, handle(context, event) { return grantBarrier(context, event); } },
      'effect-resolution': { priority: 76, handle(context, event) { return sealWhenMarkDispelled(context, event); } },
    },
    interceptIncomingDamage(_state, _attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (target.heroId !== kikyoIds.hero || target.hp <= 0 || amount <= 0 || !interception) return;
      const shield = target.statuses.find(status => status.statusId === kikyoIds.shield);
      const remaining = Number(shield?.values?.shieldRemaining ?? 0);
      if (!shield || remaining <= 0 || amount < remaining) return;
      const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: shield.source, targetId: target.unitId,
        instanceIds: [shield.instanceId], reason: 'consumed' }];
      if (Number(target.awakeFilter ?? 0) > 0 && passivesEnabled(target)) {
        const source = kikyoSource(kikyoIds.passive, target.unitId);
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${kikyoIds.attackUp}:${target.unitId}`,
          statusId: kikyoIds.attackUp, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: .3 }] } });
      }
      return { amount: 0, effects: commands };
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const marked = enemies.find(enemy => enemy.statuses.some(status => status.statusId === kikyoIds.sealBuffs && status.source.unitId === actor.unitId));
      const target = marked ?? enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: ultimate.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== kikyoIds.basic || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== kikyoIds.hero || !target || target.hp <= 0 || context.random() >= .5) return;
  return [{ type: 'dispel-statuses', source: kikyoSource(kikyoIds.basic, actor.unitId), targetId: target.unitId,
    maxCount: 1, filter: 'buff', parentEventId: event.eventId }];
}

function clearOldShield(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== kikyoIds.hero) return;
  return owner.statuses.filter(status => status.statusId === kikyoIds.shield).map(status => ({ type: 'remove-status-instances' as const,
    source: status.source, targetId: owner.unitId, instanceIds: [status.instanceId], reason: 'expired' as const }));
}

function grantBarrier(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== kikyoIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const source = kikyoSource(kikyoIds.passive, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${kikyoIds.shield}:${owner.unitId}`,
    statusId: kikyoIds.shield, source, stacks: 1, duration: { kind: 'permanent' },
    values: { shieldRemaining: context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack } } }];
}

function sealWhenMarkDispelled(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== kikyoIds.sealBuffs || event.reason !== 'dispelled' || !event.removedSource?.unitId) return;
  const owner = context.getUnit(event.removedSource.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== kikyoIds.hero || rank(owner, kikyoIds.ultimate) < 5 || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  const source = kikyoSource(kikyoIds.ultimate, owner.unitId);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: kikyoIds.sealPassivesSouls, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { sealPassives: true, sealSouls: true } });
}

function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: kikyoSource(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function kikyoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
