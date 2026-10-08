import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const embalmerIds = { hero: 321, basic: '3211', soulSeam: '3212', summon: '3213', seam: 'status.hero.321.soul-seam',
  coffin: 'status.hero.321.snow-weaving-coffin', cooldown: 'status.hero.321.coffin-cooldown', enemyFireSpent: 'status.hero.321.enemy-fire-spent' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const soulSeamRatios = [2.11, 2.21, 2.32, 2.44, 2.44] as const;
const seamLifeRatios = [.15, .3, .6, 1.2, 2.4] as const;
const summonBaseRatios = [.2, .25, .25, .3, .3] as const;
const summonPerFireRatios = [.1, .1, .2, .2, .2] as const;
const summonCooldowns = [3, 3, 3, 3, 2] as const;

export function registerEmbalmer(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: embalmerIds.seam, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 5 },
    { id: embalmerIds.coffin, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: embalmerIds.cooldown, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: embalmerIds.enemyFireSpent, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: embalmerIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      return attack(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
    } };

  const soulSeam: SkillDefinition = { id: embalmerIds.soulSeam, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCostsByLevel: soulSeamRatios.map((ratio, index) => ({ resourceId: 'fire', amount: index === 4 ? 2 : 3 })),
    levels: soulSeamRatios.map(ratio => ({ ratio, seamChance: .99, seamStacks: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      return [...attack(context, actor, target, soulSeam.id, Number(parameters.ratio ?? soulSeamRatios[rank(actor, soulSeam.id) - 1]!)),
        ...attemptDebuff(context, { source: embalmerSource(soulSeam.id, actor.unitId), targetId: target.unitId,
          statusId: embalmerIds.seam, baseChance: Number(parameters.seamChance ?? .99),
          duration: { kind: 'permanent' }, stacks: Number(parameters.seamStacks ?? 1) })];
    } };

  const summon: SkillDefinition = { id: embalmerIds.summon, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: summonBaseRatios.map((ratio, index) => ({ ratio, perFireRatio: summonPerFireRatios[index]!, cooldown: summonCooldowns[index]!,
      speedPenalty: -.5, defenseBonus: 2.5, resistanceBonus: .7, missingHealthBonusPerPercent: .025 })),
    canUse(_state, actor) { return !actor.statuses.some(status => status.statusId === embalmerIds.cooldown); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== embalmerIds.hero || actor.hp <= 0) return [];
      const level = rank(actor, summon.id), source = embalmerSource(summon.id, actor.unitId);
      const command: EffectCommand = { type: 'add-status', source, targetId: actor.unitId,
        instance: { instanceId: `${embalmerIds.coffin}:${actor.unitId}`, statusId: embalmerIds.coffin, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
          modifiers: [{ stat: 'speed', operation: 'percent', amount: Number(parameters.speedPenalty ?? -.5) },
            { stat: 'defense', operation: 'percent', amount: Number(parameters.defenseBonus ?? 2.5) },
            { stat: 'resist', operation: 'flat', amount: Number(parameters.resistanceBonus ?? .7) }] } };
      const cooldown = Number(parameters.cooldown ?? summonCooldowns[level - 1]!);
      return [command, { type: 'add-status', source, targetId: actor.unitId,
        instance: { instanceId: `${embalmerIds.cooldown}:${actor.unitId}`, statusId: embalmerIds.cooldown, source, stacks: 1,
          duration: { kind: 'permanent' }, values: { remaining: cooldown, castAction: context.state.counters.action } } }];
    } };

  const definition: HeroDefinition = { id: embalmerIds.hero, skills: [basic, soulSeam, summon], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入葬仪100%至125%伤害；离魂耗3火（五级2火）、211%至244%伤害并以99%基础概率附魂隙，魂隙最多5层，目标回合结束按生命上限15%/30%/60%/120%/240%造成间接生命损失、封顶入殓师攻击500%，携带魂隙的敌人普攻入殓师时清除自身全部魂隙。荼蘼盛放之棺耗3火、冷却3回合（五级2回合），持续入殓师一个回合，降低自身50%速度并提高250%防御、70%抵抗；非召唤敌方回合结束时若入殓师未处于无法动作状态，对该敌及另一生命比例最低敌人造成等级倍率伤害，按该敌回合耗火追加伤害，并随入殓师已损生命提高。魂隙在零防御时必暴的战斗表现、冷却精确计数、召唤状态被驱散/封印及御魂交互仍需帧核。'],
    handlers: {
      hit: { priority: 78, handle(context, event) { return clearSeamOnBasic(context, event); } },
      'turn-end': { priority: 78, handle(context, event) { return onTurnEnd(context, event); } },
      'resource-payment': { priority: 78, handle(context, event) { return trackEnemyFire(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== embalmerIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3 && !actor.statuses.some(status => status.statusId === embalmerIds.cooldown))
        return embalmerIntent(actor.unitId, summon.id, actor.unitId, 'self', 'ally');
      if (fire >= (rank(actor, soulSeam.id) === 5 ? 2 : 3))
        return embalmerIntent(actor.unitId, soulSeam.id, lowestRatio(enemies).unitId, 'single', 'enemy');
      return embalmerIntent(actor.unitId, basic.id, lowestRatio(enemies).unitId, 'single', 'enemy');
    },
  };
  registry.registerHero(definition);
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const unit = context.getUnit(event.unitId); if (!unit) return;
  const commands: EffectCommand[] = [];
  if (unit.heroId === embalmerIds.hero) {
    const cooldown = unit.statuses.find(status => status.statusId === embalmerIds.cooldown);
    const castAction = Number(cooldown?.values?.castAction ?? -1), currentAction = event.actionId ?? context.state.counters.action;
    if (cooldown && currentAction !== castAction) {
      const remaining = Math.max(0, Number(cooldown.values?.remaining ?? 0) - 1);
      if (remaining === 0) commands.push({ type: 'remove-status-instances', source: cooldown.source, targetId: unit.unitId,
        instanceIds: [cooldown.instanceId], reason: 'consumed' });
      else commands.push({ type: 'add-status', source: cooldown.source, targetId: unit.unitId,
        instance: { ...cooldown, values: { ...cooldown.values, remaining } } });
    }
  }

  const ended = context.getUnit(event.unitId);
  if (!ended || ended.unitKind === 'summon') return commands.length ? commands : undefined;
  for (const owner of context.getLivingUnits(ended.side === 'blue' ? 'red' : 'blue')) {
    if (owner.heroId !== embalmerIds.hero || !owner.statuses.some(status => status.statusId === embalmerIds.coffin)
      || context.isUnitUnableToAct(owner.unitId)) continue;
    const spentStatus = owner.statuses.find(status => status.statusId === embalmerIds.enemyFireSpent
      && status.values?.turnActorId === ended.unitId);
    const spent = Math.max(0, Number(spentStatus?.values?.spent ?? 0));
    if (spentStatus) commands.push({ type: 'remove-status-instances', source: spentStatus.source, targetId: owner.unitId,
      instanceIds: [spentStatus.instanceId], reason: 'consumed', parentEventId: event.eventId });
    const targets = [ended, ...context.getLivingUnits(ended.side).filter(target => target.unitId !== ended.unitId)
      .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)).slice(0, 1)];
    const level = rank(owner, embalmerIds.summon), base = summonBaseRatios[level - 1]!, perFire = summonPerFireRatios[level - 1]!;
    const maxHp = (context.getEffectiveStats(owner.unitId) ?? owner.stats).hp;
    const lostHealthRatio = 1 - owner.hp / Math.max(1, maxHp);
    const totalRatio = (base + spent * perFire) * (1 + lostHealthRatio * 2.5);
    for (const target of targets) commands.push(...attack(context, owner, target, embalmerIds.summon, totalRatio, event.eventId));
  }

  for (const status of ended.statuses.filter(instance => instance.statusId === embalmerIds.seam)) {
    const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
    if (!owner || owner.heroId !== embalmerIds.hero || ended.hp <= 0) continue;
    const attackPower = (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
    const ratio = seamLifeRatios[Math.max(1, Math.min(5, status.stacks)) - 1]!;
    let amount = Math.min((context.getEffectiveStats(ended.unitId) ?? ended.stats).hp * ratio, attackPower * 5);
    const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const critical = ended.stats.defense === 0 || context.random() < ownerStats.crit;
    if (critical) amount *= ownerStats.critDamage;
    commands.push({ type: 'lose-life', source: embalmerSource(embalmerIds.soulSeam, owner.unitId), targetId: ended.unitId,
      amount, lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function clearSeamOnBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const embalmer = context.getUnit(event.targetId), attacker = context.getUnit(event.source.unitId);
  if (!embalmer || embalmer.heroId !== embalmerIds.hero || !attacker || attacker.hp <= 0) return;
  const seams = attacker.statuses.filter(status => status.statusId === embalmerIds.seam && status.source.unitId === embalmer.unitId);
  if (!seams.length) return;
  return [{ type: 'remove-status-instances', source: embalmerSource(embalmerIds.basic, embalmer.unitId), targetId: attacker.unitId,
    instanceIds: seams.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId }];
}

function trackEnemyFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId); if (!actor || actor.unitKind === 'summon') return;
  const owners = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    .filter(owner => owner.heroId === embalmerIds.hero && owner.statuses.some(status => status.statusId === embalmerIds.coffin));
  return owners.map(owner => {
    const prior = owner.statuses.find(status => status.statusId === embalmerIds.enemyFireSpent && status.values?.turnActorId === actor.unitId);
    const source: SourceRef = { kind: 'status', id: `${embalmerIds.enemyFireSpent}:${owner.unitId}:${actor.unitId}`, unitId: owner.unitId };
    return { type: 'add-status' as const, source, targetId: owner.unitId, instance: {
      instanceId: `${embalmerIds.enemyFireSpent}:${owner.unitId}:${actor.unitId}`, statusId: embalmerIds.enemyFireSpent,
      source, stacks: 1, duration: { kind: 'permanent' as const },
      values: { turnActorId: actor.unitId, spent: Number(prior?.values?.spent ?? 0) + event.before - event.after },
    }, parentEventId: event.eventId };
  });
}

function validEnemy(actor: Readonly<UnitState>, target: Readonly<UnitState>): boolean {
  return Boolean(actor && actor.heroId === embalmerIds.hero && actor.hp > 0 && target && target.hp > 0 && target.side !== actor.side);
}
function attack(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number,
  parentEventId?: string): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: embalmerSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical, ...(parentEventId ? { parentEventId } : {}) }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function lowestRatio(units: readonly Readonly<UnitState>[]): Readonly<UnitState> { return [...units].sort((left, right) =>
  left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!; }
function embalmerIntent(actorId: string, skillId: string, targetId: string, shape: ActionIntent['shape'], targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape, targetRelation };
}
function embalmerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
