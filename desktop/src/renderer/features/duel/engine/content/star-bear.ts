import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const starBearIds = {
  hero: 342, basic: '3421', passive: '3422', ultimate: '3423', extraBasic: '3424',
  confusion: 'status.hero.342.confusion', bowlMark: 'status.hero.342.bowl-mark',
  confusionImmunity: 'status.hero.342.confusion-immunity', nextBasicConfusion: 'status.hero.342.next-basic-confusion',
  cooldown: 'status.hero.342.ultimate-cooldown', dodgeAttack: 'status.hero.342.dodge-attack',
} as const;

const extraBasicChances = [.4, .5, .6, .8, 1] as const;
const dodgeChances = [.25, .3, .35, .4, .45] as const;
const ultimateConfusionChances = [.25, .28, .32, .36, .4] as const;

export function registerStarBear(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: starBearIds.confusion, mechanicsCoverage: 'partial', mechanicsCoverageNotes: ['控场会强制目标进行普攻；酒碗标记目标作为优先攻击目标。'],
      category: 'control', dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true },
    { id: starBearIds.bowlMark, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 },
    { id: starBearIds.confusionImmunity, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', controlImmunityTypes: ['混乱'] },
    { id: starBearIds.nextBasicConfusion, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: starBearIds.cooldown, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: starBearIds.dodgeAttack, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: starBearIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: extraBasicChances.map(extraBasicChance => ({ ratio: 1, extraBasicChance })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== starBearIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const commands = strike(context, actor, target, basic.id, Number(parameters.ratio ?? 1));
      const bonus = actor.statuses.find(status => status.statusId === starBearIds.nextBasicConfusion);
      if (bonus) {
        commands.unshift({ type: 'remove-status-instances', source: bonus.source, targetId: actor.unitId,
          instanceIds: [bonus.instanceId], reason: 'consumed' });
        const control = attemptControl(context, { attemptId: `${starBearIds.confusion}:bonus:${context.state.counters.action}:${target.unitId}`,
          source: starBearSource(starBearIds.ultimate, actor.unitId), targetId: target.unitId, statusId: starBearIds.confusion,
          controlType: '混乱', baseChance: .4, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (control) commands.push(control);
      }
      return commands;
    } };
  const passive: SkillDefinition = { id: starBearIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: dodgeChances.map((dodgeChance, index) => ({ dodgeChance, gaugeOnConfusionExpiry: index >= 4 ? 20 : 10 })),
    canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: starBearIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: ultimateConfusionChances.map(confusionChance => ({ confusionChance, markStacks: 5, bonusBasicChance: .4, cooldown: 2 })),
    canUse(_state, actor) { return actor.heroId === starBearIds.hero
      && !actor.statuses.some(status => status.statusId === starBearIds.cooldown); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== starBearIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const source = starBearSource(ultimate.id, actor.unitId), rankLevel = rank(actor, ultimate.id), commands: EffectCommand[] = [];
      const oldMark = target.statuses.find(status => status.statusId === starBearIds.bowlMark && status.source.unitId === actor.unitId);
      const stacks = Math.min(5, (oldMark?.stacks ?? 0) + Number(parameters.markStacks ?? 5));
      commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${starBearIds.bowlMark}:${actor.unitId}:${target.unitId}`, statusId: starBearIds.bowlMark, source,
        stacks, duration: { kind: 'permanent' }, values: { preferredTargetId: target.unitId, ownerUnitId: actor.unitId },
        modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: .2, condition: { actionKind: 'basic' } }],
      } });
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${starBearIds.nextBasicConfusion}:${actor.unitId}`, statusId: starBearIds.nextBasicConfusion,
        source, stacks: 1, duration: { kind: 'permanent' }, values: { chance: Number(parameters.bonusBasicChance ?? .4) },
      } });
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${starBearIds.cooldown}:${actor.unitId}`, statusId: starBearIds.cooldown,
        source, stacks: 1, duration: { kind: 'count', remaining: Number(parameters.cooldown ?? 2), owner: 'target-turn' },
      } });
      const chance = Number(parameters.confusionChance ?? ultimateConfusionChances[rankLevel - 1]!);
      for (const enemy of context.getLivingUnits(target.side)) {
        const applied = attemptControl(context, { attemptId: `${starBearIds.confusion}:ultimate:${context.state.counters.action}:${enemy.unitId}`,
          source, targetId: enemy.unitId, statusId: starBearIds.confusion, controlType: '混乱', baseChance: chance,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (applied?.type === 'apply-control') commands.push({ ...applied, instance: { ...applied.instance,
          values: { ...applied.instance.values, preferredTargetId: target.unitId } } });
        else if (applied) commands.push(applied);
      }
      return commands;
    } };

  const definition: HeroDefinition = {
    id: starBearIds.hero, skills: [basic, passive, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== starBearIds.hero || !passivesEnabled(actor)) return [];
      const source = starBearSource(passive.id, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${starBearIds.confusionImmunity}:${actor.unitId}`, statusId: starBearIds.confusionImmunity,
        source, stacks: 1, duration: { kind: 'permanent' },
      } }];
    },
    mechanicsCoverageNotes: ['按ID342客户端行接入听咱一言100%普攻；目标带混乱时按40%/50%/60%/80%/100%概率立即触发混乱者普攻。刀下留人使自身免疫混乱；受到单体普攻时在未被嘲讽且本次攻击首次判定时按25%至45%概率闪避，并使攻击者尝试混乱1回合；场上混乱移除时自身增加10点行动条，驱散混乱时增加20点。敌在酒碗处耗3火，对选中目标施加最多5层永久酒碗标记，全敌25%/28%/32%/36%/40%概率混乱1回合，并让下次普攻附加40%基础概率混乱。酒碗按状态行提高20%普攻承伤、成为施加者混乱目标的优先攻击对象，并在每次普攻行动中至多消耗一层；觉醒战斗描述另使标记目标被其友方普攻后，若生命比例低于攻击来源则反击攻击来源。10点场没有星熊童子；嘲讽交互、被动封印窗口及命中/抵抗仍需帧核。'],
    interceptIncomingDamage(state, attacker, target, amount, kind, interception): DamageInterception | undefined {
      if (!attacker || target.heroId !== starBearIds.hero || target.hp <= 0 || kind !== 'normal'
        || interception?.actionKind !== 'basic' || interception.attackShape !== 'single' || !passivesEnabled(target)
        || target.statuses.some(status => status.values?.controlType === '嘲讽')) return undefined;
      const marker = target.statuses.find(status => status.statusId === starBearIds.dodgeAttack);
      if (marker && Number(marker.values?.attackId) === interception.attackId) return undefined;
      const source = starBearSource(passive.id, target.unitId), rankLevel = rank(target, passive.id);
      const markCommand: EffectCommand = { type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${starBearIds.dodgeAttack}:${target.unitId}`, statusId: starBearIds.dodgeAttack, source,
        stacks: 1, duration: { kind: 'permanent' }, values: { attackId: interception.attackId },
      } };
      if (interception.battle.random() >= dodgeChances[rankLevel - 1]!) return { amount, effects: [markCommand] };
      const confusion = attemptControl(interception.battle, { attemptId: `${starBearIds.confusion}:dodge:${interception.attackId}`,
        source, targetId: attacker.unitId, statusId: starBearIds.confusion, controlType: '混乱', baseChance: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      return { amount: 0, effects: [markCommand, ...(confusion ? [confusion] : [])] };
    },
    handlers: {
      hit: { priority: 342, handle(context, event) { return resolveStarBearHit(context, event); } },
      'attack-end': { priority: 342, handle(context, event) { return clearDodgeWindow(context, event); } },
      'control-application': { priority: 342, handle(context, event) { return gaugeOnConfusionRemoved(context, event); } },
      'effect-resolution': { priority: 342, handle(context, event) { return gaugeOnConfusionRemoved(context, event); } },
      'status-expiration': { priority: 342, handle(context, event) { return gaugeOnConfusionRemoved(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== starBearIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      if (!actor.statuses.some(status => status.statusId === starBearIds.cooldown) && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const target = enemies.find(enemy => !enemy.statuses.some(status => status.statusId === starBearIds.bowlMark)) ?? enemies[0]!;
        return { actorId: unitId, skillId: ultimate.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const markedConfused = enemies.find(enemy => enemy.statuses.some(status => status.statusId === starBearIds.confusion)
        && enemy.statuses.some(status => status.statusId === starBearIds.bowlMark));
      const target = markedConfused ?? enemies[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function resolveStarBearHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands: EffectCommand[] = [];
  if (event.type === 'damage' && event.targetId) {
    const target = context.getUnit(event.targetId), attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
    const markers = target?.statuses.filter(status => status.statusId === starBearIds.bowlMark) ?? [];
    if (target && event.actionKind === 'basic') {
      const actionId = event.actionId ?? context.state.counters.action;
      for (const marker of markers) {
        if (Number(marker.values?.lastConsumedActionId ?? -1) === actionId || marker.stacks <= 0) continue;
        commands.push({ type: 'add-status', source: marker.source, targetId: target.unitId, parentEventId: event.eventId,
          instance: { ...marker, values: { ...marker.values, lastConsumedActionId: actionId } } },
        { type: 'change-status-stacks', source: marker.source, targetId: target.unitId, instanceId: marker.instanceId,
          amount: -1, parentEventId: event.eventId });
      }
    }
    if (target && attacker && attacker.hp > 0 && target.hp > 0 && attacker.side === target.side
      && event.actionKind === 'basic' && target.hp / Math.max(1, target.stats.hp) < attacker.hp / Math.max(1, attacker.stats.hp)) {
      const marker = markers.find(status => status.source.unitId && context.getUnit(status.source.unitId)?.side !== target.side);
      if (marker) commands.push(...scheduleBowlCounter(context, marker, target, attacker, event.eventId));
    }
    if (attacker?.heroId === starBearIds.hero && event.source.id === starBearIds.basic
      && target?.statuses.some(status => status.statusId === starBearIds.confusion)
      && context.random() < extraBasicChances[rank(attacker, starBearIds.basic) - 1]!) {
      const followup = confusedAttack(context, target);
      if (followup) commands.push(followup);
    }
  }
  if (event.type === 'status-removed' && event.statusId === starBearIds.confusion) commands.push(...gaugeOnConfusionRemoved(context, event) ?? []);
  return commands.length ? commands : undefined;
}

function gaugeOnConfusionRemoved(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== starBearIds.confusion) return;
  const removedControl = event.removedValues?.controlType;
  if (removedControl !== undefined && removedControl !== '混乱') return;
  const removedByDispel = event.reason === 'dispelled';
  const units = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === starBearIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit));
  return units.map(owner => ({ type: 'change-action-gauge' as const, source: starBearSource(starBearIds.passive, owner.unitId),
    targetId: owner.unitId, amount: removedByDispel ? 20 : 10, parentEventId: event.eventId }));
}

function clearDodgeWindow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended') return;
  const commands: EffectCommand[] = [];
  for (const unit of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]) {
    const marker = unit.statuses.find(status => status.statusId === starBearIds.dodgeAttack
      && Number(status.values?.attackId) === event.attackId);
    if (marker) commands.push({ type: 'remove-status-instances', source: marker.source, targetId: unit.unitId,
      instanceIds: [marker.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function confusedAttack(context: BattleContext, confused: Readonly<UnitState>): EffectCommand | undefined {
  const candidates = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.unitId !== confused.unitId && unit.hp > 0);
  if (!candidates.length) return;
  const target = candidates[Math.floor(context.random() * candidates.length)]!;
  const offense = context.getEffectiveStats(confused.unitId) ?? confused.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(confused),
    ratio: 1, critChance: offense.crit, critDamage: offense.critDamage }, confused as UnitState, target as UnitState);
  return { type: 'schedule-attack', source: { kind: 'skill', id: starBearIds.extraBasic, unitId: confused.unitId },
    intent: { actorId: confused.unitId, skillId: starBearIds.extraBasic, targetIds: [target.unitId], shape: 'single',
      targetRelation: target.side === confused.side ? 'ally' : 'enemy', kind: 'basic' }, scheduling: 'counter',
    hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
      isCritical: hit.isCritical } ] };
}

function scheduleBowlCounter(context: BattleContext, marker: StatusInstance, actor: Readonly<UnitState>, target: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio: 1, critChance: offense.crit, critDamage: offense.critDamage },
  actor as UnitState, target as UnitState);
  return [{ type: 'schedule-attack', source: marker.source, parentEventId, scheduling: 'counter',
    intent: { actorId: actor.unitId, skillId: starBearIds.basic, targetIds: [target.unitId], shape: 'single',
      targetRelation: 'ally', kind: 'basic' },
    hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
      isCritical: hit.isCritical }] }];
}

function strike(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: starBearSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function starBearSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
