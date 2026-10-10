import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import { lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const fanShiIds = { hero: 370, basic: '3701', passive: '3702', ultimate: '3703', devour: '3704',
  reserve: 'status.hero.370.reserve-food', appetite: 'status.hero.370.appetite', speed: 'status.hero.370.speed-feast',
  firstHit: 'status.hero.370.devour-first-hit', controlRelease: 'status.hero.370.control-release',
  devourReady: 'status.hero.370.devour-ready' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const firstHitRatios = [1, 1.1, 1.2, 1.3, 1.5] as const;
const trueRatios = [.4, .4, .6, .6, .8] as const;
const randomHitRatio = .33;
const maxFood = 10;

export function registerFanShi(registry: ContentRegistry): void {
  const reserve: StatusDefinition = { id: fanShiIds.reserve, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: maxFood };
  const appetite: StatusDefinition = { id: fanShiIds.appetite, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  const speed: StatusDefinition = { id: fanShiIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  const firstHit: StatusDefinition = { id: fanShiIds.firstHit, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  const controlRelease: StatusDefinition = { id: fanShiIds.controlRelease, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  const devourReady: StatusDefinition = { id: fanShiIds.devourReady, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  for (const status of [reserve, appetite, speed, firstHit, controlRelease, devourReady]) registry.registerStatus(status);
  registry.registerHero(createFanShiDefinition());
}

function createFanShiDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(fanShiIds.basic, basicRatios);
  const meal: SkillDefinition = { id: fanShiIds.passive, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{ cost: 2 }],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId); if (!owner || owner.hp <= 0) return [];
      const commands: EffectCommand[] = [...gainFoodCommands(owner, 2, fanShiIds.passive)];
      const source = fanSource(fanShiIds.passive, owner.unitId);
      for (const ally of context.getLivingUnits(owner.side)) if (ally.unitId !== owner.unitId && ally.unitKind !== 'summon')
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${fanShiIds.speed}:${owner.unitId}:${ally.unitId}`,
          statusId: fanShiIds.speed, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }] } });
      commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${fanShiIds.appetite}:${owner.unitId}`,
        statusId: fanShiIds.appetite, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
      return commands;
    } };
  const ultimate: SkillDefinition = { id: fanShiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: firstHitRatios.map(ratio => ({ cost: 3, ratio, randomHitRatio, hitCount: 8 })),
    canUse(_state, actor) { return (reserveStatus(actor)?.stacks ?? 0) >= 6; },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !selected || selected.hp <= 0 || selected.side === owner.side
        || (reserveStatus(owner)?.stacks ?? 0) < 6) return [];
      const source = fanSource(fanShiIds.ultimate, owner.unitId);
      const enemies = context.getLivingUnits(selected.side).filter(unit => unit.hp > 0);
      const queue: StatusInstance = { instanceId: `${fanShiIds.firstHit}:${owner.unitId}`, statusId: fanShiIds.firstHit, source,
        stacks: 1, duration: { kind: 'permanent' }, values: { skillId: fanShiIds.ultimate, remainingHits: 8, trueRatio: 0 } };
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: queue },
        damageCommand(context, owner, selected, Number(parameters.ratio ?? firstHitRatios[skillRank(owner, fanShiIds.ultimate) - 1]!), source)];
      commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId,
        instanceId: `${fanShiIds.reserve}:${owner.unitId}`, amount: -4 });
      return commands;
    } };
  const devour: SkillDefinition = { id: fanShiIds.devour, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 0 },
    target: 'single', targetRelation: 'enemy', levels: firstHitRatios.map(ratio => ({ cost: 0, ratio, randomHitRatio, hitCount: 9 })),
    canUse(_state, actor) { return canDevour(actor); },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !selected || selected.hp <= 0 || selected.side === owner.side
        || !canDevour(owner)) return [];
      const current = reserveStatus(owner)?.stacks ?? 0;
      const source = fanSource(fanShiIds.devour, owner.unitId);
      const commands: EffectCommand[] = [];
      if (context.isUnitUnableToAct(owner.unitId)) {
        if (current < 10) return [];
        const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
        if (controls.length) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
          instanceIds: controls.map(status => status.instanceId), reason: 'consumed' });
      }
      commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${fanShiIds.firstHit}:${owner.unitId}`,
        statusId: fanShiIds.firstHit, source, stacks: 1, duration: { kind: 'permanent' },
        values: { skillId: fanShiIds.devour, remainingHits: 9, trueRatio: trueRatios[skillRank(owner, fanShiIds.ultimate) - 1]! } } });
      const enemies = context.getLivingUnits(selected.side).filter(unit => unit.hp > 0);
      commands.push(damageCommand(context, owner, selected, Number(parameters.ratio ?? firstHitRatios[skillRank(owner, fanShiIds.ultimate) - 1]!), source),
        { type: 'remove-statuses', source, targetId: owner.unitId,
          statusIds: [fanShiIds.reserve, fanShiIds.appetite, fanShiIds.controlRelease, fanShiIds.devourReady], reason: 'consumed' });
      return commands;
    } };
  return { id: fanShiIds.hero, skills: [basic, meal, ultimate, devour], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['社区AI整理标记优先使用2技能；缺少10点场饭笥帧，3技能与自动吞食天地的客户端AI优先级仍未核准。'],
    mechanicsCoverageNotes: ['已接入先机7层、每个符合条件的非召唤友方回合末加1层、主动2技能加2层/其他友方速度+30/食欲大增、每层攻击+10%暴伤+5%、6层解锁3火多段、10层免费吞食天地、控制时先消耗5层解控、吞食后的余粮消耗；多段随机目标按每次命中后的存活敌方重抽，首段真实伤害读取实际伤害。仍需帧核协战/被邀战门槛、额外回合是否计层、食欲计时、控制触发与御魂交互。'],
    handlers: {
      'battle-start': { priority: 24, handle(context, event) { return initializeFood(context, event); } },
      'turn-end': { priority: 24, handle(context, event) { return addTurnFood(context, event); } },
      'action-end': { priority: 24, handle(context, event) { return autoDevour(context, event); } },
      hit: { priority: 24, handle(context, event) { return continueFanShiAttack(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const reserve = reserveStatus(owner)?.stacks ?? 0;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 2)
        return { actorId: unitId, skillId: fanShiIds.passive, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const highestHp = enemies.slice().sort((a, b) => b.hp - a.hp)[0]!;
      if (reserve >= 6 && (context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return lineupIntent(unitId, fanShiIds.ultimate, [highestHp.unitId], 'single');
      const target = lowestHealthEnemy(context, owner)!;
      return lineupIntent(unitId, fanShiIds.basic, [target.unitId], 'single');
    },
  };
}

function initializeFood(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const owner = uniqueFanShi(context.state, side);
    if (owner && !reserveStatus(owner)) commands.push(...gainFoodCommands(owner, 7, fanShiIds.passive, event.eventId));
  }
  return commands.length ? commands : undefined;
}

function addTurnFood(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ended = context.getUnit(event.unitId); if (!ended || ended.hp <= 0 || ended.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const owner = uniqueFanShi(context.state, side);
    if (!owner || context.isUnitUnableToAct(owner.unitId)) continue;
    const isAllyEnd = ended.side === owner.side;
    const isEnemyEndDuringAppetite = ended.side !== owner.side && owner.statuses.some(status => status.statusId === fanShiIds.appetite);
    if (isAllyEnd || isEnemyEndDuringAppetite) {
      commands.push(...gainFoodCommands(owner, 1, fanShiIds.passive, event.eventId));
      if ((reserveStatus(owner)?.stacks ?? 0) >= maxFood - 1) commands.push(...scheduleDevour(context, owner, event.eventId, 1));
    }
  }
  return commands.length ? commands : undefined;
}

function autoDevour(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const owner = context.getUnit(event.intent.actorId);
  if ((event.skillId === fanShiIds.devour || event.skillId === fanShiIds.ultimate)
    && owner?.statuses.some(status => status.statusId === fanShiIds.firstHit))
    return [{ type: 'remove-statuses', source: fanSource(fanShiIds.devour, owner.unitId), targetId: owner.unitId,
      statusIds: [fanShiIds.firstHit], reason: 'consumed', parentEventId: event.eventId }];
  if (event.skillId !== fanShiIds.passive || !owner || owner.hp <= 0 || !passivesEnabled(owner)
    || uniqueFanShi(context.state, owner.side)?.unitId !== owner.unitId
    || (reserveStatus(owner)?.stacks ?? 0) < 10) return;
  return scheduleDevour(context, owner, event.eventId);
}

function scheduleDevour(context: BattleContext, owner: Readonly<UnitState>, parentEventId: string, pendingStacks = 0): EffectCommand[] {
  if ((reserveStatus(owner)?.stacks ?? 0) + pendingStacks < maxFood || !passivesEnabled(owner)
    || uniqueFanShi(context.state, owner.side)?.unitId !== owner.unitId) return [];
  const selected = highestHealthEnemy(context, owner); if (!selected) return [];
  const source = fanSource(fanShiIds.devour, owner.unitId);
  const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${fanShiIds.devourReady}:${owner.unitId}`, statusId: fanShiIds.devourReady, source, stacks: 1,
    duration: { kind: 'permanent' } }, parentEventId }];
  if (controls.length) commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId,
    instanceId: reserveStatus(owner)!.instanceId, amount: -5, parentEventId },
  { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${fanShiIds.controlRelease}:${owner.unitId}`,
    statusId: fanShiIds.controlRelease, source, stacks: 1, duration: { kind: 'permanent' } }, parentEventId },
  { type: 'remove-status-instances', source, targetId: owner.unitId, instanceIds: controls.map(status => status.instanceId),
    reason: 'consumed', parentEventId });
  commands.push({ type: 'schedule-action', source, scheduling: 'extra-action', freeCast: true,
    intent: { actorId: owner.unitId, skillId: fanShiIds.devour, targetIds: [selected.unitId], shape: 'single', targetRelation: 'enemy' },
    parentEventId });
  return commands;
}

function continueFanShiAttack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId); if (!owner) return;
  const marker = owner.statuses.find(status => status.statusId === fanShiIds.firstHit
    && status.values?.skillId === event.source.id && (event.source.id === fanShiIds.ultimate || event.source.id === fanShiIds.devour));
  if (!marker || event.damageKind !== 'normal') return;
  const remaining = Math.max(0, Number(marker.values?.remainingHits ?? 0));
  const source = marker.source;
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').filter(unit => unit.hp > 0);
  const commands: EffectCommand[] = [];
  if (remaining <= 0 || enemies.length === 0) {
    return [{ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [fanShiIds.firstHit],
      reason: 'consumed', parentEventId: event.eventId }];
  }
  const nextRemaining = remaining - 1;
  if (nextRemaining === 0) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [fanShiIds.firstHit], reason: 'consumed', parentEventId: event.eventId });
  else commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { ...marker, values: { ...marker.values, remainingHits: nextRemaining, trueRatio: 0 } } });
  if (event.source.id === fanShiIds.devour && Number(marker.values?.trueRatio ?? 0) > 0) {
    const splitTargets = enemies.filter(enemy => enemy.unitId !== event.targetId);
    const ratio = Math.max(0, Math.min(1, Number(marker.values?.trueRatio ?? .4)));
    const splitSource = fanSource(`${fanShiIds.devour}:split`, owner.unitId);
    for (const enemy of splitTargets) commands.push({ type: 'deal-damage', source: splitSource,
      targetId: enemy.unitId, amount: event.amount * ratio / splitTargets.length, damageKind: 'true', parentEventId: event.eventId });
  }
  const target = enemies[Math.floor(context.random() * enemies.length)];
  if (target) commands.push(damageCommand(context, owner, target, randomHitRatio, source));
  return commands;
}

function gainFoodCommands(owner: Readonly<UnitState>, amount: number, skillId: string, parentEventId?: string): EffectCommand[] {
  const current = reserveStatus(owner);
  const next = Math.min(maxFood, (current?.stacks ?? 0) + amount);
  if (next <= (current?.stacks ?? 0)) return [];
  const source = fanSource(skillId, owner.unitId);
  if (current) return [{ type: 'change-status-stacks', source, targetId: owner.unitId,
    instanceId: current.instanceId, amount: next - current.stacks, ...(parentEventId ? { parentEventId } : {}) }];
  const instance: StatusInstance = { instanceId: `${fanShiIds.reserve}:${owner.unitId}`, statusId: fanShiIds.reserve, source,
    stacks: next, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: .1, perStack: true },
      { stat: 'critDamage', operation: 'percent', amount: .05, perStack: true }] };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance, ...(parentEventId ? { parentEventId } : {}) }];
}

function damageCommand(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, source: SourceRef): EffectCommand {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(owner),
    ratio, critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense.critDamage) } : {}), isCritical: result.isCritical };
}

function reserveStatus(owner: Readonly<UnitState>): StatusInstance | undefined {
  return owner.statuses.find(status => status.statusId === fanShiIds.reserve);
}
function canDevour(owner: Readonly<UnitState>): boolean {
  return owner.statuses.some(status => status.statusId === fanShiIds.devourReady)
    && ((reserveStatus(owner)?.stacks ?? 0) >= 10
      || ((reserveStatus(owner)?.stacks ?? 0) >= 5 && owner.statuses.some(status => status.statusId === fanShiIds.controlRelease)));
}
function highestHealthEnemy(context: BattleContext, owner: Readonly<UnitState>): UnitState | undefined {
  return context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').slice().sort((a, b) => b.hp - a.hp)[0];
}
function uniqueFanShi(state: BattleState, side: UnitState['side']): UnitState | undefined {
  return state.sides[side].map(id => state.units[id]).find(unit => unit?.heroId === fanShiIds.hero && unit.hp > 0
    && unit.unitKind !== 'summon' && passivesEnabled(unit));
}
function skillRank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(6, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function fanSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
