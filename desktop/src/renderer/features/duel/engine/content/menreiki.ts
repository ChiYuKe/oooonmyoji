import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDamageMultiplier, effectiveDefenseIgnore } from '../mechanics/stats';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import type { ContentRegistry } from './registry';

export const menreikiIds = {
  hero: 311,
  basic: '3111',
  passive: '3112',
  ultimate: '3113',
  whiteMask: 'status.hero.311.white-mask',
  goodMask: 'status.hero.311.good-mask',
  evilMask: 'status.hero.311.evil-mask',
  passiveStats: 'status.hero.311.passive-stats',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const goodGaugeByRank = [5, 5, 5, 5, 10] as const;
const goodResistByRank = [.1, .1, .2, .2, .2] as const;
const evilSpeedByRank = [10, 15, 15, 20, 20] as const;
const ultimateDamageByRank = [1.3, 1.4, 1.4, 1.5, 1.5] as const;
const ultimateGaugeByRank = [20, 20, 25, 25, 30] as const;
const maxFaceCount = 7;

export function registerMenreiki(registry: ContentRegistry): void {
  registry.registerStatus({ id: menreikiIds.whiteMask, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'refresh-duration',
    stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: menreikiIds.goodMask, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: menreikiIds.evilMask, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack',
    stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: menreikiIds.passiveStats, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' } satisfies StatusDefinition);
  registry.registerHero(createMenreikiDefinition());
}

export function createMenreikiDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: menreikiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== menreikiIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const rank = skillRank(actor, menreikiIds.basic);
      const source = menreikiSource(menreikiIds.basic, actor.unitId);
      return [{ type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${menreikiIds.whiteMask}:${actor.unitId}:${target.unitId}`,
        statusId: menreikiIds.whiteMask, source, stacks: 1, duration: { kind: 'permanent' },
        values: { damageRatio: Number(parameters.ratio ?? basicRatios[rank - 1]) },
      } }];
    },
  };
  const ultimate: SkillDefinition = {
    id: menreikiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy',
    levels: ultimateDamageByRank.map((damageRatio, index) => ({ damageRatio, gauge: ultimateGaugeByRank[index]!,
      perEvilMask: .1, cost: 3 })),
    resolveResourceCost(_state, actor) {
      const row = skillRow(actor, menreikiIds.ultimate);
      return { resourceId: 'fire', amount: Math.max(0, Math.floor(skillNumber(row, 'consumeVal') ?? 3)) };
    },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== menreikiIds.hero || actor.hp <= 0) return [];
      const rank = skillRank(actor, menreikiIds.ultimate);
      const source = menreikiSource(menreikiIds.ultimate, actor.unitId);
      const gauge = Number(parameters.gauge ?? ultimateGaugeByRank[rank - 1]);
      const damageRatio = Number(parameters.damageRatio ?? ultimateDamageByRank[rank - 1]);
      const perEvilMask = Number(parameters.perEvilMask ?? .1);
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const damageMultiplier = effectiveDamageMultiplier(actor, context.state.resources[actor.side]);
      const commands: EffectCommand[] = [];
      const alliedFaces = context.getLivingUnits(actor.side).filter(ally => hasMaskFrom(ally, menreikiIds.goodMask, actor.unitId));
      for (const ally of alliedFaces) commands.push({ type: 'change-action-gauge', source, targetId: ally.unitId,
        amount: gauge, parentEventId: undefined });
      const enemySide = oppositeSide(actor.side);
      for (const enemy of context.getLivingUnits(enemySide)) {
        const masks = enemy.statuses.filter(status => status.statusId === menreikiIds.evilMask && status.source.unitId === actor.unitId)
          .reduce((total, status) => total + status.stacks, 0);
        if (!masks) continue;
        const defense = context.getEffectiveStats(enemy.unitId) ?? enemy.stats;
        const hit = calculateIndirectDamage({ attack: offense.attack * damageMultiplier, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: damageRatio + masks * perEvilMask,
          critDamage: offense.critDamage }, context.random);
        commands.push({ type: 'lose-life', source, targetId: enemy.unitId, amount: hit.amount,
          lifeLossKind: 'indirect' });
      }
      for (const unitId of [...context.state.sides.blue, ...context.state.sides.red]) {
        const unit = context.getUnit(unitId);
        if (!unit) continue;
        const instances = unit.statuses.filter(status => (status.statusId === menreikiIds.goodMask
          || status.statusId === menreikiIds.evilMask) && status.source.unitId === actor.unitId).map(status => status.instanceId);
        if (instances.length) commands.push({ type: 'remove-status-instances', source, targetId: unit.unitId,
          instanceIds: instances, reason: 'consumed' });
      }
      const allies = context.getLivingUnits(actor.side).filter(ally => ally.unitId !== actor.unitId);
      const faceRecipients = allies.slice(0, maxFaceCount);
      for (const ally of faceRecipients) commands.push(makeMaskCommand(menreikiIds.goodMask, source, ally.unitId));
      let remaining = maxFaceCount - faceRecipients.length;
      const enemies = context.getLivingUnits(enemySide);
      while (remaining > 0 && enemies.length > 0) {
        const target = chooseEvilMaskTarget(context, enemies, actor.unitId);
        if (!target) break;
        commands.push(makeMaskCommand(menreikiIds.evilMask, source, target.unitId));
        remaining -= 1;
      }
      return commands;
    },
  };

  return {
    id: menreikiIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['3火时优先禁断之面，否则用注灵；官方自动选招权重与注灵目标排序尚未从录像完整提取。'],
    mechanicsCoverageNotes: ['已按客户端技能表接入注灵无即时伤害、目标下次回合开始造成100%至125%间接伤害；觉醒开场友方善面、善面友方行动后按被动等级推5%/10%行动条并转化给优先无恶面且生命比例较低的敌方；善恶面具分别提升面灵气抵抗/减伤和速度/伤害；禁断之面3火召回善面推20%/25%/30%、按恶面层数造成130%/140%/140%/150%/150%间接伤害，再重放7张面具。客户端帧抽样未见面灵气，开场觉醒判定、七张面具在不同阵容人数下的分配顺序、死亡/复活与封印时的印记边界待录像核对。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== menreikiIds.hero || owner.hp <= 0 || owner.awakeFilter !== 1) return [];
      const source = menreikiSource(menreikiIds.passive, owner.unitId);
      return context.getLivingUnits(owner.side).filter(ally => ally.unitId !== owner.unitId)
        .map(ally => makeMaskCommand(menreikiIds.goodMask, source, ally.unitId));
    },
    handlers: {
      'action-end': { priority: 61, handle(context, event) { return transformGoodMaskAfterAction(context, event); } },
      'turn-start': { priority: 61, handle(context, event) { return resolveWhiteMask(context, event); } },
      'effect-resolution': { priority: 61, handle(context, event) { return refreshPassiveStats(context, event); } },
      'unit-defeated': { priority: 61, handle(context, event) { return refreshAfterUnitStateChange(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== menreikiIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(oppositeSide(actor.side));
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      if (fire >= 3) return { actorId: unitId, skillId: menreikiIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = chooseBasicTarget(enemies, actor.unitId);
      return { actorId: unitId, skillId: menreikiIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function transformGoodMaskAfterAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const mask of actor.statuses.filter(status => status.statusId === menreikiIds.goodMask)) {
    const owner = mask.source.unitId ? context.getUnit(mask.source.unitId) : undefined;
    if (!owner || owner.hp <= 0 || owner.heroId !== menreikiIds.hero || owner.side !== actor.side || !passivesEnabled(owner)) continue;
    const enemies = context.getLivingUnits(oppositeSide(owner.side));
    if (!enemies.length) continue;
    const source = menreikiSource(menreikiIds.passive, owner.unitId);
    commands.push({ type: 'change-action-gauge', source, targetId: actor.unitId,
      amount: goodGauge(owner), parentEventId: event.eventId },
    { type: 'remove-status-instances', source, targetId: actor.unitId, instanceIds: [mask.instanceId],
      reason: 'consumed', parentEventId: event.eventId });
    const target = chooseEvilMaskTarget(context, enemies, owner.unitId);
    if (target) commands.push(makeMaskCommand(menreikiIds.evilMask, source, target.unitId, event.eventId));
  }
  return commands.length ? commands : undefined;
}

function resolveWhiteMask(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const mask of target.statuses.filter(status => status.statusId === menreikiIds.whiteMask)) {
    const owner = mask.source.unitId ? context.getUnit(mask.source.unitId) : undefined;
    const offense = owner && context.getEffectiveStats(owner.unitId);
    const defense = context.getEffectiveStats(target.unitId);
    if (!owner || !offense || !defense) continue;
    const ratio = Number(mask.values?.damageRatio ?? 1);
    const hit = calculateIndirectDamage({ attack: offense.attack * effectiveDamageMultiplier(owner),
      defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(owner), ratio, critDamage: offense.critDamage }, context.random);
    commands.push({ type: 'lose-life', source: mask.source, targetId: target.unitId, amount: hit.amount,
      lifeLossKind: 'indirect', parentEventId: event.eventId });
    commands.push({ type: 'remove-status-instances', source: mask.source, targetId: target.unitId,
      instanceIds: [mask.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function refreshPassiveStats(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'status-added' && !isMaskOrSeal(event.instance.statusId)) return;
  if ((event.type === 'status-removed' || event.type === 'status-stacks-changed')
    && !isMaskOrSeal(event.statusId ?? '')) return;
  if (!['status-added', 'status-removed', 'status-stacks-changed', 'unit-revived'].includes(event.type)) return;
  return Object.values(context.state.units).filter(unit => unit.heroId === menreikiIds.hero)
    .flatMap(owner => syncPassiveStats(context, owner));
}

function refreshAfterUnitStateChange(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  return Object.values(context.state.units).filter(unit => unit.heroId === menreikiIds.hero)
    .flatMap(owner => syncPassiveStats(context, owner));
}

function syncPassiveStats(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  const existing = owner.statuses.find(status => status.statusId === menreikiIds.passiveStats
    && status.source.unitId === owner.unitId);
  const enabled = passivesEnabled(owner);
  const goodCount = enabled ? countMasks(context, owner, menreikiIds.goodMask, owner.side) : 0;
  const evilCount = enabled ? countMasks(context, owner, menreikiIds.evilMask, oppositeSide(owner.side)) : 0;
  const rank = skillRank(owner, menreikiIds.passive);
  const goodResist = goodCount * goodResistByRank[rank - 1]!;
  const evilSpeed = evilCount * evilSpeedByRank[rank - 1]!;
  const evilDamage = evilCount * .1;
  const goodDamageReduction = goodCount * .1;
  if (existing && Number(existing.values?.goodCount ?? -1) === goodCount
    && Number(existing.values?.evilCount ?? -1) === evilCount
    && Number(existing.values?.rank ?? -1) === rank) return [];
  const commands: EffectCommand[] = [];
  if (existing) commands.push({ type: 'remove-status-instances', source: menreikiSource(menreikiIds.passive, owner.unitId),
    targetId: owner.unitId, instanceIds: [existing.instanceId], reason: 'replaced' });
  if (!goodCount && !evilCount) return commands;
  const source = menreikiSource(menreikiIds.passive, owner.unitId);
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${menreikiIds.passiveStats}:${owner.unitId}`, statusId: menreikiIds.passiveStats, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { goodCount, evilCount, rank }, modifiers: [
      ...(goodResist ? [{ stat: 'resist' as const, operation: 'percent' as const, amount: goodResist }] : []),
      ...(evilSpeed ? [{ stat: 'speed' as const, operation: 'flat' as const, amount: evilSpeed }] : []),
      ...(evilDamage ? [{ stat: 'damage' as const, operation: 'percent' as const, amount: evilDamage }] : []),
      ...(goodDamageReduction ? [{ stat: 'damageTaken' as const, operation: 'percent' as const, amount: -goodDamageReduction }] : []),
    ],
  } });
  return commands;
}

function countMasks(context: BattleContext, owner: Readonly<UnitState>, statusId: string, side: UnitState['side']): number {
  return context.getLivingUnits(side).reduce((total, unit) => total + unit.statuses
    .filter(status => status.statusId === statusId && status.source.unitId === owner.unitId)
    .reduce((stacks, status) => stacks + status.stacks, 0), 0);
}

function chooseEvilMaskTarget(context: BattleContext, enemies: readonly UnitState[], ownerId: string): UnitState | undefined {
  const available = enemies.filter(enemy => enemy.hp > 0);
  if (!available.length) return undefined;
  const noMask = available.filter(enemy => !hasMaskFrom(enemy, menreikiIds.evilMask, ownerId));
  const pool = noMask.length ? noMask : available;
  const lowestRatio = Math.min(...pool.map(enemy => enemy.hp / Math.max(1, enemy.stats.hp)));
  const lowest = pool.filter(enemy => Math.abs(enemy.hp / Math.max(1, enemy.stats.hp) - lowestRatio) < 1e-9);
  return lowest[Math.floor(context.random() * lowest.length)]!;
}

function chooseBasicTarget(enemies: readonly UnitState[], ownerId: string): UnitState {
  const unmarked = enemies.filter(enemy => !hasMaskFrom(enemy, menreikiIds.whiteMask, ownerId));
  const pool = unmarked.length ? unmarked : enemies;
  return pool.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
    - right.hp / Math.max(1, right.stats.hp))[0]!;
}

function hasMaskFrom(unit: Readonly<UnitState>, statusId: string, ownerId: string | undefined): boolean {
  return unit.statuses.some(status => status.statusId === statusId && (ownerId === undefined || status.source.unitId === ownerId));
}

function makeMaskCommand(statusId: string, source: SourceRef, targetId: string, parentEventId?: string): EffectCommand {
  const instanceId = `${statusId}:${source.unitId}:${targetId}`;
  return { type: 'add-status', source, targetId, instance: { instanceId, statusId, source, stacks: 1,
    duration: { kind: 'permanent' } }, parentEventId };
}

function isMaskOrSeal(statusId: string): boolean {
  return statusId === menreikiIds.goodMask || statusId === menreikiIds.evilMask
    || statusId === 'core.passive-suppression';
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function skillRow(unit: Readonly<UnitState>, skillId: string) {
  return battleSkillRow(skillId, skillRank(unit, skillId), unit.awakeFilter);
}

function goodGauge(owner: Readonly<UnitState>): number {
  return skillNumber(skillRow(owner, menreikiIds.passive), 'param1') !== undefined
    ? skillNumber(skillRow(owner, menreikiIds.passive), 'param1')! * 100
    : goodGaugeByRank[skillRank(owner, menreikiIds.passive) - 1]!;
}

function oppositeSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function menreikiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
