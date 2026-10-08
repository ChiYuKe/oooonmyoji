import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const tenkenOniKiriIds = {
  hero: 343, basic: '3431', stance: '3432', ultimate: '3433', shadowCut: 'status.hero.343.shadow-cut',
  heartSword: 'status.hero.343.heart-sword', shadowLock: 'status.hero.343.shadow-lock',
  clone: 'status.hero.343.shadow-clone', guardDamage: 'status.hero.343.guard-damage', passiveReduction: 'status.hero.343.passive-reduction',
  fatalProtection: 'status.hero.343.fatal-protection', critGuard: 'status.hero.343.crit-resist',
  silence: 'status.hero.343.disarm', guardWindow: 'status.hero.343.guard-window', cloneAttack: '3439',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.76, 2.89, 3.02, 3.02, 3.02] as const;

export function registerTenkenOniKiri(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: tenkenOniKiriIds.shadowCut, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
      sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace', preventsDamageSharing: true,
      preventsDamageSharingOnHitActionKinds: ['basic', 'skill'],
      ignoresShieldOnHitActionKinds: ['basic', 'skill'], suppressesTargetTriggersOnHitActionKinds: ['basic', 'skill'],
      consumesOneStackOnHitActionKinds: ['basic', 'skill'] },
    { id: tenkenOniKiriIds.heartSword, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
      controlImmunityTypes: ['眩晕', '冰冻', '深度冰冻', '混乱', '沉睡', '沉默', '嘲讽', '放逐', '变形', '封印', '缴械'],
      preventsAssist: true },
    { id: tenkenOniKiriIds.shadowLock, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsActionGaugeChange: true, preventsAssist: true },
    { id: tenkenOniKiriIds.clone, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: tenkenOniKiriIds.passiveReduction, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: tenkenOniKiriIds.guardDamage, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 },
    { id: tenkenOniKiriIds.fatalProtection, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: tenkenOniKiriIds.critGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
      sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: tenkenOniKiriIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
      sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true },
    { id: tenkenOniKiriIds.guardWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: tenkenOniKiriIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== tenkenOniKiriIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return [damageCommand(context, actor, target, basic.id, Number(parameters.ratio ?? 1))];
    } };

  const stance: SkillDefinition = { id: tenkenOniKiriIds.stance, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    levels: [1, 2, 3, 4, 5].map(level => ({ damageReduction: level >= 2 ? .3 : .2,
      blockChance: level >= 3 ? .8 : .6, damagePerBlock: level >= 4 ? .2 : 0,
      fatalProtection: level >= 5, gauge: .4 })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== tenkenOniKiriIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const source = tenkenSource(stance.id, actor.unitId), commands: EffectCommand[] = [
        { type: 'add-status', source, targetId: actor.unitId, instance: statusInstance(tenkenOniKiriIds.heartSword,
          `${tenkenOniKiriIds.heartSword}:${actor.unitId}`, source, 1, { enteredHeartSword: true }) },
        { type: 'add-status', source, targetId: actor.unitId, instance: statusInstance(tenkenOniKiriIds.clone,
          `${tenkenOniKiriIds.clone}:${actor.unitId}`, source, 1, { active: true, charges: 0 }) },
        { type: 'add-status', source, targetId: target.unitId, instance: statusInstance(tenkenOniKiriIds.shadowLock,
          `${tenkenOniKiriIds.shadowLock}:${actor.unitId}:${target.unitId}`, source, 1,
          { ownerUnitId: actor.unitId, basicHits: 0, cloneCharges: 0 }) },
        { type: 'change-action-gauge', source, targetId: actor.unitId, amount: 40 },
      ];
      return commands;
    } };

  const ultimate: SkillDefinition = { id: tenkenOniKiriIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: skillRank(actor, ultimate.id) >= 5
      && actor.statuses.some(status => status.statusId === tenkenOniKiriIds.heartSword) ? 1 : 3 }; },
    levels: ultimateRatios.map((ratio, index) => ({ ratio, shadowRepeat: index >= 3, heartSwordDiscount: index >= 4 ? 2 : 0,
      heartSwordGauge: index >= 4 ? 40 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== tenkenOniKiriIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const source = tenkenSource(ultimate.id, actor.unitId), commands: EffectCommand[] = [
        damageCommand(context, actor, target, ultimate.id, Number(parameters.ratio ?? 2.76)),
      ];
      const existing = target.statuses.find(status => status.statusId === tenkenOniKiriIds.shadowCut);
      const anotherMarkedEnemy = context.getLivingUnits(target.side).some(unit => unit.statuses.some(status =>
        status.statusId === tenkenOniKiriIds.shadowCut && status.source.unitId === actor.unitId));
      if (!existing && !anotherMarkedEnemy) commands.push({ type: 'add-status', source, targetId: target.unitId,
        instance: { ...statusInstance(tenkenOniKiriIds.shadowCut,
          `${tenkenOniKiriIds.shadowCut}:${actor.unitId}:${target.unitId}`, source, 3,
          { ownerUnitId: actor.unitId, remainingHits: 3 }),
          modifiers: [{ stat: 'speed', operation: 'flat', amount: -20 },
            { stat: 'defense', operation: 'percent', amount: -.2 }, { stat: 'healingTaken', operation: 'percent', amount: -.75 }] } });
      if (skillRank(actor, ultimate.id) >= 5 && actor.statuses.some(status => status.statusId === tenkenOniKiriIds.heartSword)) {
        commands.push({ type: 'change-action-gauge', source, targetId: actor.unitId, amount: 40 });
      }
      return commands;
    } };

  const definition: HeroDefinition = {
    id: tenkenOniKiriIds.hero, skills: [basic, stance, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按ID343技能及状态行接入无剑100%至125%普攻；真剑·韧心常驻20%/30%减伤，敌回合结束前首次进入心剑前推10%行动条，普攻格挡概率60%/80%，成功时免伤、使攻击者沉默1回合并推自身10%条，四级起每次格挡叠20%增伤至5层；五级有每回目一次致命保护。真剑·韧心进入控制免疫心剑、推40%行动条、标记选中目标并召出影之分身。天剑·断恶斩耗3火造成276%至302%，标记目标并在四级起响应标记目标施放技能；心剑五级耗火降至1并推40%行动条。危标记减疗75%、降速20和防御20%，后续三次普攻/技能命中忽略护盾、不可分担；其禁止被动/御魂触发的全局抑制窗口、影切/分身计数和反击/协战禁用仍属部分覆盖。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== tenkenOniKiriIds.hero || !passivesEnabled(actor)) return [];
      const source = tenkenSource(stance.id, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId,
        instance: statusInstance(tenkenOniKiriIds.passiveReduction, `${tenkenOniKiriIds.passiveReduction}:${actor.unitId}`,
          source, 1, { passiveReady: true }) }];
    },
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.heroId !== tenkenOniKiriIds.hero || !passivesEnabled(target)) return amount;
      return amount * (skillRank(target, stance.id) >= 2 ? .7 : .8);
    },
    interceptIncomingDamage(_state, attacker, target, amount, kind, interception) {
      if (!attacker || target.heroId !== tenkenOniKiriIds.hero || target.hp <= 0 || kind !== 'normal'
        || interception?.actionKind !== 'basic' || !passivesEnabled(target) || interception.isUnitUnableToAct(target.unitId)) return;
      if (target.statuses.some(status => status.statusId === tenkenOniKiriIds.guardWindow
        && Number(status.values?.attackId) === interception.attackId)) return;
      const rank = skillRank(target, stance.id), chance = rank >= 3 ? .8 : .6;
      const source = tenkenSource(stance.id, target.unitId), commands: EffectCommand[] = [
        { type: 'add-status', source, targetId: target.unitId,
          instance: statusInstance(tenkenOniKiriIds.guardWindow, `${tenkenOniKiriIds.guardWindow}:${target.unitId}`,
            source, 1, { attackId: interception.attackId }) },
      ];
      if (interception.battle.random() >= chance) return { amount, effects: commands };
      commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 10 });
      const silence = attemptControl(interception.battle, { attemptId: `${tenkenOniKiriIds.silence}:${interception.attackId}`,
        source, targetId: attacker.unitId, statusId: tenkenOniKiriIds.silence, controlType: '沉默', baseChance: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      if (silence) commands.push(silence);
      const damageStack = target.statuses.find(status => status.statusId === tenkenOniKiriIds.guardDamage);
      if (rank >= 4 && (damageStack?.stacks ?? 0) < 5) commands.push({ type: 'add-status', source, targetId: target.unitId,
        instance: { ...statusInstance(tenkenOniKiriIds.guardDamage, `${tenkenOniKiriIds.guardDamage}:${target.unitId}`,
          source, 1), modifiers: [{ stat: 'damage', operation: 'percent', amount: .2, perStack: true }] } });
      return { amount: 0, effects: commands };
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== tenkenOniKiriIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const heart = actor.statuses.some(status => status.statusId === tenkenOniKiriIds.heartSword);
      return { actorId: unitId, skillId: heart ? ultimate.id : stance.id, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-end': { priority: 343, handle(context, event) { return handleTenkenTurnEnd(context, event); } },
      'turn-start': { priority: 343, handle(context, event) { return handleTenkenTurnStart(context, event); } },
      'action-end': { priority: 343, handle(context, event) { return handleShadowCloneAction(context, event); } },
      'attack-end': { priority: 343, handle(context, event) { return clearTenkenGuardWindow(context, event); } },
      'unit-defeated': { priority: 343, handle(context, event) { return handleFatalProtection(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function handleTenkenTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ended = context.getUnit(event.unitId);
  if (!ended) return;
  const owners = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === tenkenOniKiriIds.hero && unit.side !== ended.side && passivesEnabled(unit)
      && !unit.statuses.some(status => status.statusId === tenkenOniKiriIds.heartSword));
  const commands: EffectCommand[] = owners.map(owner => ({ type: 'change-action-gauge' as const,
    source: tenkenSource(tenkenOniKiriIds.stance, owner.unitId), targetId: owner.unitId, amount: 10, parentEventId: event.eventId }));
  if (ended.heroId === tenkenOniKiriIds.hero) {
    for (const enemy of context.getLivingUnits(ended.side === 'blue' ? 'red' : 'blue')) {
      const lock = enemy.statuses.find(status => status.statusId === tenkenOniKiriIds.shadowLock && status.source.unitId === ended.unitId);
      if (lock && Number(lock.values?.cloneCharges ?? 0) < 5) commands.push({ type: 'add-status', source: lock.source,
        targetId: enemy.unitId, parentEventId: event.eventId,
        instance: { ...lock, values: { ...lock.values, cloneCharges: Math.min(5, Number(lock.values?.cloneCharges ?? 0) + 3) } } });
    }
  }
  return commands.length ? commands : undefined;
}

function handleTenkenTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== tenkenOniKiriIds.hero) return;
  const hasShadowCut = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
    .some(enemy => enemy.statuses.some(status => status.statusId === tenkenOniKiriIds.shadowCut
      && status.source.unitId === owner.unitId));
  if (hasShadowCut) return;
  const heart = owner.statuses.find(status => status.statusId === tenkenOniKiriIds.heartSword);
  const clone = owner.statuses.find(status => status.statusId === tenkenOniKiriIds.clone);
  const commands: EffectCommand[] = [];
  if (heart) commands.push({ type: 'remove-status-instances', source: heart.source, targetId: owner.unitId,
    instanceIds: [heart.instanceId], reason: 'expired', parentEventId: event.eventId });
  if (clone) commands.push({ type: 'remove-status-instances', source: clone.source, targetId: owner.unitId,
    instanceIds: [clone.instanceId], reason: 'expired', parentEventId: event.eventId });
  for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) {
    const lock = enemy.statuses.find(status => status.statusId === tenkenOniKiriIds.shadowLock
      && status.source.unitId === owner.unitId);
    if (lock) commands.push({ type: 'remove-status-instances', source: lock.source, targetId: enemy.unitId,
      instanceIds: [lock.instanceId], reason: 'expired', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function handleShadowCloneAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'skill' || !event.intent) return;
  const target = context.getUnit(event.intent.actorId);
  const marker = target?.statuses.find(status => status.statusId === tenkenOniKiriIds.shadowCut);
  const owner = marker?.source.unitId ? context.getUnit(marker.source.unitId) : undefined;
  if (!target || !marker || !owner || owner.hp <= 0 || skillRank(owner, tenkenOniKiriIds.ultimate) < 4
    || !owner.statuses.some(status => status.statusId === tenkenOniKiriIds.clone)) return;
  const rank = skillRank(owner, tenkenOniKiriIds.ultimate), ratio = ultimateRatios[rank - 1]! * .7;
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: offense.crit, critDamage: offense.critDamage },
  owner as UnitState, target as UnitState);
  return [{ type: 'schedule-attack', source: tenkenSource(tenkenOniKiriIds.cloneAttack, owner.unitId),
    parentEventId: event.eventId, scheduling: 'counter',
    intent: { actorId: owner.unitId, skillId: tenkenOniKiriIds.cloneAttack, targetIds: [target.unitId],
      shape: 'single', targetRelation: 'enemy', kind: 'skill' }, suppressSourcePassiveTriggers: true,
    hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
      isCritical: hit.isCritical }] }];
}

function clearTenkenGuardWindow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) for (const unit of context.getLivingUnits(side)) {
    const status = unit.statuses.find(entry => entry.statusId === tenkenOniKiriIds.guardWindow
      && Number(entry.values?.attackId) === event.attackId);
    if (status) commands.push({ type: 'remove-status-instances', source: status.source, targetId: unit.unitId,
      instanceIds: [status.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function handleFatalProtection(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const target = context.getUnit(event.unitId), attacker = event.defeatedBy?.unitId ? context.getUnit(event.defeatedBy.unitId) : undefined;
  if (!target || target.heroId !== tenkenOniKiriIds.hero || skillRank(target, tenkenOniKiriIds.stance) < 5
    || !passivesEnabled(target) || target.unitKind === 'summon') return;
  const used = target.statuses.find(status => status.statusId === tenkenOniKiriIds.fatalProtection);
  if (Number(used?.values?.lastTriggerRound ?? -1) === context.state.counters.round) return;
  const source = tenkenSource(tenkenOniKiriIds.stance, target.unitId), commands: EffectCommand[] = [
    { type: 'add-status', source, targetId: target.unitId, instance: { ...statusInstance(tenkenOniKiriIds.fatalProtection,
      `${tenkenOniKiriIds.fatalProtection}:${target.unitId}`, source, 1, { passiveReady: true,
        lastTriggerRound: context.state.counters.round }), modifiers: [] } },
    { type: 'revive', source, targetId: target.unitId, hp: target.stats.hp * .5, parentEventId: event.eventId },
    { type: 'add-status', source, targetId: target.unitId, instance: { ...statusInstance(tenkenOniKiriIds.critGuard,
      `${tenkenOniKiriIds.critGuard}:${target.unitId}`, source, 1),
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'critResist', operation: 'flat', amount: 1 }] } },
    { type: 'change-action-gauge', source, targetId: target.unitId, amount: 30, parentEventId: event.eventId },
  ];
  if (attacker && attacker.hp > 0 && attacker.side !== target.side) commands.push({ type: 'schedule-action', source,
    parentEventId: event.eventId, scheduling: 'counter', freeCast: true,
    intent: { actorId: target.unitId, skillId: tenkenOniKiriIds.stance, targetIds: [attacker.unitId], shape: 'single', targetRelation: 'enemy' } });
  return commands;
}

function damageCommand(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage },
  actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source: tenkenSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
}

function statusInstance(statusId: string, instanceId: string, source: SourceRef, stacks: number,
  values: StatusInstance['values'] = {}, modifiers?: StatusInstance['modifiers']): StatusInstance {
  return { statusId, instanceId, source, stacks, duration: { kind: 'permanent' }, values, ...(modifiers ? { modifiers } : {}) };
}

function skillRank(unit: Readonly<UnitState>, id: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[id] ?? unit.skillLevel)); }
function tenkenSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
