import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const enshrinedFoxIds = { hero: 339, basic: '3391', passive: '3392', ultimate: '3393',
  steal: 'status.hero.339.attack-stolen', stolen: 'status.hero.339.attack-gain' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.8, .88, .96, 1.04, 1.04] as const;
const stealPercents = [.03, .03, .03, .03, .06] as const;
const stealCaps = [.6, .7, .8, 1, 1] as const;

export function registerEnshrinedFox(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: enshrinedFoxIds.steal, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: enshrinedFoxIds.stolen, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  const basic: SkillDefinition = { id: enshrinedFoxIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      return strike(context, intent, basic.id, Number(parameters.ratio ?? basicRatios[rank(context.getUnit(intent.actorId), basic.id) - 1]!));
    } };
  const passive: SkillDefinition = { id: enshrinedFoxIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: stealPercents.map((stealPercent, index) => ({ stealPercent, stealCap: stealCaps[index]! })),
    canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: enshrinedFoxIds.ultimate, useClientDamageData: false, actionKind: 'skill',
    target: 'single', targetRelation: 'enemy', resourceCost: { resourceId: 'fire', amount: 3 },
    levels: ultimateRatios.map((ratio, index) => ({ ratio, repeatReduction: index >= 4 ? .15 : .2, hits: 12 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== enshrinedFoxIds.hero || actor.hp <= 0) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[rank(actor, ultimate.id) - 1]!);
      const reduction = Number(parameters.repeatReduction ?? (rank(actor, ultimate.id) >= 5 ? .15 : .2));
      return randomVolley(context, intent, ratio, reduction, Number(parameters.hits ?? 12));
    } };

  const definition: HeroDefinition = { id: enshrinedFoxIds.hero, skills: [basic, passive, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端技能行接入灵冲100%至125%伤害；焚天九尾耗3火、按等级12次随机攻击（80%至104%），重复目标伤害每次递减20%，五级递减15%。施放大招前，唯一被动从战场单位窃取攻击：每个目标最多10次、每次3%（五级6%），总量不超过初始面板攻击的60%/70%/80%/100%/100%；泷夜叉姬阵亡时移除窃取双方的攻属性修正，归还已窃取攻击。窃取数值按被窃单位当时的有效攻击计算，并在大招伤害前结算；不同目标的随机序列、攻击被窃状态是否可被净化，以及死亡归还帧仍需实战帧核。本式神未出现在10点场阵容。'],
    handlers: {
      'action-selection': { priority: 339, handle(context, event) { return stealBeforeUltimate(context, event); } },
      'unit-defeated': { priority: 339, handle(context, event) { return returnStolenAttack(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== enshrinedFoxIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: enshrinedFoxIds.ultimate, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: enshrinedFoxIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function stealBeforeUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-declared' || event.intent.skillId !== enshrinedFoxIds.ultimate) return;
  const owner = context.getUnit(event.intent.actorId);
  if (!owner || owner.heroId !== enshrinedFoxIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  if (!event.resourceCostWaived && (context.state.resources[owner.side]?.fire ?? 0) < 3) return;
  const targets = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(target => target.unitId !== owner.unitId);
  if (!targets.length) return;
  const level = rank(owner, enshrinedFoxIds.passive), stealPercent = stealPercents[level - 1]!, cap = owner.stats.attack * stealCaps[level - 1]!;
  const owned = owner.statuses.find(status => status.statusId === enshrinedFoxIds.stolen && status.source.unitId === owner.unitId);
  const alreadyStolen = Number(owned?.values?.total ?? 0), remainingCap = Math.max(0, cap - alreadyStolen);
  if (remainingCap <= 0) return;
  const source = enshrinedFoxSource(enshrinedFoxIds.passive, owner.unitId), commands: EffectCommand[] = [];
  let transferred = 0;
  for (const target of targets) {
    if (remainingCap - transferred <= 0) break;
    const marker = target.statuses.find(status => status.statusId === enshrinedFoxIds.steal && status.source.unitId === owner.unitId);
    const count = Number(marker?.values?.count ?? 0); if (count >= 10) continue;
    const currentAttack = context.getEffectiveStats(target.unitId)?.attack ?? target.stats.attack;
    const amount = Math.min(currentAttack * stealPercent, remainingCap - transferred);
    if (amount <= 0) continue;
    transferred += amount;
    const targetTotal = Number(marker?.values?.total ?? 0) + amount;
    if (marker) commands.push({ type: 'remove-status-instances', source: marker.source, targetId: target.unitId,
      instanceIds: [marker.instanceId], reason: 'replaced' });
    commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
      instanceId: `${enshrinedFoxIds.steal}:${owner.unitId}:${target.unitId}`, statusId: enshrinedFoxIds.steal,
      source, stacks: 1, duration: { kind: 'permanent' }, values: { count: count + 1, total: targetTotal },
      modifiers: [{ stat: 'attack', operation: 'flat', amount: -targetTotal }],
    } });
  }
  if (transferred <= 0) return;
  if (owned) commands.push({ type: 'remove-status-instances', source: owned.source, targetId: owner.unitId,
    instanceIds: [owned.instanceId], reason: 'replaced' });
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${enshrinedFoxIds.stolen}:${owner.unitId}`, statusId: enshrinedFoxIds.stolen, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { total: alreadyStolen + transferred },
    modifiers: [{ stat: 'attack', operation: 'flat', amount: alreadyStolen + transferred }],
  } });
  return commands;
}

function returnStolenAttack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== enshrinedFoxIds.hero) return;
  const commands: EffectCommand[] = [];
  for (const unit of Object.values(context.state.units)) {
    for (const stolen of unit.statuses.filter(status => status.statusId === enshrinedFoxIds.steal && status.source.unitId === owner.unitId))
      commands.push({ type: 'remove-status-instances', source: stolen.source, targetId: unit.unitId,
        instanceIds: [stolen.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  const gained = owner.statuses.find(status => status.statusId === enshrinedFoxIds.stolen && status.source.unitId === owner.unitId);
  if (gained) commands.push({ type: 'remove-status-instances', source: gained.source, targetId: owner.unitId,
    instanceIds: [gained.instanceId], reason: 'consumed', parentEventId: event.eventId });
  return commands.length ? commands : undefined;
}

function randomVolley(context: BattleContext, intent: ActionIntent, ratio: number, repeatedTargetDrop: number, hitCount: number): EffectCommand[] {
  const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
  const enemySide = actor.side === 'blue' ? 'red' : 'blue';
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const hitsByTarget = new Map<string, number>(), projectedHp = new Map<string, number>(), projectedShield = new Map<string, number>();
  const commands: EffectCommand[] = [];
  for (let hit = 0; hit < hitCount; hit++) {
    const enemies = context.getLivingUnits(enemySide).filter(enemy => (projectedHp.get(enemy.unitId) ?? enemy.hp) > 0);
    if (!enemies.length) break;
    const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
    const repeat = hitsByTarget.get(target.unitId) ?? 0;
    hitsByTarget.set(target.unitId, repeat + 1);
    const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
    const damage = context.calculateDamage({ attack: offense.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio: ratio * Math.pow(Math.max(0, 1 - repeatedTargetDrop), repeat),
      critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
    commands.push({ type: 'deal-damage', source: enshrinedFoxSource(enshrinedFoxIds.ultimate, actor.unitId),
      targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
      isCritical: damage.isCritical });
    let absorbedShield = Math.min(projectedShield.get(target.unitId) ?? target.shield, damage.amount);
    projectedShield.set(target.unitId, Math.max(0, (projectedShield.get(target.unitId) ?? target.shield) - absorbedShield));
    projectedHp.set(target.unitId, Math.max(0, (projectedHp.get(target.unitId) ?? target.hp) - Math.max(0, damage.amount - absorbedShield)));
  }
  return commands;
}

function strike(context: BattleContext, intent: ActionIntent, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
  if (!actor || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: enshrinedFoxSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function rank(unit: Readonly<UnitState> | undefined, skillId: string): number {
  return Math.max(1, Math.min(5, unit?.skillLevels?.[skillId] ?? unit?.skillLevel ?? 1));
}
function enshrinedFoxSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
