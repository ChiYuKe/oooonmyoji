import type { DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const wisdomLampIds = {
  hero: 552,
  basic: '5521',
  passive: '5522',
  wisdomLamp: '5523',
  karma: 'status.hero.552.karma',
  light: 'status.hero.552.light-summoned',
  defenseAura: 'status.hero.552.light-defense',
  soulBind: 'status.hero.552.soul-bind',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const defenseByLevel = [.2, .3, .4, .4, .4] as const;
const cleanseByLevel = [0, 0, 0, 1, 2] as const;

export function registerWisdomLamp(registry: ContentRegistry): void {
  registry.registerStatus({ id: wisdomLampIds.karma, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3 });
  registry.registerStatus({ id: wisdomLampIds.light, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: wisdomLampIds.defenseAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: wisdomLampIds.soulBind, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createWisdomLampDefinition());
}

export function createWisdomLampDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(wisdomLampIds.basic, basicRatios);
  const invoke: SkillDefinition = {
    id: wisdomLampIds.wisdomLamp, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self', targetRelation: 'ally', levels: defenseByLevel.map((defense, index) => ({ defense, cleanse: cleanseByLevel[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return summonLamp(context, actor, Number(parameters.defense ?? .2), Number(parameters.cleanse ?? 0));
    },
  };

  return {
    id: wisdomLampIds.hero,
    skills: [basic, invoke],
    aiCoverage: 'verified', mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端5521/5522/5523实现普攻倍率、受击叠业障及每层降攻；明识灯在场、慧明灯未被封被动且可行动时，对敌方单体伤害有50%概率转移一半，并治疗慧明灯与生命比例最低的非召唤友方。明识灯提供防御光环、按技能等级驱散并对三层业障目标施加拘魂；慧明灯回合开始回收明识灯并清除其来源业障。回归覆盖受控不可分担、护盾吸收命中仍叠业障、召唤物过滤、转移/治疗、概率边界及回合清除'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: wisdomLampIds.wisdomLamp, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: wisdomLampIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, kind, context) {
      return interceptForWisdomLamp(state, attacker, target, amount, kind, context);
    },
    handlers: {
      hit: { priority: 34, handle(context, event) { return addKarmaAndBind(context, event); } },
      'turn-start': { priority: 34, handle(context, event) { return withdrawLamp(context, event); } },
      'unit-defeated': { priority: 34, handle(context, event) { return clearLamp(context, event); } },
    },
  };
}

function summonLamp(context: BattleContext, owner: Readonly<UnitState>, defense: number, cleanse: number): EffectCommand[] {
  const source = wisdomSource(wisdomLampIds.wisdomLamp, owner.unitId);
  const instanceId = `${wisdomLampIds.light}:${owner.unitId}`;
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId, statusId: wisdomLampIds.light, source, stacks: 1, duration: { kind: 'permanent' },
    values: { defenseRatio: defense },
  } }];
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitKind === 'summon') continue;
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
      instanceId: `${wisdomLampIds.defenseAura}:${owner.unitId}:${ally.unitId}`, statusId: wisdomLampIds.defenseAura,
      source, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'defense', operation: 'percent', amount: defense }],
    } });
    if (cleanse > 0) commands.push({ type: 'dispel-statuses', source, targetId: ally.unitId,
      maxCount: cleanse, filter: 'debuff-or-control' });
  }
  const prisonCommands = bindEligibleEnemies(context, owner, source, `invoke-${context.state.counters.action + 1}`);
  commands.push(...prisonCommands);
  return commands;
}

function interceptForWisdomLamp(state: Readonly<BattleState>, attacker: Readonly<UnitState> | undefined,
  target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true', context?: DamageInterceptionContext) {
  if (!attacker || attacker.side === target.side || target.heroId === wisdomLampIds.hero || amount <= 0
    || context?.attackShape !== 'single' || context.targetIds.length !== 1) return undefined;
  const lamp = state.sides[target.side].map(unitId => state.units[unitId]).find(unit => unit?.hp && unit.hp > 0
    && unit.heroId === wisdomLampIds.hero && unit.unitId !== target.unitId && unit.unitKind !== 'summon'
    && hasLight(unit) && passivesEnabled(unit));
  if (!lamp || context.isUnitUnableToAct(lamp.unitId) || context.battle.random() >= .5) return undefined;
  const passiveSource = wisdomSource(wisdomLampIds.passive, lamp.unitId);
  const redirectedSource = context.source ?? { kind: 'unit' as const, id: String(attacker.heroId), unitId: attacker.unitId };
  const allies = context.battle.getLivingUnits(lamp.side).filter(ally => ally.unitKind !== 'summon');
  const lowest = allies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
    - right.hp / Math.max(1, right.stats.hp))[0];
  const effects: EffectCommand[] = [{ type: 'deal-damage', source: redirectedSource, targetId: lamp.unitId,
    amount: amount * .5, damageKind: kind, countsAsHit: false, precalculated: true }];
  const healAmount = lamp.stats.hp * .06;
  effects.push({ type: 'heal', source: passiveSource, targetId: lamp.unitId, amount: healAmount });
  if (lowest) effects.push({ type: 'heal', source: passiveSource, targetId: lowest.unitId, amount: healAmount });
  return { amount: amount * .5, effects };
}

function addKarmaAndBind(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || !event.source.unitId) return;
  const target = context.getUnit(event.targetId);
  const attacker = context.getUnit(event.source.unitId);
  if (!target || target.heroId !== wisdomLampIds.hero || !attacker || attacker.side === target.side || !passivesEnabled(target)) return;
  const source = wisdomSource(wisdomLampIds.passive, target.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: attacker.unitId, instance: {
    instanceId: `${wisdomLampIds.karma}:${target.unitId}:${attacker.unitId}`, statusId: wisdomLampIds.karma,
    source, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'attack', operation: 'percent', amount: -.05, perStack: true }],
  }, parentEventId: event.eventId }];
  const currentStacks = attacker.statuses.find(status => status.statusId === wisdomLampIds.karma && status.source.unitId === target.unitId)?.stacks ?? 0;
  if (hasLight(target) && currentStacks >= 2) {
    const control = attemptControl(context, { attemptId: `${wisdomLampIds.soulBind}:${target.unitId}:${attacker.unitId}:${event.eventId}`,
      source, targetId: attacker.unitId, statusId: wisdomLampIds.soulBind, controlType: '拘魂', baseChance: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
      scopeId: `${wisdomLampIds.light}:${target.unitId}:${event.eventId}` });
    if (control) commands.push(control);
  }
  return commands;
}

function bindEligibleEnemies(context: BattleContext, owner: Readonly<UnitState>, source: SourceRef, eventId: string): EffectCommand[] {
  const commands: EffectCommand[] = [];
  for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) {
    const karma = enemy.statuses.find(status => status.statusId === wisdomLampIds.karma && status.source.unitId === owner.unitId);
    if (!karma || karma.stacks < 3) continue;
    const control = attemptControl(context, { attemptId: `${wisdomLampIds.soulBind}:${owner.unitId}:${enemy.unitId}:${eventId}`,
      source, targetId: enemy.unitId, statusId: wisdomLampIds.soulBind, controlType: '拘魂', baseChance: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: eventId,
      scopeId: `${wisdomLampIds.light}:${owner.unitId}:${eventId}` });
    if (control) commands.push(control);
  }
  return commands;
}

function withdrawLamp(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== wisdomLampIds.hero) return;
  const source = wisdomSource(wisdomLampIds.wisdomLamp, owner.unitId);
  const commands: EffectCommand[] = [];
  if (hasLight(owner)) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [wisdomLampIds.light], reason: 'consumed', parentEventId: event.eventId });
  for (const allyId of context.state.sides[owner.side]) {
    const ally = context.getUnit(allyId);
    if (!ally) continue;
    const auras = ally.statuses.filter(status => status.statusId === wisdomLampIds.defenseAura
      && status.source.unitId === owner.unitId).map(status => status.instanceId);
    if (auras.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId,
      instanceIds: auras, reason: 'consumed', parentEventId: event.eventId });
  }
  const enemySide = owner.side === 'blue' ? 'red' : 'blue';
  for (const enemyId of context.state.sides[enemySide]) {
    const enemy = context.getUnit(enemyId);
    if (!enemy) continue;
    const karma = enemy.statuses.filter(status => status.statusId === wisdomLampIds.karma && status.source.unitId === owner.unitId)
      .map(status => status.instanceId);
    if (karma.length) commands.push({ type: 'remove-status-instances', source, targetId: enemy.unitId,
      instanceIds: karma, reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function clearLamp(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== wisdomLampIds.hero) return;
  const source = wisdomSource(wisdomLampIds.wisdomLamp, owner.unitId);
  const commands: EffectCommand[] = [];
  for (const allyId of context.state.sides[owner.side]) {
    const ally = context.getUnit(allyId);
    if (!ally) continue;
    const auras = ally.statuses.filter(status => status.statusId === wisdomLampIds.defenseAura
      && status.source.unitId === owner.unitId).map(status => status.instanceId);
    if (auras.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId,
      instanceIds: auras, reason: 'expired', parentEventId: event.eventId });
  }
  return commands;
}

function hasLight(unit: Readonly<UnitState>): boolean { return unit.statuses.some(status => status.statusId === wisdomLampIds.light); }
function wisdomSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
