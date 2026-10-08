import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kawaArakawaIds = {
  hero: 334,
  basic: '3341',
  furySkill: '3342',
  slash: '3343',
  spiritWave: '3342-spirit-wave',
  seaFury: 'status.hero.334.sea-fury',
  furyThree: 'status.hero.334.fury-three',
  unflinching: 'status.hero.334.unflinching',
  spirit: 'status.hero.334.spirit',
  turnTrigger: 'status.hero.334.turn-trigger',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const slashRatios = [2.87, 3.15, 3.15, 3.35, 3.35] as const;

export function registerKawaArakawa(registry: ContentRegistry): void {
  registry.registerStatus({ id: kawaArakawaIds.seaFury, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3,
  });
  registry.registerStatus({ id: kawaArakawaIds.furyThree, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
  });
  registry.registerStatus({ id: kawaArakawaIds.unflinching, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kawaArakawaIds.spirit, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsRevive: true });
  registry.registerStatus({ id: kawaArakawaIds.turnTrigger, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createDefinition());
}

function createDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: kawaArakawaIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: false, levels: basicRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isKawaArakawa(actor) && actor.hp > 0; },
    execute(context, intent, parameters) { return directAttack(context, intent, Number(parameters.ratio ?? 1), kawaArakawaIds.basic); } };
  const furySkill: SkillDefinition = { id: kawaArakawaIds.furySkill, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    resourceCost: { resourceId: 'fire', amount: 0 }, levels: [{ level: 1 }],
    canUse(_state, actor) { return isKawaArakawa(actor) && actor.hp > 0; },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return [...addFury(actor, skillLevel(actor, kawaArakawaIds.furySkill)), ...grantUnflinching(context, actor, 1)];
    } };
  const slash: SkillDefinition = { id: kawaArakawaIds.slash, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, useClientDamageData: false,
    levels: slashRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isKawaArakawa(actor) && actor.hp > 0; },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const commands = directAttack(context, intent, Number(parameters.ratio ?? 2.87), kawaArakawaIds.slash,
        skillLevel(owner, kawaArakawaIds.slash) >= 3);
      if (skillLevel(owner, kawaArakawaIds.slash) >= 5) commands.push(...grantUnflinching(context, owner, 1));
      return commands;
    } };
  const spiritWave: SkillDefinition = { id: kawaArakawaIds.spiritWave, actionKind: 'passive', target: 'all-enemies',
    targetRelation: 'enemy', resourceCost: { resourceId: 'fire', amount: 0 }, useClientDamageData: false,
    levels: [{ ratio: .2 }],
    canUse(_state, actor) { return isKawaArakawa(actor) && actor.hp <= 0 && isSpirit(actor); },
    execute(context, intent) { return resolveSpiritWave(context, intent); } };
  return {
    id: kawaArakawaIds.hero,
    skills: [basic, furySkill, slash, spiritWave],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入普攻等级倍率、川怒施放叠加海怒并给队友减伤、任一友方单次受伤超过生命上限30%时每回合一次拉条50%/解控/叠怒、骁浪海作斩3火与击杀减怒、三级起孤立（不可分担/转移）、五级三层增伤与降防和施放后减伤、阵亡后保留为不可复活且继续行动的灵魂、阵亡治疗/全队常驻减伤及海浪振动。减伤堆叠方式、驱散免疫边界、孤立与特定分摊机制、死亡灵魂的回合插入及御魂联动仍需实战帧校准；此式神不在10点场阵容中。'],
    handlers: {
      hit: { priority: 44, handle(context, event) { return triggerHeavyHitPassive(context, event); } },
      'unit-defeated': { priority: 44, handle(context, event) { return onUnitDefeated(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      if (!enemies.length) return undefined;
      if (actor.hp <= 0 && isSpirit(actor)) return { actorId: unitId, skillId: kawaArakawaIds.spiritWave,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      if (actor.hp <= 0) return undefined;
      const fury = findStatus(actor, kawaArakawaIds.seaFury)?.stacks ?? 0;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fury >= 3 && fire >= 3) return { actorId: unitId, skillId: kawaArakawaIds.slash,
        targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      if (fury < 3) return { actorId: unitId, skillId: kawaArakawaIds.furySkill,
        targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      if (fire >= 3) return { actorId: unitId, skillId: kawaArakawaIds.slash,
        targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: kawaArakawaIds.basic,
        targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function directAttack(context: BattleContext, intent: ActionIntent, ratio: number, skillId: string, isolated = false): EffectCommand[] {
  const actor = context.getUnit(intent.actorId);
  const target = context.getUnit(intent.targetIds[0] ?? '');
  if (!actor || !target || target.hp <= 0) return [];
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: kawaSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}),
    ...(isolated ? { cannotBeShared: true } : {}) }];
}

function triggerHeavyHitPassive(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0) return;
  const victim = context.getUnit(event.targetId);
  if (!victim || event.amount <= victim.stats.hp * .3) return;
  const owner = context.state.sides[victim.side].map(id => context.getUnit(id)).find(unit => unit && isKawaArakawa(unit)
    && (unit.hp > 0 || isSpirit(unit)));
  if (!owner || !passivesEnabled(owner)) return;
  const previousTrigger = findStatus(owner, kawaArakawaIds.turnTrigger);
  if (Number(previousTrigger?.values?.round) === context.state.counters.round) return;
  const markerSource = kawaSource(kawaArakawaIds.furySkill, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source: markerSource, targetId: owner.unitId, instance: {
    instanceId: `${kawaArakawaIds.turnTrigger}:${owner.unitId}`, statusId: kawaArakawaIds.turnTrigger,
    source: markerSource, stacks: 1, duration: { kind: 'permanent' }, values: { round: context.state.counters.round },
  } },
  { type: 'change-action-gauge', source: markerSource, targetId: victim.unitId, amount: 50, parentEventId: event.eventId },
  ...addFury(owner, skillLevel(owner, kawaArakawaIds.furySkill), event.eventId)];
  const control = victim.statuses.find(status => context.getStatusCategory(status.statusId) === 'control'
    || status.values?.controlType !== undefined);
  if (control) commands.push({ type: 'remove-status-instances', source: markerSource, targetId: victim.unitId,
    instanceIds: [control.instanceId], reason: 'consumed', parentEventId: event.eventId });
  return commands;
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeatedBy = event.defeatedBy;
  if (defeatedBy?.id === kawaArakawaIds.slash && defeatedBy.unitId) {
    const attacker = context.getUnit(defeatedBy.unitId);
    if (attacker && isKawaArakawa(attacker)) return loseFury(attacker, event.eventId);
  }
  const owner = context.getUnit(event.unitId);
  if (!owner || !isKawaArakawa(owner) || isSpirit(owner) || !passivesEnabled(owner)) return;
  const rank = skillLevel(owner, kawaArakawaIds.furySkill);
  const source = kawaSource(kawaArakawaIds.furySkill, owner.unitId);
  const standing = standingReduction(context, owner, source, 'death');
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${kawaArakawaIds.spirit}:${owner.unitId}`, statusId: kawaArakawaIds.spirit,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { fightingSpirit: true, waveCount: 0 },
  } }];
  if (rank < 3) {
    const fury = findStatus(owner, kawaArakawaIds.seaFury);
    if (fury) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
      instanceIds: [fury.instanceId], reason: 'expired', parentEventId: event.eventId });
    commands.push({ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [kawaArakawaIds.furyThree], reason: 'expired', parentEventId: event.eventId });
  }
  for (const allyId of context.state.sides[owner.side]) {
    const ally = context.getUnit(allyId);
    if (!ally || ally.unitId === owner.unitId) continue;
    commands.push({ type: 'add-status', source, targetId: ally.unitId,
      instance: { ...standing, instanceId: `${standing.instanceId}:${ally.unitId}` }, parentEventId: event.eventId });
    if (rank >= 4 && ally.hp > 0) commands.push({ type: 'heal', source, targetId: ally.unitId,
      amount: owner.stats.attack * 1.25, parentEventId: event.eventId });
  }
  return commands;
}

function resolveSpiritWave(context: BattleContext, intent: ActionIntent): EffectCommand[] {
  const owner = context.getUnit(intent.actorId);
  if (!owner || !isSpirit(owner)) return [];
  const spirit = findStatus(owner, kawaArakawaIds.spirit)!;
  const rank = skillLevel(owner, kawaArakawaIds.furySkill);
  const alliesInitialAttack = context.state.sides[owner.side].map(id => context.getUnit(id))
    .filter((unit): unit is UnitState => Boolean(unit && unit.unitKind !== 'summon'))
    .reduce((sum, ally) => sum + ally.stats.attack, 0);
  const wavesSoFar = Math.max(0, Number(spirit.values?.waveCount ?? 0));
  const baseRatio = rank >= 2 ? .22 : .2;
  const coefficient = rank >= 5 ? baseRatio * 1.2 ** Math.min(5, wavesSoFar) : baseRatio;
  const amount = Math.min(alliesInitialAttack * coefficient, owner.stats.attack * 1.2);
  const source = kawaSource(kawaArakawaIds.spiritWave, owner.unitId);
  const commands: EffectCommand[] = [];
  for (const targetId of intent.targetIds) {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0) continue;
    commands.push({ type: 'deal-damage', source, targetId, amount, suppressSoulTriggers: true,
      suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true });
  }
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { ...spirit,
    values: { ...spirit.values, fightingSpirit: true, waveCount: Math.min(5, wavesSoFar + 1) } } });
  return commands;
}

function addFury(owner: Readonly<UnitState>, rank: number, parentEventId?: string): EffectCommand[] {
  const source = kawaSource(kawaArakawaIds.furySkill, owner.unitId);
  const current = findStatus(owner, kawaArakawaIds.seaFury);
  if ((current?.stacks ?? 0) >= 3) return [];
  const nextStacks = (current?.stacks ?? 0) + 1;
  const commands: EffectCommand[] = current
    ? [{ type: 'change-status-stacks', source, targetId: owner.unitId, instanceId: current.instanceId, amount: 1, parentEventId }]
    : [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${kawaArakawaIds.seaFury}:${owner.unitId}`,
      statusId: kawaArakawaIds.seaFury, source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: 30, perStack: true },
        { stat: 'damage', operation: 'percent', amount: .2, perStack: true }] }, parentEventId }];
  if (nextStacks === 3 && rank >= 5) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { instanceId: `${kawaArakawaIds.furyThree}:${owner.unitId}`, statusId: kawaArakawaIds.furyThree,
      source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'defense', operation: 'percent', amount: -.2 },
        { stat: 'damage', operation: 'percent', amount: .4 }] }, parentEventId });
  return commands;
}

function loseFury(owner: Readonly<UnitState>, parentEventId?: string): EffectCommand[] {
  const fury = findStatus(owner, kawaArakawaIds.seaFury);
  if (!fury) return [];
  const source = kawaSource(kawaArakawaIds.slash, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'change-status-stacks', source, targetId: owner.unitId,
    instanceId: fury.instanceId, amount: -1, parentEventId }];
  if (fury.stacks === 3) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [kawaArakawaIds.furyThree], reason: 'expired', parentEventId });
  return commands;
}

function grantUnflinching(context: BattleContext, owner: Readonly<UnitState>, duration: number): EffectCommand[] {
  const source = kawaSource(kawaArakawaIds.furySkill, owner.unitId);
  const instance = standingReduction(context, owner, source, 'active', duration);
  return context.state.sides[owner.side].map(unitId => context.getUnit(unitId)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0))
    .map(ally => ({ type: 'add-status' as const, source, targetId: ally.unitId, instance: { ...instance,
      instanceId: `${kawaArakawaIds.unflinching}:${owner.unitId}:${ally.unitId}` } }));
}

function standingReduction(context: BattleContext, owner: Readonly<UnitState>, source: SourceRef,
  kind: 'active' | 'death', duration = 1): StatusInstance {
  const teamAttack = context.state.sides[owner.side].map(id => context.getUnit(id))
    .filter((unit): unit is UnitState => Boolean(unit && unit.unitKind !== 'summon'))
    .reduce((sum, ally) => sum + ally.stats.attack, 0);
  const reduction = .1 + Math.min(.3, Math.floor(teamAttack / 300) * .01);
  return { instanceId: `${kawaArakawaIds.unflinching}:${owner.unitId}:${kind}`, statusId: kawaArakawaIds.unflinching,
    source, stacks: 1, duration: kind === 'death' ? { kind: 'permanent' } : { kind: 'count', remaining: duration, owner: 'target-turn' },
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -reduction }], values: { reduction, kind } };
}

function findStatus(unit: Readonly<UnitState>, statusId: string): StatusInstance | undefined {
  return unit.statuses.find(status => status.statusId === statusId);
}
function isKawaArakawa(unit: Readonly<UnitState>): boolean { return unit.heroId === kawaArakawaIds.hero && unit.unitKind !== 'summon'; }
function isSpirit(unit: Readonly<UnitState> | undefined): boolean {
  return Boolean(unit?.statuses.some(status => status.statusId === kawaArakawaIds.spirit && status.values?.fightingSpirit === true));
}
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function opposingSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function kawaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
