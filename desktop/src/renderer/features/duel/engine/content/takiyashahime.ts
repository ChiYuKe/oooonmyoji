import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const takiyashahimeIds = { hero: 338, basic: '3381', switch: '3382', aoe: '3383', single: '3384',
  moonCrit: 'status.hero.338.moon-crit', moonDamage: 'status.hero.338.moon-damage', move: 'status.hero.338.move',
  cooldown: 'status.hero.338.move-cooldown', moonGuard: 'status.hero.338.moon-guard' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const aoeRatios = [.99, 1.09, 1.18, 1.27, 1.36] as const;
const singleRatios = [.5, .53, .55, .58, .63] as const;

export function registerTakiyashahime(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: takiyashahimeIds.moonCrit, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 },
    { id: takiyashahimeIds.moonDamage, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 },
    { id: takiyashahimeIds.move, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: takiyashahimeIds.cooldown, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: takiyashahimeIds.moonGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', controlProtection: 'single-application' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: takiyashahimeIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      return damageHits(context, intent, basic.id, [Number(parameters.ratio ?? basicRatios[rank(context.getUnit(intent.actorId), basic.id) - 1]!)], false);
    } };
  const switchMove: SkillDefinition = { id: takiyashahimeIds.switch, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    levels: [{ cooldown: 2 }, { cooldown: 2 }, { cooldown: 2 }, { cooldown: 2 }, { cooldown: 1 }],
    canUse(_state, actor) { return actor.heroId === takiyashahimeIds.hero && actor.hp > 0 && !has(actor, takiyashahimeIds.cooldown); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== takiyashahimeIds.hero || actor.hp <= 0) return [];
      const old = actor.statuses.find(status => status.statusId === takiyashahimeIds.move);
      const current = Number(old?.values?.activeSkill ?? takiyashahimeIds.aoe);
      const next = current === Number(takiyashahimeIds.aoe) ? takiyashahimeIds.single : takiyashahimeIds.aoe;
      const source = takiyashahimeSource(switchMove.id, actor.unitId), cooldown = Number(parameters.cooldown ?? (rank(actor, switchMove.id) >= 5 ? 1 : 2));
      const commands: EffectCommand[] = [];
      if (old) commands.push({ type: 'remove-status-instances', source: old.source, targetId: actor.unitId,
        instanceIds: [old.instanceId], reason: 'replaced' });
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${takiyashahimeIds.move}:${actor.unitId}`,
          statusId: takiyashahimeIds.move, source, stacks: 1, duration: { kind: 'permanent' }, values: { activeSkill: next } } },
        { type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${takiyashahimeIds.cooldown}:${actor.unitId}`,
          statusId: takiyashahimeIds.cooldown, source, stacks: 1, duration: { kind: 'permanent' },
          values: { remaining: cooldown, castAction: context.state.counters.action } } });
      return commands;
    } };
  const aoe: SkillDefinition = { id: takiyashahimeIds.aoe, useClientDamageData: false, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: aoeRatios.map(ratio => ({ ratio, firstRatio: .12, secondRatio: .24 })),
    canUse(_state, actor) { return actor.heroId === takiyashahimeIds.hero && actor.hp > 0 && activeMove(actor) === takiyashahimeIds.aoe; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      return damageHits(context, intent, aoe.id, [Number(parameters.firstRatio ?? .12), Number(parameters.secondRatio ?? .24),
        Number(parameters.ratio ?? aoeRatios[rank(actor, aoe.id) - 1]!)], true);
    } };
  const single: SkillDefinition = { id: takiyashahimeIds.single, useClientDamageData: false, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: singleRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return actor.heroId === takiyashahimeIds.hero && actor.hp > 0 && activeMove(actor) === takiyashahimeIds.single; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const ratio = Number(parameters.ratio ?? singleRatios[rank(actor, single.id) - 1]!);
      return damageHits(context, intent, single.id, [ratio, ratio, ratio, ratio, ratio], false);
    } };

  const definition: HeroDefinition = { id: takiyashahimeIds.hero, skills: [basic, switchMove, aoe, single], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端技能与buff行接入：曜断100%/105%/110%/115%/125%，开战获得5层新月祝福；每次自身回合结束把1层20%暴击抵抗转为20%伤害。月之奥义消耗3火；残阳无影按12%/24%/99%至136%对全体造成三段伤害，胧月无眠对单体五段50%至63%；月之奥义按技能等级开启侵掠（生命高于50%忽略180防御）、飞流（每段驱散1增益，否则击退5%行动条）、风疾（低于50%目标增伤30%）、不动（不触发目标御魂并获得1回合抵挡控制的月之庇护），切换冷却2回合、五级1回合。客户端技能描述支持双式与四种追加效果，但现有行动意图没有承载效果选择，本实现按等级自动应用可解锁效果；放逐抵挡和特定切换效果仍需帧核。她不在10点场阵容中，因此本次没有直接触发帧。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== takiyashahimeIds.hero || actor.unitKind === 'summon') return [];
      const source = takiyashahimeSource(takiyashahimeIds.basic, unitId);
      return [
        { type: 'add-status', source, targetId: unitId, instance: { instanceId: `${takiyashahimeIds.moonCrit}:${unitId}`,
          statusId: takiyashahimeIds.moonCrit, source, stacks: 5, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'critResist', operation: 'flat', amount: .2, perStack: true }] } },
        { type: 'add-status', source, targetId: unitId, instance: { instanceId: `${takiyashahimeIds.move}:${unitId}`,
          statusId: takiyashahimeIds.move, source: takiyashahimeSource(takiyashahimeIds.switch, unitId), stacks: 1,
          duration: { kind: 'permanent' }, values: { activeSkill: takiyashahimeIds.aoe } } },
      ];
    },
    handlers: {
      'turn-start': { priority: 338, handle(context, event) { return tickSwitchCooldown(context, event); } },
      'turn-end': { priority: 338, handle(context, event) { return convertMoonBlessing(context, event); } },
      hit: { priority: 338, handle(context, event) { return moonEffects(context, event); } },
      'action-end': { priority: 338, handle(context, event) { return applyMoonGuard(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== takiyashahimeIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const desired = enemies.length > 1 ? takiyashahimeIds.aoe : takiyashahimeIds.single;
      if (activeMove(actor) !== desired && !has(actor, takiyashahimeIds.cooldown))
        return { actorId: unitId, skillId: switchMove.id, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const skillId = activeMove(actor), target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId, targetIds: skillId === takiyashahimeIds.aoe ? enemies.map(enemy => enemy.unitId) : [target.unitId],
        shape: skillId === takiyashahimeIds.aoe ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function damageHits(context: BattleContext, intent: ActionIntent, skillId: string, ratios: readonly number[], allEnemies: boolean): EffectCommand[] {
  const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const targets = allEnemies ? context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    : intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== actor.side));
  const actorRank = rank(actor, takiyashahimeIds.switch), commands: EffectCommand[] = [];
  for (const ratio of ratios) for (const target of targets) {
    const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hpRatio = target.hp / Math.max(1, target.stats.hp);
    const specialMode = skillId === takiyashahimeIds.aoe || skillId === takiyashahimeIds.single;
    const result = context.calculateDamage({ attack: offense.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(actor),
      ...(specialMode && hpRatio > .5 ? { defenseReduction: { ignoreDefenseValue: 180 } } : {}),
      ratio: ratio * (specialMode && actorRank >= 3 && hpRatio < .5 ? 1.3 : 1),
      critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
    commands.push({ type: 'deal-damage', source: takiyashahimeSource(skillId, actor.unitId), targetId: target.unitId,
      amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
      ...(specialMode && actorRank >= 4 ? { suppressTargetSoulTriggers: true } : {}) });
  }
  return commands;
}

function convertMoonBlessing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.heroId !== takiyashahimeIds.hero || actor.hp <= 0) return;
  const crit = actor.statuses.find(status => status.statusId === takiyashahimeIds.moonCrit);
  if (!crit || crit.stacks <= 0) return;
  const damage = actor.statuses.find(status => status.statusId === takiyashahimeIds.moonDamage);
  const source = takiyashahimeSource(takiyashahimeIds.basic, actor.unitId);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: crit.source, targetId: actor.unitId,
    instanceIds: [crit.instanceId], reason: 'consumed' }];
  if (crit.stacks > 1) commands.push({ type: 'add-status', source: crit.source, targetId: actor.unitId,
    instance: { ...crit, stacks: crit.stacks - 1 } });
  if (damage && damage.stacks < 5) {
    commands.push({ type: 'remove-status-instances', source: damage.source, targetId: actor.unitId,
      instanceIds: [damage.instanceId], reason: 'replaced' });
    commands.push({ type: 'add-status', source: damage.source, targetId: actor.unitId, instance: { ...damage, stacks: damage.stacks + 1 } });
  }
  else if (!damage) commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${takiyashahimeIds.moonDamage}:${actor.unitId}`,
    statusId: takiyashahimeIds.moonDamage, source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'damage', operation: 'percent', amount: .2, perStack: true }] } });
  return commands;
}

function tickSwitchCooldown(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.heroId !== takiyashahimeIds.hero) return;
  const cooldown = actor.statuses.find(status => status.statusId === takiyashahimeIds.cooldown);
  if (!cooldown || Number(cooldown.values?.castAction ?? -1) === (event.actionId ?? context.state.counters.action)) return;
  const remaining = Number(cooldown.values?.remaining ?? 0) - 1;
  if (remaining <= 0) return [{ type: 'remove-status-instances', source: cooldown.source, targetId: actor.unitId,
    instanceIds: [cooldown.instanceId], reason: 'consumed' }];
  return [{ type: 'remove-status-instances', source: cooldown.source, targetId: actor.unitId, instanceIds: [cooldown.instanceId], reason: 'replaced' },
    { type: 'add-status', source: cooldown.source, targetId: actor.unitId, instance: { ...cooldown,
      values: { ...cooldown.values, remaining } } }];
}

function moonEffects(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || ![takiyashahimeIds.aoe, takiyashahimeIds.single].includes(event.source.id as never)
    || !event.source.unitId || event.amount <= 0) return;
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== takiyashahimeIds.hero || !target || target.hp <= 0 || rank(actor, takiyashahimeIds.switch) < 2) return;
  const source = takiyashahimeSource(takiyashahimeIds.switch, actor.unitId);
  const removed = target.statuses.filter(status => {
    return context.getStatusCategory(status.statusId) === 'buff' && context.isStatusDispellable(status.statusId);
  })
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0];
  if (removed) return [{ type: 'dispel-statuses', source, targetId: target.unitId, instanceIds: [removed.instanceId],
    maxCount: 1, filter: 'buff', parentEventId: event.eventId }];
  return [{ type: 'change-action-gauge', source, targetId: target.unitId, amount: -.05, parentEventId: event.eventId }];
}

function applyMoonGuard(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || ![takiyashahimeIds.aoe, takiyashahimeIds.single].includes(event.skillId as never)) return;
  const actor = context.getUnit(event.intent?.actorId ?? '');
  if (!actor || actor.heroId !== takiyashahimeIds.hero || actor.hp <= 0 || rank(actor, takiyashahimeIds.switch) < 4) return;
  const source = takiyashahimeSource(takiyashahimeIds.switch, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${takiyashahimeIds.moonGuard}:${actor.unitId}`,
    statusId: takiyashahimeIds.moonGuard, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }];
}

function activeMove(unit: Readonly<UnitState>): string {
  return String(unit.statuses.find(status => status.statusId === takiyashahimeIds.move)?.values?.activeSkill ?? takiyashahimeIds.aoe);
}
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function rank(unit: Readonly<UnitState> | undefined, skillId: string): number {
  return Math.max(1, Math.min(5, unit?.skillLevels?.[skillId] ?? unit?.skillLevel ?? 1));
}
function takiyashahimeSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
