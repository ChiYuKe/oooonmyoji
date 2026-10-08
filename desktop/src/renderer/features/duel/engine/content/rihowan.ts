import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const rihefangIds = {
  hero: 297,
  basic: '2971',
  sunlight: '2972',
  nourish: '2973',
  energy: 'status.hero.297.energy',
  doll: 'status.hero.297.doll',
  dollCooldown: 'status.hero.297.doll-cooldown',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

export function registerRihefang(registry: ContentRegistry): void {
  registry.registerStatus({ id: rihefangIds.energy, mechanicsCoverage: 'partial', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', category: 'other' } satisfies StatusDefinition);
  registry.registerStatus({ id: rihefangIds.doll, mechanicsCoverage: 'partial', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', category: 'other' } satisfies StatusDefinition);
  registry.registerStatus({ id: rihefangIds.dollCooldown, mechanicsCoverage: 'partial', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', category: 'other' } satisfies StatusDefinition);

  const basic = createBasicAttackSkill(rihefangIds.basic, basicRatios);
  const sunlight: SkillDefinition = {
    id: rihefangIds.sunlight, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: Array.from({ length: 5 }, () => ({ damageRatio: .25, enemyHealRatio: .2, missingHpCap: .3 })),
    execute() { return []; },
  };
  const nourish: SkillDefinition = {
    id: rihefangIds.nourish, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [
      { storeRatio: .25, reviveHealRatio: 1, teamHealRatio: .5, cooldown: 4 },
      { storeRatio: .25, reviveHealRatio: 1, teamHealRatio: .5, cooldown: 4 },
      { storeRatio: .4, reviveHealRatio: 1, teamHealRatio: .5, cooldown: 4 },
      { storeRatio: .4, reviveHealRatio: 1, teamHealRatio: .5, cooldown: 4 },
      { storeRatio: .4, reviveHealRatio: 1, teamHealRatio: .75, cooldown: 3 },
    ],
    canUse(_state, actor) { return actor.heroId === rihefangIds.hero && actor.hp > 0 && hasDoll(actor); },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.heroId !== rihefangIds.hero || owner.hp <= 0 || !hasDoll(owner)) return [];
      return [setEnergy(owner, context, energy(owner, context) + owner.stats.hp * Number(parameters.storeRatio ?? .25), rihefangIds.nourish)];
    },
  };

  const definition: HeroDefinition = {
    id: rihefangIds.hero,
    skills: [basic, sunlight, nourish],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入阳炎等级倍率；晴天娃娃开局存在，友方式神造成伤害时积攒25%日光，觉醒时敌方治疗也积攒20%，上限为日和坊生命上限；敌方行动结束消耗日光治疗生命比例最低的非召唤友方，最多补其已损生命30%。滋养消耗2火，按技能等级增加25%/40%生命上限日光；友方阵亡时若被动有效且娃娃存在，牺牲娃娃复活随机阵亡友方并按技能等级分享部分剩余日光，娃娃在自身回合倒计时后重生。帧图没有日和坊出场证据；伤害统计口径、敌方治疗采能量的觉醒边界、多个日和坊同时触发、复活队列、日光消耗与治疗减益交互仍需连续帧核验。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== rihefangIds.hero || owner.hp <= 0 || owner.unitKind === 'summon') return [];
      const source = rihefangSource(rihefangIds.sunlight, owner.unitId);
      return [setEnergy(owner, context, 0, rihefangIds.sunlight),
        { type: 'add-status', source, targetId: owner.unitId, instance: dollStatus(owner, rihefangIds.sunlight) }];
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== rihefangIds.hero || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (hasDoll(owner) && energy(owner, context) < owner.stats.hp * .6 && (context.state.resources[owner.side]?.fire ?? 0) >= 2)
        return { actorId: unitId, skillId: rihefangIds.nourish, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      return { actorId: unitId, skillId: rihefangIds.basic, targetIds: [lowestRatio(enemies)!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 35, handle(context, event) { return collectSunlight(context, event); } },
      'effect-resolution': { priority: 35, handle(context, event) { return collectEnemyHealing(context, event); } },
      'turn-end': { priority: 35, handle(context, event) { return resolveTurnEnd(context, event); } },
      'unit-defeated': { priority: 35, handle(context, event) { return reviveWithDoll(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function collectSunlight(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || !event.source.unitId) return;
  const source = context.getUnit(event.source.unitId);
  if (!source || source.unitKind === 'summon') return;
  const owners = context.getLivingUnits(source.side).filter(unit => unit.heroId === rihefangIds.hero
    && passivesEnabled(unit) && hasDoll(unit));
  if (!owners.length) return;
  return owners.map(owner => setEnergy(owner, context,
    energy(owner, context) + event.hpLost * .25, rihefangIds.sunlight, event.eventId));
}

function collectEnemyHealing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'healing' || event.hpGained <= 0) return;
  const target = context.getUnit(event.targetId);
  if (!target) return;
  const owners = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === rihefangIds.hero && unit.awakeFilter === 1 && passivesEnabled(unit) && hasDoll(unit));
  if (!owners.length) return;
  return owners.map(owner => setEnergy(owner, context, energy(owner, context) + event.hpGained * .2,
    rihefangIds.sunlight, event.eventId));
}

function healLowestAlly(context: BattleContext, owners: readonly UnitState[], event: BattleEvent): EffectCommand[] | undefined {
  const candidates = context.getLivingUnits(owners[0]!.side).filter(unit => unit.unitKind !== 'summon');
  const target = lowestRatio(candidates);
  if (!target || target.hp >= target.stats.hp) return;
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const stored = energy(owner, context);
    const amount = Math.min(stored, Math.max(0, (target.stats.hp - target.hp) * .3));
    if (amount <= 0) continue;
    const source = rihefangSource(rihefangIds.sunlight, owner.unitId);
    commands.push(setEnergy(owner, context, stored - amount, rihefangIds.sunlight, event.eventId));
    commands.push({ type: 'heal', source, targetId: target.unitId, amount, parentEventId: event.eventId });
  }
  return commands;
}

function resolveTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ended = context.getUnit(event.unitId);
  if (!ended) return;
  const commands: EffectCommand[] = [];
  const enemyTurnOwners = context.getLivingUnits(ended.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === rihefangIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit) && hasDoll(unit));
  if (enemyTurnOwners.length) commands.push(...(healLowestAlly(context, enemyTurnOwners, event) ?? []));
  if (ended.heroId === rihefangIds.hero && ended.hp > 0) commands.push(...(tickDollCooldown(ended, event) ?? []));
  return commands.length ? commands : undefined;
}

function reviveWithDoll(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const fallen = context.getUnit(event.unitId);
  if (!fallen) return;
  const owners = context.getLivingUnits(fallen.side).filter(unit => unit.heroId === rihefangIds.hero
    && unit.unitKind !== 'summon' && passivesEnabled(unit) && hasDoll(unit));
  if (!owners.length) return;
  const owner = owners[Math.min(owners.length - 1, Math.floor(context.random() * owners.length))]!;
  const fallenAllies = context.state.sides[fallen.side].map(id => context.getUnit(id))
    .filter((unit): unit is UnitState => Boolean(unit && unit.hp <= 0 && unit.unitKind !== 'summon'));
  if (!fallenAllies.length) return;
  const target = fallenAllies[Math.min(fallenAllies.length - 1, Math.floor(context.random() * fallenAllies.length))]!;
  const rank = skillRank(owner, rihefangIds.nourish);
  const shareRatio = rank === 5 ? .75 : .5;
  const ref = rihefangSource(rihefangIds.nourish, owner.unitId);
  const commands: EffectCommand[] = [];
  const allOwners = context.getLivingUnits(fallen.side).filter(unit => unit.heroId === rihefangIds.hero && hasDoll(unit));
  for (const day of allOwners) {
    const dayRef = rihefangSource(rihefangIds.nourish, day.unitId);
    commands.push({ type: 'remove-statuses', source: dayRef, targetId: day.unitId, statusIds: [rihefangIds.doll], reason: 'consumed' });
    commands.push({ type: 'add-status', source: dayRef, targetId: day.unitId,
      instance: cooldownStatus(day, skillRank(day, rihefangIds.nourish) === 5 ? 3 : 4) });
  }
  commands.push({ type: 'revive', source: ref, targetId: target.unitId, hp: target.stats.hp });
  const share = energy(owner, context) * shareRatio;
  const recipients = context.state.sides[fallen.side].map(id => context.getUnit(id))
    .filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.unitKind !== 'summon' && unit.unitId !== target.unitId));
  const perAlly = recipients.length > 0 ? share / recipients.length : 0;
  for (const recipient of recipients) commands.push({ type: 'heal', source: ref, targetId: recipient.unitId, amount: perAlly, parentEventId: event.eventId });
  commands.push(setEnergy(owner, context, Math.max(0, energy(owner, context) - share), rihefangIds.nourish, event.eventId));
  return commands;
}

function tickDollCooldown(owner: UnitState, event: BattleEvent): EffectCommand[] | undefined {
  const cooldown = owner.statuses.find(status => status.statusId === rihefangIds.dollCooldown);
  if (!cooldown) return;
  const remaining = Math.max(0, Number(cooldown.values?.remaining ?? 4) - 1);
  const source = rihefangSource(rihefangIds.sunlight, owner.unitId);
  if (remaining > 0) return [{ type: 'add-status', source, targetId: owner.unitId,
    instance: { ...cooldown, values: { ...cooldown.values, remaining } }, parentEventId: event.eventId }];
  return [
    { type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [rihefangIds.dollCooldown], reason: 'consumed', parentEventId: event.eventId },
    { type: 'add-status', source, targetId: owner.unitId, instance: dollStatus(owner, rihefangIds.sunlight), parentEventId: event.eventId },
  ];
}

function setEnergy(owner: UnitState, context: BattleContext, requested: number, _skillId: string, parentEventId?: string): EffectCommand {
  const hp = (context.getEffectiveStats(owner.unitId) ?? owner.stats).hp;
  const source = rihefangSource(rihefangIds.sunlight, owner.unitId);
  return { type: 'add-status', source, targetId: owner.unitId,
    parentEventId, instance: { instanceId: `${rihefangIds.energy}:${owner.unitId}`, statusId: rihefangIds.energy,
      source, stacks: 1, duration: { kind: 'permanent' },
      values: { energy: Math.min(hp, Math.max(0, requested)) } } };
}

function energy(owner: UnitState, _context: BattleContext): number {
  return Math.max(0, Number(owner.statuses.find(status => status.statusId === rihefangIds.energy)?.values?.energy ?? 0));
}

function dollStatus(owner: UnitState, skillId: string): StatusInstance {
  return { instanceId: `${rihefangIds.doll}:${owner.unitId}`, statusId: rihefangIds.doll,
    source: rihefangSource(skillId, owner.unitId), stacks: 1, duration: { kind: 'permanent' } };
}

function cooldownStatus(owner: UnitState, turns: number): StatusInstance {
  return { instanceId: `${rihefangIds.dollCooldown}:${owner.unitId}`, statusId: rihefangIds.dollCooldown,
    source: rihefangSource(rihefangIds.nourish, owner.unitId), stacks: 1, duration: { kind: 'permanent' }, values: { remaining: turns } };
}

function hasDoll(unit: UnitState): boolean { return unit.statuses.some(status => status.statusId === rihefangIds.doll); }
function skillRank(unit: UnitState, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function rihefangSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function lowestRatio<T extends UnitState>(units: readonly T[]): T | undefined {
  return [...units].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
