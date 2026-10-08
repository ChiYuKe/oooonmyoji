import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const shikagamiCityIds = { hero: 600, basic: '6001', stance: '6002', ultimate: '6003',
  unique: 'status.hero.600.unique', mercy: 'status.hero.600.mercy-blade', speed: 'status.hero.600.speed',
  flower: 'status.hero.600.flower-prayer', illusionFlower: 'status.hero.600.illusion-flower', resist: 'status.hero.600.compassion',
  guilt: 'status.hero.600.guilt-blade',
  trapped: 'status.hero.600.trapped-after-action', illusion: 'status.hero.600.illusion' } as const;

export function registerShikagamiCity(registry: ContentRegistry): void {
  registry.registerStatus({ id: shikagamiCityIds.unique, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: shikagamiCityIds.mercy, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: shikagamiCityIds.guilt, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: shikagamiCityIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: shikagamiCityIds.flower, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerStatus({ id: shikagamiCityIds.illusionFlower, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerStatus({ id: shikagamiCityIds.resist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: shikagamiCityIds.trapped, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: shikagamiCityIds.illusion, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration',
    modifyResourceCost(_state, _actor, skill, cost) { return skill.actionKind === 'skill' ? cost.amount + 3 : cost.amount; } });
  registry.registerHero(createShikagamiCityDefinition());
}

function createShikagamiCityDefinition(): HeroDefinition {
  const basicAttack = createBasicAttackSkill(shikagamiCityIds.basic, [1, 1.05, 1.1, 1.15, 1.2]);
  const basic: SkillDefinition = { ...basicAttack, execute(context, intent, parameters) {
    const commands = [...basicAttack.execute(context, intent, parameters)];
    const actor = context.getUnit(intent.actorId);
    if (actor && skillRank(actor, shikagamiCityIds.basic) >= 5) {
      const current = actor.statuses.find(status => status.statusId === shikagamiCityIds.flower);
      const source = { kind: 'skill' as const, id: shikagamiCityIds.basic, unitId: actor.unitId };
      const flowerSource = { kind: 'skill' as const, id: shikagamiCityIds.stance, unitId: actor.unitId };
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${shikagamiCityIds.flower}:${actor.unitId}`, statusId: shikagamiCityIds.flower, source: flowerSource,
        stacks: current && current.stacks >= 5 ? 0 : 1, duration: { kind: 'permanent' },
      } });
    }
    return commands;
  } };
  const stance: SkillDefinition = { id: shikagamiCityIds.stance, target: 'self', targetRelation: 'ally',
    levels: [{ turns: 2, speed: 100, flowers: 2 }, { turns: 2, speed: 100, flowers: 2 }, { turns: 2, speed: 100, flowers: 3 },
      { turns: 2, speed: 100, flowers: 3 }, { turns: 2, speed: 100, flowers: 3 }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const source = { kind: 'skill' as const, id: shikagamiCityIds.stance, unitId: actor.unitId };
      const flowers = actor.statuses.find(status => status.statusId === shikagamiCityIds.flower);
      const gainedFlowers = Math.min(5 - (flowers?.stacks ?? 0), Number(parameters.flowers ?? 2));
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${shikagamiCityIds.speed}:${actor.unitId}`,
        statusId: shikagamiCityIds.speed, source, stacks: 1, duration: { kind: 'count', remaining: Number(parameters.turns), owner: 'target-turn' },
        modifiers: [{ stat: 'speed', operation: 'flat', amount: Number(parameters.speed) }] } },
        { type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${shikagamiCityIds.flower}:${actor.unitId}`,
          statusId: shikagamiCityIds.flower, source, stacks: gainedFlowers, duration: { kind: 'permanent' } } }];
    } };
  const ultimate: SkillDefinition = { id: shikagamiCityIds.ultimate,
    resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(_state, actor) {
      const guiltBlade = actor.statuses.some(status => status.statusId === shikagamiCityIds.guilt);
      return { resourceId: 'fire', amount: skillRank(actor, shikagamiCityIds.ultimate) >= 2 && !guiltBlade ? 2 : 3 };
    },
    target: 'multi', levels: [1, 2, 3, 4, 5].map(skillLevel => ({ ratio: 1.3,
      flowers: skillLevel >= 4 ? 1 : 0, phantomFlowers: 2, damageRatio: 3.39,
      mazeBonus: skillLevel >= 3 ? .3 : 0,
      mazeDefenseIgnore: skillLevel >= 5 ? 150 : skillLevel >= 3 ? 50 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: shikagamiCityIds.ultimate, unitId: actor.unitId };
      const phantom = actor.statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower);
      const nextPhantom = Math.min(5, (phantom?.stacks ?? 0) + Number(parameters.phantomFlowers ?? 2));
      const guiltBlade = actor.statuses.some(status => status.statusId === shikagamiCityIds.guilt);
      const allies = context.getLivingUnits(actor.side);
      const commands: EffectCommand[] = [];
      if (guiltBlade) {
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        const designated = enemies.find(enemy => enemy.unitId === intent.targetIds[0]);
        const lowest = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
          - right.hp / Math.max(1, right.stats.hp) || left.unitId.localeCompare(right.unitId));
        const targets = [designated, ...lowest].filter((target, index, all): target is NonNullable<typeof target> =>
          Boolean(target && all.findIndex(candidate => candidate?.unitId === target.unitId) === index)).slice(0, 3);
        const actorStats = context.getEffectiveStats(actor.unitId);
        for (const target of targets) {
          const targetStats = context.getEffectiveStats(target.unitId);
          if (!actorStats || !targetStats) continue;
          const inMaze = target.statuses.some(status => status.statusId === shikagamiCityIds.illusion);
          const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor) + (inMaze ? Number(parameters.mazeDefenseIgnore ?? 0) : 0),
            ratio: Number(parameters.damageRatio ?? 3.39) * (inMaze ? 1 + Number(parameters.mazeBonus ?? 0) : 1),
            critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
            ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        }
      } else {
        const lowestThree = allies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
          - right.hp / Math.max(1, right.stats.hp)).slice(0, 3);
        commands.push(...lowestThree.map(ally => ({ type: 'heal' as const, source, targetId: ally.unitId,
          amount: actor.stats.attack * Number(parameters.ratio ?? 1.3) })));
        for (const ally of allies) commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
          instanceId: `${shikagamiCityIds.resist}:${actor.unitId}:${ally.unitId}`, statusId: shikagamiCityIds.resist, source,
          stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'resist', operation: 'flat', amount: .3 }] } });
      }
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${shikagamiCityIds.illusionFlower}:${actor.unitId}`, statusId: shikagamiCityIds.illusionFlower, source,
        stacks: Math.max(0, nextPhantom - (phantom?.stacks ?? 0)), duration: { kind: 'permanent' },
      } });
      if (!guiltBlade && nextPhantom >= 3) commands.push(...unlockGuiltBlade(actor, source));
      const flower = actor.statuses.find(status => status.statusId === shikagamiCityIds.flower);
      if (Number(parameters.flowers ?? 0) > 0) commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${shikagamiCityIds.flower}:${actor.unitId}`, statusId: shikagamiCityIds.flower,
        source: flower?.source ?? { kind: 'skill', id: shikagamiCityIds.stance, unitId: actor.unitId },
        stacks: Math.min(Number(parameters.flowers), 5 - (flower?.stacks ?? 0)), duration: { kind: 'permanent' } } });
      return commands;
    } };
  return { id: shikagamiCityIds.hero, skills: [basic, stance, ultimate], aiCoverage: 'partial',
    aiCoverageNotes: ['参考本地整理的社区 AI 规则：未持断罪之刃且已有垂悯速度增益时优先施放寂灭现前，即使友方满血也维持其效果命中率增益；没有速度增益时使用爱见舍离；普攻目标排序沿用低生命比例优先。官方 AI 序列与配对实战行为尚未核验'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['普攻、垂悯之刃与断罪之刃分别读取对应技能等级；被动回合结束增加1层幻花，累计3层解锁断罪之刃；大招三级起迷障增伤无视50防御，五级合计无视150；断罪形态目标选择优先级及虚妄迷障抵抗边界仍未完整迁移'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor) return [];
      const source = { kind: 'skill' as const, id: shikagamiCityIds.stance, unitId };
      const mercyModifiers = [{ stat: 'resist' as const, operation: 'flat' as const, amount: .6 },
        ...(skillRank(actor, shikagamiCityIds.stance) >= 2 ? [{ stat: 'defense' as const, operation: 'flat' as const,
          amount: actor.awakeFilter === 0 ? 300 : 450 }] : [])];
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: unitId, instance: { instanceId: `${shikagamiCityIds.unique}:${unitId}`,
        statusId: shikagamiCityIds.unique, source, stacks: 1, duration: { kind: 'permanent' } } },
      { type: 'add-status', source, targetId: unitId, instance: { instanceId: `${shikagamiCityIds.mercy}:${unitId}`,
        statusId: shikagamiCityIds.mercy, source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: mercyModifiers } }];
      if (skillRank(actor, shikagamiCityIds.stance) >= 5) commands.push({ type: 'add-status', source, targetId: unitId, instance: {
        instanceId: `${shikagamiCityIds.flower}:${unitId}`, statusId: shikagamiCityIds.flower, source, stacks: 2,
        duration: { kind: 'permanent' } } });
      return commands;
    },
    handlers: {
      'action-end': { priority: 105, handle: (context, event) => onCityActionEnd(context, event) },
      'turn-end': { priority: 105, handle: (context, event) => onCityTurnEnd(context, event) },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const availableFire = context.state.resources[actor.side]?.fire ?? 0;
      if (actor.statuses.some(status => status.statusId === shikagamiCityIds.guilt)) {
        return availableFire >= 3 ? lineupIntent(unitId, shikagamiCityIds.ultimate,
          [lowestHealthEnemy(context, actor)!.unitId], 'multi')
          : lineupIntent(unitId, shikagamiCityIds.basic, [lowestHealthEnemy(context, actor)!.unitId], 'single');
      }
      if (actor.statuses.some(status => status.statusId === shikagamiCityIds.speed))
        return availableFire >= (skillRank(actor, shikagamiCityIds.ultimate) >= 2 ? 2 : 3)
          ? lineupIntent(unitId, shikagamiCityIds.ultimate, context.getLivingUnits(actor.side).map(ally => ally.unitId), 'multi')
          : lineupIntent(unitId, shikagamiCityIds.basic, [lowestHealthEnemy(context, actor)!.unitId], 'single');
      return lineupIntent(unitId, shikagamiCityIds.stance, [unitId], 'self');
    },
  };
}

function onCityTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== shikagamiCityIds.hero || actor.hp <= 0 || !passivesEnabled(actor)
    || !actor.statuses.some(status => status.statusId === shikagamiCityIds.unique)) return;
  const current = actor.statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower);
  const nextStacks = Math.min(5, (current?.stacks ?? 0) + 1);
  const source = citySource(actor.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId,
    parentEventId: event.eventId, instance: stackStatusInstance(shikagamiCityIds.illusionFlower, actor.unitId, source,
      nextStacks - (current?.stacks ?? 0)) }];
  if (nextStacks >= 3 && !actor.statuses.some(status => status.statusId === shikagamiCityIds.guilt))
    commands.push(...unlockGuiltBlade(actor, source, event.eventId));
  return commands;
}

function onCityActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor) return;
  const commands: EffectCommand[] = [];
  const trapped = actor.statuses.filter(status => status.statusId === shikagamiCityIds.trapped);
  if (trapped.length > 0) {
    const mark = trapped[0]!;
    const ownerId = String(mark.values?.ownerUnitId ?? mark.source.unitId ?? '');
    const owner = context.getUnit(ownerId);
    commands.push({ type: 'remove-statuses', source: mark.source, targetId: actor.unitId,
      statusIds: [shikagamiCityIds.trapped], reason: 'consumed', parentEventId: event.eventId });
    if (event.actionKind === 'skill' && owner) commands.push({ type: 'add-status', source: citySource(owner.unitId),
      targetId: actor.unitId, parentEventId: event.eventId, instance: {
        instanceId: `${shikagamiCityIds.illusion}:${owner.unitId}:${actor.unitId}`, statusId: shikagamiCityIds.illusion,
        source: citySource(owner.unitId), stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        values: { ownerUnitId: owner.unitId }, modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.85 }],
      } });
  }

  if (event.scheduling && event.scheduling !== 'extra-turn' && actor.unitKind === 'shikigami') {
    const cityOwners = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
      .filter(unit => unit.heroId === shikagamiCityIds.hero
        && unit.statuses.some(status => status.statusId === shikagamiCityIds.unique));
    for (const owner of cityOwners) {
      if (!passivesEnabled(owner)) continue;
      const flower = owner.statuses.find(status => status.statusId === shikagamiCityIds.flower);
      if (!flower || flower.stacks <= 0) continue;
      const source = citySource(owner.unitId);
      commands.push(...flowerStackCommands(owner, flower, flower.stacks - 1, source, event.eventId));
      commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
        instance: stackStatusInstance(shikagamiCityIds.illusionFlower, owner.unitId, source, 1) });
      const phantom = owner.statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower);
      if ((phantom?.stacks ?? 0) + 1 >= 3 && !owner.statuses.some(status => status.statusId === shikagamiCityIds.guilt))
        commands.push(...unlockGuiltBlade(owner, source, event.eventId));
      commands.push({ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId,
        instance: { instanceId: `${shikagamiCityIds.trapped}:${owner.unitId}:${actor.unitId}`,
          statusId: shikagamiCityIds.trapped, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: owner.unitId } } });
    }
  }
  return commands.length ? commands : undefined;
}

function flowerStackCommands(owner: { unitId: string }, current: StatusInstance, stacks: number, source: SourceRef,
  parentEventId: string): EffectCommand[] {
  const remove: EffectCommand = { type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [shikagamiCityIds.flower], reason: 'consumed', parentEventId };
  return stacks > 0 ? [remove, {
    type: 'add-status', source, targetId: owner.unitId, parentEventId,
    instance: { ...current, stacks, source, duration: { kind: 'permanent' } },
  }] : [remove];
}

function stackStatusInstance(statusId: string, unitId: string, source: SourceRef, stacks: number): StatusInstance {
  return { instanceId: `${statusId}:${unitId}`, statusId, source, stacks, duration: { kind: 'permanent' } };
}

function citySource(unitId: string): SourceRef {
  return { kind: 'skill', id: shikagamiCityIds.stance, unitId };
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}

function unlockGuiltBlade(owner: UnitState, source: SourceRef, parentEventId?: string): EffectCommand[] {
  if (owner.statuses.some(status => status.statusId === shikagamiCityIds.guilt)) return [];
  return [
    { type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [shikagamiCityIds.mercy], reason: 'consumed',
      ...(parentEventId ? { parentEventId } : {}) },
    { type: 'add-status', source, targetId: owner.unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
      instanceId: `${shikagamiCityIds.guilt}:${owner.unitId}`, statusId: shikagamiCityIds.guilt, source, stacks: 1,
      duration: { kind: 'permanent' }, modifiers: [{ stat: 'crit', operation: 'flat', amount: .5 },
        ...(skillRank(owner, shikagamiCityIds.stance) >= 4 ? [{ stat: 'defenseIgnore' as const, operation: 'flat' as const, amount: 350 }] : [])],
    } },
  ];
}
