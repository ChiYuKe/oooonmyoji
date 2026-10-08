import type { DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleState, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const skullGeneralIds = {
  hero: 585,
  basic: '5851',
  flower: 'status.hero.585.blood-flower',
  ironWall: 'status.hero.585.ping-iron-wall',
  extraTurnUsed: 'status.hero.585.extra-turn-used',
  maxHpGrowth: 'status.hero.585.max-hp-growth',
  transfer: '5852',
  banner: '5853',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const secondHitRatios = [.2, .25, .25, .3, .3] as const;

/** 荒骷髅 migration. Damage sharing and several roster-specific effects remain partial. */
export function registerSkullGeneral(registry: ContentRegistry): void {
  registry.registerStatus({ id: skullGeneralIds.flower, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: skullGeneralIds.ironWall, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: skullGeneralIds.extraTurnUsed, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'keep' });
  registry.registerStatus({ id: skullGeneralIds.maxHpGrowth, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createSkullGeneralDefinition());
}

export function createSkullGeneralDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(skullGeneralIds.basic, basicRatios);
  const transfer: SkillDefinition = {
    id: skullGeneralIds.transfer, resourceCost: { resourceId: 'fire', amount: 2 }, target: 'single', targetRelation: 'ally',
    levels: [{}, {}, {}, {}, {}],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || target.side !== actor.side || target.unitId === actor.unitId
        || target.unitKind === 'summon') return [];
      const source = { kind: 'skill' as const, id: skullGeneralIds.transfer, unitId: actor.unitId };
      const commands: EffectCommand[] = [];
      for (const ally of context.state.sides[actor.side].map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit))) {
        if (ally.statuses.some(status => status.statusId === skullGeneralIds.flower)) commands.push({ type: 'remove-statuses', source,
          targetId: ally.unitId, statusIds: [skullGeneralIds.flower], reason: 'replaced' });
      }
      commands.push(addFlower(target, actor, skullGeneralIds.transfer));
      return commands;
    },
  };
  const banner: SkillDefinition = {
    id: skullGeneralIds.banner, resourceCost: { resourceId: 'fire', amount: 2 },
    resolveResourceCost(_state, actor, scheduling) {
      const rank = actor.skillLevels?.[skullGeneralIds.banner] ?? actor.skillLevel;
      return scheduling === 'extra-turn' && rank >= 3 ? { resourceId: 'fire', amount: 0 } : undefined;
    },
    target: 'single', targetRelation: 'enemy',
    levels: secondHitRatios.map((secondRatio, index) => ({ secondRatio, costRatio: index === 2 ? .3 : .3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target) return [];
      const maxHp = actor.stats.hp;
      const paid = Math.min(maxHp * Number(parameters.costRatio ?? .3), Math.max(0, actor.hp - 1));
      const totalLost = Number(actor.statuses.find(status => status.statusId === skullGeneralIds.ironWall)?.values?.totalLost ?? 0) + paid;
      const cap = actor.stats.attack * 12;
      const source = { kind: 'skill' as const, id: skullGeneralIds.banner, unitId: actor.unitId };
      const commands: EffectCommand[] = [];
      if (paid > 0) commands.push({ type: 'lose-life', source, targetId: actor.unitId, amount: paid });
      commands.push(wallCommand(actor, totalLost, Math.min(ironWallCap(actor),
        Number(actor.statuses.find(status => status.statusId === skullGeneralIds.ironWall)?.values?.shieldRemaining ?? 0) + paid), source));
      for (const ratio of [.08, Number(parameters.secondRatio ?? .2)]) {
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: Math.min(cap, totalLost * ratio), damageKind: 'true' });
      }
      return commands;
    },
  };
  return {
    id: skullGeneralIds.hero,
    skills: [basic, transfer, banner],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['血色之花开局给最高攻击友方式神、主动转移排除召唤物；花吻烈魂等级控制40%/45%/50%伤害分担、三级致命保护护盾及五级花持有者回合末时之隙；分担、致命保护和时之隙均校验被动封印，并绑定标记授予者。唯一被动只由本队顺位第一名存活且未封印的荒骷髅生效。平氏铁壁累计非黄泉战旗生命流失，储存量和承花者护盾均按荒骷髅初始生命上限50%封顶；五级黄泉战旗在敌方式神阵亡时按开战基础上限增加35%最大生命并恢复等量生命，召唤物不触发。回归覆盖技能等级、召唤目标、封印、镜像唯一归属、伤害分担、额外回合、成长结算和初始生命封顶；连续帧仍未清楚展示这些被动触发数值。'],
    initialize(context, unitId) {
      const skull = context.getUnit(unitId);
      if (!skull || !isUniqueSkull(context.state, unitId)) return [];
      const allies = context.getLivingUnits(skull.side);
      const bearer = [...allies].filter(ally => ally.unitKind !== 'summon'
        && (!ally.unitKind || ally.unitKind === 'shikigami')).sort((a, b) => (context.getEffectiveStats(b.unitId)?.attack ?? b.stats.attack)
        - (context.getEffectiveStats(a.unitId)?.attack ?? a.stats.attack) || a.unitId.localeCompare(b.unitId))[0];
      const growth = { instanceId: `${skullGeneralIds.maxHpGrowth}:${skull.unitId}`, statusId: skullGeneralIds.maxHpGrowth,
        source: { kind: 'status' as const, id: skullGeneralIds.maxHpGrowth, unitId: skull.unitId }, stacks: 1,
        duration: { kind: 'permanent' as const }, values: { baseMaxHp: skull.stats.hp, growthCount: 0 } };
      return [...(bearer ? [addFlower(bearer, skull, skullGeneralIds.flower)] : []),
        { type: 'add-status' as const, source: growth.source, targetId: skull.unitId, instance: growth }];
    },
    handlers: {
      'unit-defeated': { priority: 10, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const target = context.getUnit(event.unitId);
        if (!target) return;
        const commands: EffectCommand[] = [];
        if (!target.unitKind || target.unitKind === 'shikigami') {
          const enemySide = target.side === 'blue' ? 'red' : 'blue';
          for (const skull of context.getLivingUnits(enemySide).filter(unit => unit.heroId === skullGeneralIds.hero
            && isUniqueSkull(context.state, unit.unitId) && skillLevel(unit, skullGeneralIds.banner) >= 5)) {
            const tracker = skull.statuses.find(status => status.statusId === skullGeneralIds.maxHpGrowth);
            const baseMaxHp = Number(tracker?.values?.baseMaxHp ?? skull.stats.hp);
            const growthCount = Number(tracker?.values?.growthCount ?? 0) + 1;
            const source = { kind: 'status' as const, id: skullGeneralIds.maxHpGrowth, unitId: skull.unitId };
            commands.push({ type: 'increase-max-health', source, targetId: skull.unitId, amount: baseMaxHp * .35,
              parentEventId: event.eventId },
            { type: 'add-status', source, targetId: skull.unitId, parentEventId: event.eventId, instance: {
              instanceId: `${skullGeneralIds.maxHpGrowth}:${skull.unitId}`, statusId: skullGeneralIds.maxHpGrowth,
              source, stacks: 1, duration: { kind: 'permanent' }, values: { baseMaxHp, growthCount },
            } });
          }
        }
        if (target.heroId === skullGeneralIds.hero && isUniqueSkull(context.state, target.unitId)) {
          const lost = Number(target.statuses.find(status => status.statusId === skullGeneralIds.ironWall)?.values?.totalLost ?? 0);
          const shield = Math.min(ironWallCap(target), Number(target.statuses.find(status => status.statusId === skullGeneralIds.ironWall)?.values?.shieldRemaining ?? 0)
            + Math.max(0, target.hp));
          const source = { kind: 'status' as const, id: skullGeneralIds.ironWall, unitId: target.unitId };
          commands.push({ type: 'revive', source, targetId: target.unitId, hp: 1, parentEventId: event.eventId },
            wallCommand(target, lost + Math.max(0, target.hp), shield, source));
          return commands;
        }
        const flower = target.statuses.find(status => status.statusId === skullGeneralIds.flower);
        if (flower && Number(flower.values?.fatalProtectionUsed ?? 0) === 0) {
          const skull = flower.source.unitId ? context.getUnit(flower.source.unitId) : undefined;
          if (!skull || skull.side !== target.side || skull.heroId !== skullGeneralIds.hero || skull.hp <= 0
            || !isUniqueSkull(context.state, skull.unitId)) return commands.length ? commands : undefined;
          const source = { kind: 'status' as const, id: skullGeneralIds.flower, unitId: skull.unitId };
          const updatedFlower = { ...flower, values: { ...flower.values, fatalProtectionUsed: 1 } };
          const lost = Number(skull.statuses.find(status => status.statusId === skullGeneralIds.ironWall)?.values?.totalLost ?? 0);
          commands.push({ type: 'add-status', source, targetId: target.unitId, instance: updatedFlower },
            { type: 'revive', source, targetId: target.unitId, hp: 1, parentEventId: event.eventId });
          if (skillLevel(skull, skullGeneralIds.transfer) >= 3 && lost > 0) {
            commands.push(shieldCommand(target, Math.min(ironWallCap(skull), lost), source, event.eventId));
          }
          return commands;
        }
        return commands.length ? commands : undefined;
      } },
      'effect-resolution': { priority: 10, handle(context, event) {
        if (event.type !== 'life-lost') return;
        const target = context.getUnit(event.targetId);
        if (!target || target.heroId !== skullGeneralIds.hero || event.source.id === skullGeneralIds.banner
          || !isUniqueSkull(context.state, target.unitId)) return;
        const previous = target.statuses.find(status => status.statusId === skullGeneralIds.ironWall);
        const source = { kind: 'status' as const, id: skullGeneralIds.ironWall, unitId: target.unitId };
        const totalLost = Number(previous?.values?.totalLost ?? 0) + event.hpLost;
        const shieldRemaining = Math.min(ironWallCap(target), Number(previous?.values?.shieldRemaining ?? 0) + event.hpLost);
        return [wallCommand(target, totalLost, shieldRemaining, source)];
      } },
      'turn-start': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-started' || event.scheduling === 'extra-turn') return;
        const skull = context.getUnit(event.unitId);
        if (!skull || skull.heroId !== skullGeneralIds.hero) return;
        return [{ type: 'remove-statuses', source: { kind: 'status', id: skullGeneralIds.extraTurnUsed, unitId: skull.unitId },
          targetId: skull.unitId, statusIds: [skullGeneralIds.extraTurnUsed], reason: 'consumed', parentEventId: event.eventId }];
      } },
      'turn-end': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const bearer = context.getUnit(event.unitId);
        if (!bearer?.statuses.some(status => status.statusId === skullGeneralIds.flower)) return;
        const skull = context.state.sides[bearer.side].map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0
          && unit.heroId === skullGeneralIds.hero && skillLevel(unit, skullGeneralIds.transfer) >= 5
          && isUniqueSkull(context.state, unit.unitId)
          && !unit.statuses.some(status => status.statusId === skullGeneralIds.extraTurnUsed));
        if (!skull) return;
        const targets = context.getLivingUnits(skull.side === 'blue' ? 'red' : 'blue');
        if (targets.length === 0) return;
        const source = { kind: 'skill' as const, id: skullGeneralIds.transfer, unitId: skull.unitId };
        const used: StatusInstance = { instanceId: `${skullGeneralIds.extraTurnUsed}:${skull.unitId}`, statusId: skullGeneralIds.extraTurnUsed,
          source, stacks: 1, duration: { kind: 'permanent' } };
        const target = [...targets].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
        const intent: ActionIntent = { actorId: skull.unitId, skillId: skullGeneralIds.banner,
          targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
        return [{ type: 'add-status', source, targetId: skull.unitId, instance: used, parentEventId: event.eventId },
          { type: 'schedule-action', source, intent, scheduling: 'extra-turn', parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
      const highestAttackAlly = allies.slice().sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
        - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack))[0];
      const highestHasFlower = highestAttackAlly?.statuses.some(status => status.statusId === skullGeneralIds.flower);
      if (highestAttackAlly && !highestHasFlower && fire >= 2) {
        return { actorId: unitId, skillId: skullGeneralIds.transfer, targetIds: [highestAttackAlly.unitId], shape: 'single', targetRelation: 'ally' };
      }
      if (highestHasFlower && fire >= 2) {
        const target = [...enemies].sort((left, right) => right.hp / Math.max(1, right.stats.hp)
          - left.hp / Math.max(1, left.stats.hp))[0]!;
        return { actorId: unitId, skillId: skullGeneralIds.banner, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const target = [...enemies].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: skullGeneralIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception?: DamageInterceptionContext) {
      if (interception?.cannotBeShared || !attacker || attacker.side === target.side
        || !target.statuses.some(status => status.statusId === skullGeneralIds.flower)) return undefined;
      const flower = target.statuses.find(status => status.statusId === skullGeneralIds.flower)!;
      const skull = flower.source.unitId ? state.units[flower.source.unitId] : undefined;
      if (!skull || !isUniqueSkull(state, skull.unitId)) return undefined;
      if (skull.hp <= 0 || skull.side !== target.side || skull.unitId === target.unitId
        || skull.heroId !== skullGeneralIds.hero) return undefined;
      const rank = skillLevel(skull, skullGeneralIds.transfer);
      const ratio = rank >= 4 ? .5 : rank >= 2 ? .45 : .4;
      const sharedLifeLoss = Math.min(amount * ratio, Math.max(0, skull.hp - 1));
      if (sharedLifeLoss <= 0) return undefined;
      const source = { kind: 'status' as const, id: skullGeneralIds.flower, unitId: skull.unitId };
      return { amount: amount - sharedLifeLoss, effects: [{ type: 'lose-life' as const, source,
        targetId: skull.unitId, amount: sharedLifeLoss }] };
    },
  };
}

function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

/** Only the first living, non-summoned, unsuppressed same-name unit owns the unique passive. */
function isUniqueSkull(state: Readonly<BattleState>, unitId: string): boolean {
  const unit = state.units[unitId];
  if (!unit || unit.heroId !== skullGeneralIds.hero || unit.unitKind === 'summon'
    || !passivesEnabled(unit)) return false;
  const owner = state.sides[unit.side].map(id => state.units[id]).find(candidate => candidate
    && candidate.heroId === skullGeneralIds.hero && candidate.unitKind !== 'summon'
    && (candidate.hp > 0 || candidate.unitId === unitId) && passivesEnabled(candidate));
  return owner?.unitId === unitId;
}

function ironWallCap(unit: Readonly<UnitState>): number {
  const baseMaxHp = Number(unit.statuses.find(status => status.statusId === skullGeneralIds.maxHpGrowth)?.values?.baseMaxHp
    ?? unit.stats.hp);
  return Math.max(0, baseMaxHp * .5);
}

function addFlower(target: Readonly<UnitState>, sourceUnit: Readonly<UnitState>, skillId: string): EffectCommand {
  const source = { kind: skillId === skullGeneralIds.flower ? 'status' as const : 'skill' as const,
    id: skillId, unitId: sourceUnit.unitId };
  return { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${skullGeneralIds.flower}:${target.unitId}`,
    statusId: skullGeneralIds.flower, source, stacks: 1, duration: { kind: 'permanent' } } };
}

function wallCommand(unit: Readonly<UnitState>, totalLost: number, shieldRemaining: number,
  source: StatusInstance['source']): EffectCommand {
  return { type: 'add-status', source, targetId: unit.unitId, instance: { instanceId: `${skullGeneralIds.ironWall}:${unit.unitId}`,
    statusId: skullGeneralIds.ironWall, source, stacks: 1, duration: { kind: 'permanent' },
    values: { totalLost, shieldRemaining: Math.max(0, shieldRemaining) } } };
}

function shieldCommand(target: Readonly<UnitState>, amount: number, source: StatusInstance['source'], parentEventId: string): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, parentEventId, instance: {
    instanceId: `${skullGeneralIds.ironWall}:flower:${target.unitId}`, statusId: skullGeneralIds.ironWall, source,
    stacks: 1, duration: { kind: 'permanent' }, values: { shieldRemaining: amount },
  } };
}
