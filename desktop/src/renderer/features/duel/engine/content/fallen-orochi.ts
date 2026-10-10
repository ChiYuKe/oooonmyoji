import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

/** 神堕八岐大蛇。未由10点场录像验证，故只标部分覆盖。 */
export const fallenOrochiIds = {
  hero: 383, basic: '3831', power: '3832', ritual: '3833', bite: '3834', judgment: '3835', swordSkill: '3836',
  form: 'status.hero.383.snake-god', realm: 'status.hero.383.ultimate-realm', swords: 'status.hero.383.broken-swords',
  sealedAttack: 'status.hero.383.sealed-attack', corrupted: 'status.hero.383.corrupted', snakeDefeated: 'status.hero.383.snake-defeated',
  speedBuff: 'status.hero.383.snake-speed', sword: 'status.hero.383.fallen-sword', powerUses: 'status.hero.383.power-uses',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const brokenSwordCap = 6;
const controlTypes = ['stun', 'freeze', 'deep-freeze', 'confusion', 'sleep', 'silence', 'provoke', 'banish', 'transform', 'seal', 'disarm',
  '眩晕', '冰冻', '深度冰冻', '混乱', '沉睡', '沉默', '嘲讽', '放逐', '变形', '封印', '缴械'];

export function registerFallenOrochi(registry: ContentRegistry): void {
  const transformedUltimate: SkillDefinition = {
    id: fallenOrochiIds.judgment, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: 3.13, followRatio: 1.28 }],
    canUse(_state, actor) { return has(actor, fallenOrochiIds.realm); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!isOwner(actor)) return [];
      const enemies = context.getLivingUnits(opposing(actor.side));
      const commands = damageMany(context, actor, enemies, fallenOrochiIds.judgment, Number(parameters.ratio ?? 3.13));
      for (let i = 0; i < 4 && enemies.length; i++) {
        const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
        commands.push(...damageMany(context, actor, [target], fallenOrochiIds.judgment, Number(parameters.followRatio ?? 1.28)));
      }
      return commands;
    },
  };
  const ritual: SkillDefinition = {
    id: fallenOrochiIds.ritual, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: 1.88 }],
    canUse(_state, actor) { return has(actor, fallenOrochiIds.form) && !has(actor, fallenOrochiIds.realm)
      && stackCount(actor, fallenOrochiIds.swords) < brokenSwordCap; },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId); if (!isOwner(owner)) return [];
      const broken = Math.min(brokenSwordCap, stackCount(owner, fallenOrochiIds.swords) + 1);
      const existing = owner.statuses.find(status => status.statusId === fallenOrochiIds.swords);
      const commands: EffectCommand[] = [existing
        ? { type: 'change-status-stacks', source: source(fallenOrochiIds.ritual, owner.unitId), targetId: owner.unitId,
            instanceId: existing.instanceId, amount: 1 }
        : addStatus(owner, fallenOrochiIds.swords, source(fallenOrochiIds.ritual, owner.unitId), { kind: 'permanent' }, broken)];
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId && unit.unitKind !== 'summon');
      const chosen = intent.selectedTargetId ? allies.find(unit => unit.unitId === intent.selectedTargetId) : randomOf(context, allies);
      if (chosen) commands.push(addStatus(chosen, fallenOrochiIds.corrupted, source(fallenOrochiIds.ritual, owner.unitId),
        { kind: 'permanent' }, 1, [{ stat: 'speed', operation: 'percent', amount: .4 }], { ownerUnitId: owner.unitId }));
      const hpSteps = Math.floor((owner.hp / Math.max(1, owner.stats.hp)) / .2);
      const ratio = Number(parameters.ratio ?? 1.88) * (rank(owner, fallenOrochiIds.ritual) >= 4 ? 1 + .25 * hpSteps : 1);
      commands.push(...damageMany(context, owner, context.getLivingUnits(opposing(owner.side)), fallenOrochiIds.ritual, ratio));
      if (rank(owner, fallenOrochiIds.ritual) >= 2 && hpSteps > 0)
        commands.push({ type: 'heal', source: source(fallenOrochiIds.ritual, owner.unitId), targetId: owner.unitId,
          amount: owner.stats.hp * .12 * hpSteps });
      if (rank(owner, fallenOrochiIds.ritual) >= 3 && hpSteps > 0)
        commands.push({ type: 'change-action-gauge', source: source(fallenOrochiIds.ritual, owner.unitId), targetId: owner.unitId, amount: 8 * hpSteps });
      if (rank(owner, fallenOrochiIds.ritual) >= 5) commands.push(...extractSealedAttack(context, owner));
      return commands;
    },
  };
  const bite: SkillDefinition = {
    id: fallenOrochiIds.bite, actionKind: 'skill', target: 'self', targetRelation: 'ally', levels: [{ value: 1 }],
    canUse(_state, actor) { return isOwner(actor) && has(actor, fallenOrochiIds.snakeDefeated)
      && stackCount(actor, fallenOrochiIds.swords) >= 5 && !has(actor, fallenOrochiIds.realm); },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId); if (!isOwner(owner)) return [];
      const sacrifices = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId && unit.unitKind !== 'summon');
      const stolenAttack = sacrifices.reduce((total, unit) => total + unit.stats.attack * .06, 0);
      const commands: EffectCommand[] = [
        ...sacrifices.map(unit => ({ type: 'lose-life' as const, source: source(fallenOrochiIds.bite, owner.unitId), targetId: unit.unitId,
            amount: unit.hp, suppressTargetPassiveTriggers: true })),
        ...sealAllyAttack(context, owner),
        ...summonSword(owner, `${owner.unitId}:first`),
        { type: 'add-status', source: source(fallenOrochiIds.bite, owner.unitId), targetId: owner.unitId,
          instance: statusInstance(owner, fallenOrochiIds.realm, source(fallenOrochiIds.bite, owner.unitId), { kind: 'permanent' }, 1,
            stolenAttack > 0 ? [{ stat: 'attack', operation: 'flat', amount: stolenAttack }] : undefined,
            { stolenAttack }) },
        { type: 'schedule-turn', source: source(fallenOrochiIds.bite, owner.unitId), unitId: owner.unitId,
          scheduling: 'extra-turn', selection: 'action-gauge' },
      ];
      return commands;
    },
  };
  const power: SkillDefinition = {
    id: fallenOrochiIds.power, actionKind: 'skill', target: 'self', targetRelation: 'ally', levels: [{ value: 1 }],
    resolveResourceCost(state, actor) {
      const count = state.units[actor.unitId]?.statuses.find(status => status.statusId === fallenOrochiIds.powerUses)?.stacks ?? 0;
      return { resourceId: 'fire', amount: count };
    },
    canUse(_state, actor) { return isOwner(actor) && !has(actor, fallenOrochiIds.form) && !has(actor, fallenOrochiIds.snakeDefeated); },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId); if (!isOwner(owner)) return [];
      const commands: EffectCommand[] = [];
      const count = stackCount(owner, fallenOrochiIds.powerUses);
      const useCount = owner.statuses.find(status => status.statusId === fallenOrochiIds.powerUses);
      commands.push(useCount ? { type: 'change-status-stacks', source: source(fallenOrochiIds.power, owner.unitId), targetId: owner.unitId,
        instanceId: useCount.instanceId, amount: 1 } : addStatus(owner, fallenOrochiIds.powerUses,
        source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }, count + 1));
      commands.push(...sealAllyAttack(context, owner));
      const targetHp = owner.stats.attack * (rank(owner, fallenOrochiIds.power) >= 2 ? 3.8 : 2);
      commands.push({ type: 'add-status', source: source(fallenOrochiIds.power, owner.unitId), targetId: owner.unitId,
        instance: statusInstance(owner, fallenOrochiIds.form, source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }, 1,
          undefined, { originalMaxHp: owner.stats.hp }) });
      const hpDelta = targetHp - owner.stats.hp;
      if (hpDelta > 0) commands.push({ type: 'increase-max-health', source: source(fallenOrochiIds.power, owner.unitId),
        targetId: owner.unitId, amount: hpDelta });
      else if (hpDelta < 0) commands.push({ type: 'reduce-max-health', source: source(fallenOrochiIds.power, owner.unitId),
        targetId: owner.unitId, amount: -hpDelta, minimumRatio: targetHp / Math.max(1, owner.stats.hp), statusId: fallenOrochiIds.form });
      return commands;
    },
  };
  const basic: SkillDefinition = {
    id: fallenOrochiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      return isOwner(owner) && target?.hp ? damageMany(context, owner, [target], fallenOrochiIds.basic, Number(params.ratio ?? 1)) : [];
    },
  };
  const statusDefinitions: StatusDefinition[] = [
    { id: fallenOrochiIds.form, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 1, grantedSkills: [ritual], controlImmunityTypes: controlTypes,
      preventsLethalDamage: true, requiresPassiveEnabled: true,
      mechanicsCoverageNotes: ['蛇神姿态与控制免疫已接入；群体减伤在modifyIncomingDamage处理。形态生命上限、放逐交互仍待实机核验。'] },
    { id: fallenOrochiIds.realm, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', grantedSkills: [transformedUltimate], statusImmunity: 'debuffs' },
    { id: fallenOrochiIds.swords, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: brokenSwordCap },
    { id: fallenOrochiIds.sealedAttack, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: fallenOrochiIds.corrupted, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: fallenOrochiIds.snakeDefeated, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: fallenOrochiIds.speedBuff, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: fallenOrochiIds.sword, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: fallenOrochiIds.powerUses, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 99 },
  ];
  statusDefinitions.forEach(status => registry.registerStatus(status));
  registry.registerHero(createFallenOrochiDefinition([basic, power, ritual, bite]));
}

function createFallenOrochiDefinition(skills: readonly SkillDefinition[]): HeroDefinition {
  const definition: HeroDefinition = {
    id: fallenOrochiIds.hero, skills, mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端技能与状态数据接入普攻、神堕之力、蛇神姿态、审判仪式、堕化目标死亡转堕落之剑及满级终焉幻境。未模拟阴阳师位夺取；蛇神380%攻击生命、六剑完整攻防封存/返还与动画帧时序无法由当前状态模型证明。10点场不含该式神，故所有触发仍是数据/引擎核对，不算本场实战帧验证。'],
    aiCoverageNotes: ['社区式神AI条目列出：未处于蛇神姿态且非蛇神被击败时优先二技能；未提供足够的转身后行动分支。当前策略按可用火力在审判仪式与普攻间选择，故为部分覆盖。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId); if (!isOwner(owner) || rank(owner, fallenOrochiIds.power) < 5) return [];
      const targetHp = owner.stats.attack * (rank(owner, fallenOrochiIds.power) >= 2 ? 3.8 : 2);
      return [...sealAllyAttack(context, owner),
        addStatus(owner, fallenOrochiIds.powerUses, source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }, 1),
        { type: 'add-status', source: source(fallenOrochiIds.power, owner.unitId), targetId: owner.unitId,
          instance: statusInstance(owner, fallenOrochiIds.form, source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }, 1,
            undefined, { originalMaxHp: owner.stats.hp }) },
        ...(targetHp > owner.stats.hp ? [{ type: 'increase-max-health' as const, source: source(fallenOrochiIds.power, owner.unitId),
          targetId: owner.unitId, amount: targetHp - owner.stats.hp }]
          : targetHp < owner.stats.hp ? [{ type: 'reduce-max-health' as const, source: source(fallenOrochiIds.power, owner.unitId),
            targetId: owner.unitId, amount: owner.stats.hp - targetHp, minimumRatio: targetHp / Math.max(1, owner.stats.hp),
            statusId: fallenOrochiIds.form }] : [])];
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId); if (!isOwner(owner) || owner.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(opposing(owner.side)); if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (has(owner, fallenOrochiIds.realm) && fire >= 3) return { actorId: unitId, skillId: fallenOrochiIds.judgment,
        targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      if (has(owner, fallenOrochiIds.form) && fire >= 3) return { actorId: unitId, skillId: fallenOrochiIds.ritual,
        targetIds: enemies.map(unit => unit.unitId), selectedTargetId: weakestAlly(context, owner)?.unitId,
        shape: 'all-enemies', targetRelation: 'enemy' };
      if (has(owner, fallenOrochiIds.snakeDefeated) && stackCount(owner, fallenOrochiIds.swords) >= 5
        && !has(owner, fallenOrochiIds.realm)) return { actorId: unitId, skillId: fallenOrochiIds.bite,
          targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      if (!has(owner, fallenOrochiIds.form) && !has(owner, fallenOrochiIds.snakeDefeated)) return { actorId: unitId,
        skillId: fallenOrochiIds.power, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      return { actorId: unitId, skillId: fallenOrochiIds.basic,
        targetIds: [weakestEnemy(enemies).unitId], shape: 'single', targetRelation: 'enemy' };
    },
    modifyIncomingDamage(attacker, target, amount, kind, sourceRef) {
      if (target.heroId !== fallenOrochiIds.hero || !has(target, fallenOrochiIds.form)) return amount;
      if (sourceRef?.kind === 'skill' && sourceRef.id === fallenOrochiIds.bite && has(target, fallenOrochiIds.realm)) return 0;
      const swords = livingSwordsFromBattleTarget(target);
      const reduction = Math.min(.8, .2 * swords);
      return amount * (1 - reduction);
    },
    handlers: {
      'turn-start': { priority: 55, handle(context, event) { return onTurnStart(context, event); } },
      'hit': { priority: 55, handle(context, event) { return leaveSnakeOnLethal(context, event); } },
      'unit-defeated': { priority: 55, handle(context, event) { return onUnitDefeated(context, event); } },
    },
  };
  return definition;
}

function sealAllyAttack(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  return context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId && unit.unitKind !== 'summon')
    .map(unit => addStatus(unit, fallenOrochiIds.sealedAttack, source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }, 1,
      [{ stat: 'attack', operation: 'flat', amount: -unit.stats.attack * .06 }], { ownerUnitId: owner.unitId, sealedAmount: unit.stats.attack * .06 }));
}
function extractSealedAttack(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  const total = context.getLivingUnits(owner.side).flatMap(unit => unit.statuses)
    .filter(status => status.statusId === fallenOrochiIds.sealedAttack && status.source.unitId === owner.unitId)
    .reduce((sum, status) => sum + Number(status.values?.sealedAmount ?? 0), 0);
      const existing = owner.statuses.find(status => status.statusId === fallenOrochiIds.sealedAttack && status.values?.stolenAttackTaken === true);
  if (existing || total <= 0) return [];
  const lifted = Math.min(owner.stats.attack, total);
  return [{ type: 'add-status', source: source(fallenOrochiIds.ritual, owner.unitId), targetId: owner.unitId,
    instance: { ...statusInstance(owner, fallenOrochiIds.sealedAttack, source(fallenOrochiIds.ritual, owner.unitId), { kind: 'permanent' }),
      modifiers: [{ stat: 'attack', operation: 'flat', amount: lifted }], values: { stolenAttackTaken: true, sealedAttackTaken: lifted } } }];
}
function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId); if (!actor) return;
  const commands: EffectCommand[] = [];
  const corruption = actor.statuses.find(status => status.statusId === fallenOrochiIds.corrupted);
  if (corruption && actor.hp > 0) {
    const ownerId = corruption.values?.ownerUnitId;
    const sourceRef = source(fallenOrochiIds.ritual, typeof ownerId === 'string' ? ownerId : actor.unitId);
    commands.push({ type: 'lose-life', source: sourceRef, targetId: actor.unitId, amount: actor.hp * .24,
      lifeLossKind: 'direct', suppressTargetPassiveTriggers: true, parentEventId: event.eventId });
    const sleeping = actor.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control'
      && (status.values?.controlType === 'sleep' || status.values?.controlType === '沉睡')).map(status => status.instanceId);
    if (sleeping.length) commands.push({ type: 'remove-status-instances', source: sourceRef, targetId: actor.unitId,
      instanceIds: sleeping, reason: 'consumed', parentEventId: event.eventId });
  }
  if (actor.unitKind === 'summon' && actor.displayName === '堕落之剑' && actor.summonedByUnitId) {
    const owner = context.getUnit(actor.summonedByUnitId);
    if (isOwner(owner) && owner.hp > 0) commands.push(
      { type: 'heal', source: source(fallenOrochiIds.swordSkill, owner.unitId), targetId: actor.unitId, amount: actor.stats.hp * .2 },
      { type: 'change-resource', source: source(fallenOrochiIds.swordSkill, owner.unitId), side: owner.side, resourceId: 'fire', amount: 1 },
      { type: 'change-action-gauge', source: source(fallenOrochiIds.swordSkill, owner.unitId), targetId: owner.unitId, amount: 15 });
  }
  return commands.length ? commands : undefined;
}
function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (defeated?.unitKind === 'summon' && defeated.displayName === '堕落之剑' && defeated.summonedByUnitId) {
    const owner = context.getUnit(defeated.summonedByUnitId);
    const swordCount = owner?.statuses.find(status => status.statusId === fallenOrochiIds.sword);
    if (isOwner(owner) && swordCount) return [{ type: 'change-status-stacks', source: source(fallenOrochiIds.swordSkill, owner.unitId),
      targetId: owner.unitId, instanceId: swordCount.instanceId, amount: -1 }];
  }
  if (defeated?.heroId === fallenOrochiIds.hero && has(defeated, fallenOrochiIds.form)) {
    const sourceRef = source(fallenOrochiIds.power, defeated.unitId);
    const commands: EffectCommand[] = [{ type: 'remove-statuses', source: sourceRef, targetId: defeated.unitId,
      statusIds: [fallenOrochiIds.form], reason: 'consumed' },
      addStatus(defeated, fallenOrochiIds.snakeDefeated, sourceRef, { kind: 'permanent' }),
      { type: 'add-status', source: sourceRef, targetId: defeated.unitId,
        instance: { ...statusInstance(defeated, fallenOrochiIds.speedBuff, sourceRef, { kind: 'count', remaining: 1, owner: 'target-turn' }),
          modifiers: [{ stat: 'speed', operation: 'flat', amount: 100 }] } }];
    commands.push(...returnSealedAttack(context, defeated));
    return commands;
  }
  const ownerId = defeated?.statuses.find(status => status.statusId === fallenOrochiIds.corrupted)?.values?.ownerUnitId;
  const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
  if (!isOwner(owner) || !has(owner, fallenOrochiIds.form) || !passivesEnabled(owner)) return;
  const sword = summonSword(owner, `${event.unitId}:${event.eventId}`);
  const commands: EffectCommand[] = [...sword, { type: 'change-action-gauge', source: source(fallenOrochiIds.ritual, owner.unitId),
    targetId: owner.unitId, amount: 40 },
    { type: 'remove-statuses', source: source(fallenOrochiIds.ritual, owner.unitId), targetId: event.unitId,
      statusIds: [fallenOrochiIds.corrupted], reason: 'consumed' }];
  if (stackCount(owner, fallenOrochiIds.swords) < 5) {
    const existing = owner.statuses.find(status => status.statusId === fallenOrochiIds.swords);
    commands.push(existing ? { type: 'change-status-stacks', source: source(fallenOrochiIds.ritual, owner.unitId),
      targetId: owner.unitId, instanceId: existing.instanceId, amount: 1 }
      : addStatus(owner, fallenOrochiIds.swords, source(fallenOrochiIds.ritual, owner.unitId), { kind: 'permanent' }));
  }
  return commands;
}
function leaveSnakeOnLethal(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.targetId || event.fatalProtectionStatusId !== fallenOrochiIds.form) return;
  const owner = context.getUnit(event.targetId); if (!isOwner(owner)) return;
  const form = owner.statuses.find(status => status.statusId === fallenOrochiIds.form);
  const originalMaxHp = typeof form?.values?.originalMaxHp === 'number' ? form.values.originalMaxHp : owner.stats.hp;
  const hpDelta = owner.stats.hp - originalMaxHp;
  return [...(hpDelta > 0 ? [{ type: 'reduce-max-health' as const, source: source(fallenOrochiIds.power, owner.unitId),
    targetId: owner.unitId, amount: hpDelta, minimumRatio: 1, statusId: fallenOrochiIds.form }]
    : hpDelta < 0 ? [{ type: 'increase-max-health' as const, source: source(fallenOrochiIds.power, owner.unitId),
      targetId: owner.unitId, amount: -hpDelta }] : []),
    { type: 'remove-statuses', source: source(fallenOrochiIds.power, owner.unitId), targetId: owner.unitId,
    statusIds: [fallenOrochiIds.form], reason: 'consumed' },
    addStatus(owner, fallenOrochiIds.snakeDefeated, source(fallenOrochiIds.power, owner.unitId), { kind: 'permanent' }),
    { type: 'add-status', source: source(fallenOrochiIds.power, owner.unitId), targetId: owner.unitId,
      instance: { ...statusInstance(owner, fallenOrochiIds.speedBuff, source(fallenOrochiIds.power, owner.unitId),
        { kind: 'count', remaining: 1, owner: 'target-turn' }), modifiers: [{ stat: 'speed', operation: 'flat', amount: 100 }] },
      parentEventId: event.eventId },
    ...returnSealedAttack(context, owner)];
}
function returnSealedAttack(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  return context.getLivingUnits(owner.side).flatMap(unit => unit.statuses.filter(status => status.statusId === fallenOrochiIds.sealedAttack
    && status.source.unitId === owner.unitId).map(status => ({ type: 'remove-status-instances' as const, source: source(fallenOrochiIds.power, owner.unitId),
      targetId: unit.unitId, instanceIds: [status.instanceId], reason: 'consumed' as const })));
}
function summonSword(owner: Readonly<UnitState>, suffix: string): EffectCommand[] {
  const id = `${fallenOrochiIds.sword}:${owner.unitId}:${suffix}`;
  const stats = { ...owner.stats, hp: Math.max(1, owner.stats.hp * .2), attack: 0, defense: 0, speed: owner.stats.speed,
    crit: 0, critDamage: owner.stats.critDamage };
  const commands: EffectCommand[] = [{ type: 'summon-unit', source: source(fallenOrochiIds.bite, owner.unitId), unit: { unitId: id,
    heroId: fallenOrochiIds.hero, displayName: '堕落之剑', unitKind: 'summon', summonedByUnitId: owner.unitId,
    skillLevel: 1, side: owner.side, stats, hp: stats.hp, shield: 0, actionGauge: owner.actionGauge,
    statuses: [], resources: {} } }];
  const existing = owner.statuses.find(status => status.statusId === fallenOrochiIds.sword);
  commands.push(existing ? { type: 'change-status-stacks', source: source(fallenOrochiIds.bite, owner.unitId), targetId: owner.unitId,
    instanceId: existing.instanceId, amount: 1 }
    : addStatus(owner, fallenOrochiIds.sword, source(fallenOrochiIds.bite, owner.unitId), { kind: 'permanent' }));
  return commands;
}
function livingSwordsFromBattleTarget(owner: Readonly<UnitState>): number {
  // The owner status records the sword count as the broken-sword stages; summon counts are checked in turn handlers.
  return Number(owner.statuses.find(status => status.statusId === fallenOrochiIds.sword)?.stacks ?? 0);
}
function damageMany(context: BattleContext, owner: Readonly<UnitState>, targets: readonly Readonly<UnitState>[], skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  return targets.filter(target => target.hp > 0 && target.side !== owner.side).map(target => {
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: offense.crit, critDamage: offense.critDamage }, owner as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source: source(skillId, owner.unitId), targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
  });
}
function weakestAlly(context: BattleContext, owner: Readonly<UnitState>): Readonly<UnitState> | undefined {
  return context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId && unit.unitKind !== 'summon')
    .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
function weakestEnemy(units: readonly Readonly<UnitState>[]): Readonly<UnitState> {
  return units.reduce((best, unit) => unit.hp / Math.max(1, unit.stats.hp) < best.hp / Math.max(1, best.stats.hp) ? unit : best);
}
function randomOf<T>(context: BattleContext, units: readonly T[]): T | undefined {
  return units.length ? units[Math.min(units.length - 1, Math.floor(context.random() * units.length))] : undefined;
}
function rank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(6, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function stackCount(unit: Readonly<UnitState>, statusId: string): number { return unit.statuses.find(status => status.statusId === statusId)?.stacks ?? 0; }
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function isOwner(unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> { return Boolean(unit?.heroId === fallenOrochiIds.hero); }
function opposing(side: 'blue' | 'red'): 'blue' | 'red' { return side === 'blue' ? 'red' : 'blue'; }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function statusInstance(target: Readonly<UnitState>, statusId: string, sourceRef: SourceRef, duration: StatusInstance['duration'], stacks = 1,
  modifiers?: StatusInstance['modifiers'], values?: StatusInstance['values']): StatusInstance {
  return { instanceId: `${statusId}:${target.unitId}:${sourceRef.unitId ?? sourceRef.id}`, statusId, source: sourceRef, stacks, duration,
    ...(modifiers ? { modifiers } : {}), ...(values ? { values } : {}) };
}
function addStatus(target: Readonly<UnitState>, statusId: string, sourceRef: SourceRef, duration: StatusInstance['duration'], stacks = 1,
  modifiers?: StatusInstance['modifiers'], values?: StatusInstance['values']): EffectCommand {
  return { type: 'add-status', source: sourceRef, targetId: target.unitId,
    instance: statusInstance(target, statusId, sourceRef, duration, stacks, modifiers, values) };
}
