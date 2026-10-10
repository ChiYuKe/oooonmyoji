import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { isUnitBanished } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yatoNoKamiIds = {
  hero: 373, basic: '3731', passive: '3732', ultimate: '3733',
  dance: 'status.hero.373.dance', nightCurtain: 'status.hero.373.night-curtain', shelter: 'status.hero.373.shelter',
  nightSigil: 'status.hero.373.night-sigil', skipped: 'status.hero.373.sigil-skip',
  critDown: 'status.hero.373.sigil-crit', seal: 'status.hero.373.sigil-seal', confusion: 'status.hero.373.sigil-confusion',
  maxHpDown: 'status.hero.373.sigil-max-hp',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const enemySide = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isYato = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === yatoNoKamiIds.hero;
const rank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));
const sourceFor = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });

export function registerYatoNoKami(registry: ContentRegistry): void {
  const ids = yatoNoKamiIds;
  const statuses: StatusDefinition[] = [
    { id: ids.dance, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 7 },
    { id: ids.nightCurtain, mechanicsCoverage: 'partial', category: 'control', dispellable: false, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace', preventsAction: true, preventsSkill: true,
      preventsAssist: true, preventsActionGaugeChange: true, preventsBuffApplications: true,
      preventsStatusApplications: true, statusImmunity: 'debuffs' },
    { id: ids.shelter, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: ids.nightSigil, mechanicsCoverage: 'partial', category: 'mark', dispellable: true, negativeEffect: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: ids.skipped, mechanicsCoverage: 'partial', category: 'control', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true },
    { id: ids.critDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
    { id: ids.seal, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
    { id: ids.confusion, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
    { id: ids.maxHpDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basicTemplate = createBasicAttackSkill(ids.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate };
  const ultimate: SkillDefinition = {
    id: ids.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 4 },
    resourceCostsByLevel: [4, 4, 4, 4, 3].map(amount => ({ resourceId: 'fire', amount })),
    target: 'single', targetRelation: 'enemy', levels: [{ ratio: 2.1 }, { ratio: 2.7 }, { ratio: 2.7 }, { ratio: 2.7 }, { ratio: 2.7 }],
    canUse(state, actor) { return actor.hp > 0 && isYato(actor) && isFirstYato(state, actor); },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !isYato(owner) || !target || target.hp <= 0 || !isValidSigilTarget(target)) return [];
      const source = sourceFor(ids.ultimate, owner.unitId);
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
        ratio: Number(parameters.ratio ?? 2.1), critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical },
      { type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${ids.nightSigil}:${owner.unitId}:${target.unitId}`, statusId: ids.nightSigil, source,
        stacks: 1, duration: { kind: 'permanent' }, values: { usedMask: 0 },
      } }];
    },
  };
  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入赤子等级伤害、每只蝙蝠叠共舞并推自身行动条、夜之邀约15%吸血及7层触发夜幕/三段真实伤害、七夜秘仪唯一先机减伤/抵抗、4/3火施放、楔印的七种效果和回合后选择分支。敌方玩家从两个候选中手选楔子与时机的部分以随机选择模拟，无法视为实战决策还原；夜幕下已有召唤被动/御魂是否仍触发、多夜刀神唯一效果作用域及楔印与驱散/御魂的原生顺序仍待连续实战帧核。'],
    aiCoverageNotes: ['社区AI为无条件使用3技能、优先攻击高攻击敌方（阴阳师除外）；当前策略会先按技能等级检查4/3火并在不足时选择普攻。楔印受方的选项与触发时点是玩家决策，模拟仅以随机分支代替，不能视为AI/手动决策还原。'],
    handlers: {
      'battle-start': { priority: 41, handle(context, event) { return startBattle(context, event); } },
      hit: { priority: 41, handle(context, event) { return leech(context, event); } },
      'action-end': { priority: 41, handle(context, event) { return onActionEnd(context, event); } },
      'turn-start': { priority: 41, handle(context, event) { return resolveTurnStart(context, event); } },
      'turn-end': { priority: 41, handle(context, event) { return resolveSigilAtTurnEnd(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || !isYato(actor) || !isFirstYato(context.state, actor)) return undefined;
      const enemies = context.getLivingUnits(enemySide(actor.side));
      if (!enemies.length) return undefined;
      const target = enemies.filter(unit => unit.unitKind !== 'onmyoji').sort((a, b) => b.stats.attack - a.stats.attack
        || b.actionGauge - a.actionGauge)[0] ?? enemies[0]!;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= (rank(actor, ids.ultimate) >= 5 ? 3 : 4)
        ? ids.ultimate : ids.basic;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function startBattle(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const owner = context.getLivingUnits(side).find(unit => isYato(unit) && isFirstYato(context.state, unit));
    if (!owner || owner.statuses.some(status => status.statusId === yatoNoKamiIds.shelter)) continue;
    const source = sourceFor(yatoNoKamiIds.ultimate, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${yatoNoKamiIds.shelter}:${owner.unitId}`, statusId: yatoNoKamiIds.shelter,
      source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.49 }, { stat: 'resist', operation: 'flat', amount: .7 }],
    } });
  }
  return commands.length ? commands : undefined;
}

function leech(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || !isYato(owner) || owner.hp <= 0 || !passivesEnabled(owner)) return;
  return [{ type: 'heal', source: sourceFor(yatoNoKamiIds.passive, owner.unitId), targetId: owner.unitId,
    amount: event.hpLost * .15, parentEventId: event.eventId }];
}

function onActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || !isYato(owner) || owner.hp <= 0 || !passivesEnabled(owner) || !isFirstYato(context.state, owner)) return;
  const bats = event.skillId === yatoNoKamiIds.basic ? 1 : event.skillId === yatoNoKamiIds.ultimate ? 3 : 0;
  if (!bats) return;
  const extra = event.skillId === yatoNoKamiIds.basic && rank(owner, yatoNoKamiIds.basic) >= 5 && context.random() < .5 ? 1 : 0;
  const current = owner.statuses.find(status => status.statusId === yatoNoKamiIds.dance);
  const gained = Math.min(bats + extra, 7 - (current?.stacks ?? 0));
  const source = sourceFor(yatoNoKamiIds.passive, owner.unitId), commands: EffectCommand[] = [];
  if (gained > 0) {
    commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${yatoNoKamiIds.dance}:${owner.unitId}`, statusId: yatoNoKamiIds.dance,
        source, stacks: Math.min(7, (current?.stacks ?? 0) + gained), duration: { kind: 'permanent' } } },
    { type: 'change-action-gauge', source, targetId: owner.unitId, amount: gained * 10, parentEventId: event.eventId });
  }
  const nextCount = (current?.stacks ?? 0) + gained;
  if (nextCount >= 7 && !context.isUnitUnableToAct(owner.unitId)) commands.push(...releaseDance(context, owner, event.eventId, nextCount));
  return commands.length ? commands : undefined;
}

function releaseDance(context: BattleContext, owner: Readonly<UnitState>, parentEventId?: string, expectedStacks?: number): EffectCommand[] {
  const ids = yatoNoKamiIds, source = sourceFor(ids.passive, owner.unitId);
  const dance = owner.statuses.find(status => status.statusId === ids.dance);
  if (!dance || Math.max(dance.stacks, expectedStacks ?? 0) < 7 || !passivesEnabled(owner)) return [];
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: owner.unitId,
    instanceIds: [dance.instanceId], reason: 'consumed', ...(parentEventId ? { parentEventId } : {}) }];
  const summon = context.getLivingUnits(enemySide(owner.side)).find(unit => unit.unitKind === 'summon');
  if (summon) {
    commands.push({ type: 'add-status', source, targetId: summon.unitId, parentEventId,
      instance: { instanceId: `${ids.nightCurtain}:${owner.unitId}:${summon.unitId}`, statusId: ids.nightCurtain,
        source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' }, values: { banished: true } } });
    return commands;
  }
  const target = context.getLivingUnits(enemySide(owner.side)).slice().sort((a, b) => a.hp - b.hp || a.unitId.localeCompare(b.unitId))[0];
  if (!target) return commands;
  const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
  for (let hit = 0; hit < 3; hit++) commands.push({ type: 'deal-damage', source, targetId: target.unitId,
    amount: attack * .77, damageKind: 'true', parentEventId });
  return commands;
}

function resolveSigilAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId), mark = target?.statuses.find(status => status.statusId === yatoNoKamiIds.nightSigil);
  if (!target || !mark || !isValidSigilTarget(target)) return;
  const owner = mark.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
  if (!owner || owner.hp <= 0) return;
  const used = Number(mark.values?.usedMask ?? 0);
  const available = Array.from({ length: 7 }, (_, index) => index).filter(index => (used & (1 << index)) === 0);
  if (!available.length) return;
  const first = Math.floor(context.random() * available.length);
  const secondPool = available.filter((_, index) => index !== first);
  const pair = secondPool.length ? [available[first]!, secondPool[Math.floor(context.random() * secondPool.length)]!] : [available[first]!];
  const chosen = pair[Math.floor(context.random() * pair.length)]!;
  const skip = context.random() < .5;
  const source = sourceFor(yatoNoKamiIds.ultimate, owner.unitId);
  const updated: StatusInstance = { ...mark, values: { ...mark.values, usedMask: used | (1 << chosen),
    pendingType: chosen + 1, pendingFull: !skip } };
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: updated }];
  if (skip) {
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${yatoNoKamiIds.skipped}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
        statusId: yatoNoKamiIds.skipped, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
    commands.push(...sigilEffect(context, owner, target, chosen + 1, false, event.eventId));
  }
  return commands;
}

function resolveSigilAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId), mark = target?.statuses.find(status => status.statusId === yatoNoKamiIds.nightSigil);
  const type = Number(mark?.values?.pendingType ?? 0), full = mark?.values?.pendingFull === true;
  if (!target || !mark || !type) return;
  const owner = mark.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
  if (!owner) return;
  const commands: EffectCommand[] = [...(full ? sigilEffect(context, owner, target, type, true, event.eventId) : []),
    { type: 'add-status', source: mark.source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { ...mark, values: { ...mark.values, pendingType: 0, pendingFull: false } } }];
  if (Number(mark.values?.usedMask ?? 0) === 127 && !context.isUnitUnableToAct(owner.unitId))
    commands.push(...resetSigil(context, owner, target, mark, event.eventId));
  return commands;
}

function sigilEffect(context: BattleContext, owner: Readonly<UnitState>, marked: Readonly<UnitState>, type: number,
  full: boolean, parentEventId: string): EffectCommand[] {
  const ids = yatoNoKamiIds, source = sourceFor(ids.ultimate, owner.unitId), victimSide = enemySide(owner.side);
  const duration = { kind: 'count' as const, remaining: 2, owner: 'target-turn' as const };
  const foes = context.getLivingUnits(victimSide);
  if (type === 1) {
    const commands: EffectCommand[] = [{ type: 'change-resource', source, side: victimSide, resourceId: 'fire', amount: -2, parentEventId }];
    if (full) commands.push({ type: 'change-resource-meter-cap', source, side: victimSide, resourceId: 'fire', amount: -2, parentEventId });
    return commands;
  }
  if (type === 2) {
    if (!full) {
      const target = context.getLivingUnits(owner.side).slice().sort((a, b) => b.actionGauge - a.actionGauge)[0];
      return target ? [{ type: 'change-action-gauge', source, targetId: target.unitId, amount: -30, parentEventId }] : [];
    }
    return [
      ...foes.map(unit => ({ type: 'change-action-gauge' as const, source, targetId: unit.unitId, amount: -20, parentEventId })),
      ...context.getLivingUnits(owner.side).map(unit => ({ type: 'change-action-gauge' as const, source, targetId: unit.unitId, amount: 20, parentEventId })),
    ];
  }
  if (type === 3) {
    const ratio = full ? 2 : 1, hits: { target: Readonly<UnitState>; damage: number }[] = [];
    const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
    for (const target of foes) {
      const amount = attack * ratio;
      hits.push({ target, damage: amount });
    }
    const commands: EffectCommand[] = hits.map(hit => ({ type: 'deal-damage', source, targetId: hit.target.unitId,
      amount: hit.damage, damageKind: 'true', suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
      parentEventId }));
    if (full) {
      const healingEach = hits.reduce((sum, hit) => sum + hit.damage, 0) * .8 / Math.max(1, context.getLivingUnits(owner.side).length);
      for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'restore-health', source,
        targetId: ally.unitId, amount: healingEach, parentEventId });
    }
    return commands;
  }
  if (type === 4) {
    const targets = full ? foes : [marked];
    return targets.flatMap((unit, index) => attemptDebuff(context, { source, targetId: unit.unitId, statusId: ids.critDown,
      baseChance: 1, duration, parentEventId, modifiers: [{ stat: 'crit', operation: 'flat', amount: -(full && index === 0 ? 1 : .8) }] }));
  }
  if (type === 5) {
    const otherFoes = foes.filter(unit => unit.unitId !== marked.unitId).slice();
    for (let index = otherFoes.length - 1; index > 0; index--) {
      const swap = Math.floor(context.random() * (index + 1));
      [otherFoes[index], otherFoes[swap]] = [otherFoes[swap]!, otherFoes[index]!];
    }
    const targets = full ? [marked, ...otherFoes.slice(0, 3)] : [marked];
    return targets.flatMap(unit => attemptDebuff(context, { source, targetId: unit.unitId, statusId: ids.seal,
      baseChance: 1, duration, parentEventId, values: { sealPassives: true, sealSouls: true } }));
  }
  if (type === 6) {
    const targets = full ? [marked, ...foes.filter(unit => unit.unitId !== marked.unitId)] : [marked];
    return targets.flatMap((unit, index) => {
      const command = attemptControl(context, { attemptId: `${ids.confusion}:${owner.unitId}:${unit.unitId}:${parentEventId}:${index}`,
        source, targetId: unit.unitId, statusId: ids.confusion, controlType: '混乱',
        baseChance: full && index > 0 ? .6 : full ? 1 : .8,
        duration: { kind: 'count', remaining: full ? 2 : 1, owner: 'target-turn' }, parentEventId });
      return command ? [command] : [];
    });
  }
  if (type === 7) {
    const targets = full ? foes : [marked];
    const ratio = full ? .3 : .5;
    return targets.filter(unit => unit.hp > 0).map(unit => ({ type: 'reduce-max-health' as const, source,
      targetId: unit.unitId, amount: unit.stats.hp * ratio, minimumRatio: full ? .7 : .5,
      statusId: ids.maxHpDown, parentEventId }));
  }
  return [];
}

function resetSigil(context: BattleContext, owner: Readonly<UnitState>, marked: Readonly<UnitState>,
  mark: StatusInstance, parentEventId: string): EffectCommand[] {
  const commands: EffectCommand[] = [];
  commands.push({ type: 'add-status', source: mark.source, targetId: marked.unitId,
    parentEventId, instance: { ...mark, values: { ...mark.values, usedMask: 0, pendingType: 0, pendingFull: false } } });
  const targets = context.getLivingUnits(enemySide(owner.side));
  const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
  const count = rank(owner, yatoNoKamiIds.ultimate) >= 3 ? 7 : 3;
  for (let index = 0; index < count && targets.length; index++) {
    const victim = targets[Math.floor(context.random() * targets.length)]!;
    commands.push({ type: 'deal-damage', source: sourceFor(yatoNoKamiIds.ultimate, owner.unitId), targetId: victim.unitId,
      amount: attack * .77, damageKind: 'true', parentEventId });
    if (rank(owner, yatoNoKamiIds.ultimate) >= 4) commands.push({ type: 'change-action-gauge', source: sourceFor(yatoNoKamiIds.ultimate, owner.unitId),
      targetId: victim.unitId, amount: -20, parentEventId });
  }
  return commands;
}

function resolveTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (isYato(actor) && actor.hp > 0 && !context.isUnitUnableToAct(actor.unitId)) {
    if (passivesEnabled(actor) && actor.statuses.find(status => status.statusId === yatoNoKamiIds.dance)?.stacks === 7)
      return releaseDance(context, actor, event.eventId);
    const completed = context.getLivingUnits(enemySide(actor.side)).map(unit => ({ unit,
      mark: unit.statuses.find(status => status.statusId === yatoNoKamiIds.nightSigil
        && status.source.unitId === actor.unitId && Number(status.values?.usedMask ?? 0) === 127) }))
      .find(entry => entry.mark);
    if (completed?.mark) return resetSigil(context, actor, completed.unit, completed.mark, event.eventId);
  }
  return resolveSigilAtTurnStart(context, event);
}

function isFirstYato(state: import('../core/types').BattleState, owner: Readonly<UnitState>): boolean {
  return state.sides[owner.side].map(id => state.units[id]).find(unit => unit?.heroId === yatoNoKamiIds.hero)?.unitId === owner.unitId;
}
function isValidSigilTarget(target: Readonly<UnitState>): boolean {
  return target.hp > 0 && target.unitKind !== 'monster' && target.unitKind !== 'summon' && target.unitKind !== 'onmyoji'
    && !isUnitBanished(target);
}
