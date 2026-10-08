import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { attemptControl } from '../mechanics/control';
import { createLineupDamageSkill, lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import { passivesEnabled } from '../core/passive-eligibility';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import type { ContentRegistry } from './registry';

export const cicadaSnowMaidenIds = { hero: 362, basic: '3621', revive: '3622', springCall: '3625', ultimate: '3623', iceBurst: '3624', freeze: 'status.hero.362.frost',
  defenseAura: 'status.hero.362.cold-breath', cicadaWing: 'status.hero.362.cicada-wing',
  crystallized: 'status.hero.362.crystallized', iceFlower: 'status.hero.362.ice-flower',
  crystallizedSpeed: 'status.hero.362.crystallized-speed',
  springCallReady: 'status.hero.362.spring-call-ready', springBlessing: 'status.hero.362.spring-blessing' } as const;

export function registerCicadaSnowMaiden(registry: ContentRegistry): void {
  const freeze: StatusDefinition = { id: cicadaSnowMaidenIds.freeze, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true,
    preventsActionGaugeChange: true };
  registry.registerStatus(freeze);
  registry.registerStatus({ id: cicadaSnowMaidenIds.defenseAura, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: cicadaSnowMaidenIds.cicadaWing, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: cicadaSnowMaidenIds.crystallized, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', preventsRevive: true });
  registry.registerStatus({ id: cicadaSnowMaidenIds.crystallizedSpeed, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: cicadaSnowMaidenIds.iceFlower, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack' });
  registry.registerStatus({ id: cicadaSnowMaidenIds.springCallReady, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: cicadaSnowMaidenIds.springBlessing, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerHero(createCicadaSnowMaidenDefinition());
}

function createCicadaSnowMaidenDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(cicadaSnowMaidenIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const ultimateBase = createLineupDamageSkill(cicadaSnowMaidenIds.ultimate, [4.5, 4.5, 4.5, 4.5, 4.5],
    { cost: 3, stat: 'defense' });
  const ultimate: SkillDefinition = { ...ultimateBase, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    if (!actor) return [];
    const wing = { type: 'add-status' as const, source: { kind: 'skill' as const, id: cicadaSnowMaidenIds.ultimate,
      unitId: actor.unitId }, targetId: actor.unitId, instance: { instanceId: `${cicadaSnowMaidenIds.cicadaWing}:${actor.unitId}`,
        statusId: cicadaSnowMaidenIds.cicadaWing, source: { kind: 'skill' as const, id: cicadaSnowMaidenIds.ultimate,
          unitId: actor.unitId }, stacks: 1, duration: { kind: 'permanent' as const },
        values: { shieldRemaining: actor.stats.defense * (skillRank(actor, cicadaSnowMaidenIds.ultimate) >= 3 ? 5.85 : 4.5) },
        ...(skillRank(actor, cicadaSnowMaidenIds.ultimate) >= 4 ? { modifiers: [{ stat: 'critResist' as const, operation: 'flat' as const, amount: 1 }] } : {}) } };
    return [...ultimateBase.execute(context, intent, parameters), wing];
  } };
  const revive: SkillDefinition = { id: cicadaSnowMaidenIds.revive, target: 'single', targetRelation: 'ally',
    allowDefeatedTargets: true, levels: [{}, {}, {}, {}, {}], execute(context: BattleContext, intent: ActionIntent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.revive, unitId: actor.unitId };
      const crystallized = context.state.sides[actor.side].flatMap(unitId => {
        const unit = context.getUnit(unitId);
        return unit && unit.hp <= 0 && unit.statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized)
          ? [unit] : [];
      });
      const commands: EffectCommand[] = [];
      for (const unit of crystallized) {
        commands.push({ type: 'remove-statuses', source, targetId: unit.unitId,
          statusIds: [cicadaSnowMaidenIds.crystallized], reason: 'consumed' });
        commands.push({ type: 'revive', source, targetId: unit.unitId, hp: unit.stats.hp });
      }
      const selected = crystallized.find(unit => intent.targetIds.includes(unit.unitId));
      if (selected) commands.push({ type: 'change-action-gauge', source, targetId: selected.unitId, amount: 100 });
      if (crystallized.length > 0) commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${cicadaSnowMaidenIds.springCallReady}:${actor.unitId}`, statusId: cicadaSnowMaidenIds.springCallReady,
        source, stacks: 1, duration: { kind: 'permanent' } } });
      return commands;
    } };
  const springCall: SkillDefinition = { id: cicadaSnowMaidenIds.springCall, target: 'all-allies', targetRelation: 'ally',
    levels: [{}, {}, {}, {}, {}], execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.springCall, unitId: actor.unitId };
      const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: actor.unitId,
        statusIds: [cicadaSnowMaidenIds.springCallReady], reason: 'consumed' }];
      for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'add-status', source,
        targetId: ally.unitId, instance: { instanceId: `${cicadaSnowMaidenIds.springBlessing}:${actor.unitId}:${ally.unitId}`,
          statusId: cicadaSnowMaidenIds.springBlessing, source, stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'damage', operation: 'percent', amount: .2 }, { stat: 'speed', operation: 'flat', amount: 20 }] } });
      return commands;
    } };
  return { id: cicadaSnowMaidenIds.hero, skills: [basic, revive, springCall, ultimate], aiCoverage: 'partial',
    aiCoverageNotes: ['参考本地整理的社区 AI 规则：可复活凝结友方时先息吹；可施放永冬时优先选攻击最高的非阴阳师敌人；普攻目标优先生命比例低于20%的敌人。官方 AI 序列和配对实战行为尚未核验'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['蝉翼不可驱散并于自身回合开始前到期，四级蝉翼提供100%暴击抵抗；蝉翼防护与冰花被动分别按对应技能等级计算；冰花每6层触发极寒之气及等级修正、凝结友方每个增加50速度均已接入；被动检查封印，霜冻锁定行动条；凝结目标替位及间接伤害与护盾交互仍待核验'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor) return [];
      const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.basic, unitId };
      const commands: EffectCommand[] = context.getLivingUnits(actor.side).map(ally => ({ type: 'add-status' as const, source, targetId: ally.unitId,
        instance: { instanceId: `${cicadaSnowMaidenIds.defenseAura}:${unitId}:${ally.unitId}`,
          statusId: cicadaSnowMaidenIds.defenseAura, source, stacks: 1, duration: { kind: 'permanent' as const },
          modifiers: [{ stat: 'defense' as const, operation: 'percent' as const, amount: .3 }] } }));
      if (skillRank(actor, cicadaSnowMaidenIds.ultimate) >= 5) commands.push({ type: 'add-status', source: { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId },
        targetId: unitId, instance: { instanceId: `${cicadaSnowMaidenIds.cicadaWing}:${unitId}`,
          statusId: cicadaSnowMaidenIds.cicadaWing, source: { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId },
          stacks: 1, duration: { kind: 'permanent' }, values: { shieldRemaining: actor.stats.defense
          * (skillRank(actor, cicadaSnowMaidenIds.ultimate) >= 3 ? 5.85 : 4.5) },
          ...(skillRank(actor, cicadaSnowMaidenIds.ultimate) >= 4 ? { modifiers: [{ stat: 'critResist' as const, operation: 'flat' as const, amount: 1 }] } : {}) } });
      return commands;
    },
    interceptIncomingDamage(state, _attacker, target, amount) {
      if (target.hp <= 0 || target.unitKind === 'summon' || target.heroId === cicadaSnowMaidenIds.hero
        || target.statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized)) return undefined;
      const protector = Object.values(state.units).find(unit => unit.side === target.side && unit.hp > 0
        && unit.heroId === cicadaSnowMaidenIds.hero && passivesEnabled(unit));
      if (!protector) return undefined;
      const shieldStatuses = target.statuses.reduce((sum, status) => sum + (typeof status.values?.shieldRemaining === 'number'
        ? Math.max(0, status.values.shieldRemaining) : 0), 0);
      if (amount < target.hp + target.shield + shieldStatuses) return undefined;
      const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.revive, unitId: protector.unitId };
      return { amount, effects: [{ type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${cicadaSnowMaidenIds.crystallized}:${target.unitId}`, statusId: cicadaSnowMaidenIds.crystallized,
        source, stacks: 1, duration: { kind: 'permanent' } } }] };
    },
    handlers: {
      'turn-start': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const actor = context.getUnit(event.unitId);
        if (!actor || actor.heroId !== cicadaSnowMaidenIds.hero
          || !actor.statuses.some(status => status.statusId === cicadaSnowMaidenIds.cicadaWing)) return;
        return [{ type: 'remove-statuses', source: { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId: actor.unitId },
          targetId: actor.unitId, statusIds: [cicadaSnowMaidenIds.cicadaWing], reason: 'expired', parentEventId: event.eventId }];
      } },
      hit: { priority: 100, handle(context, event) {
        if (event.type !== 'damage' || event.source.id !== cicadaSnowMaidenIds.ultimate || !event.source.unitId) return;
        const actor = context.getUnit(event.source.unitId); const target = context.getUnit(event.targetId);
        if (!actor || !target || target.hp <= 0) return;
        const command = attemptControl(context, { attemptId: `${cicadaSnowMaidenIds.freeze}:${event.eventId}`,
          source: { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId: actor.unitId }, targetId: target.unitId,
          statusId: cicadaSnowMaidenIds.freeze, controlType: '霜冻', baseChance: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
        return command?.type === 'apply-control' ? [{ ...command, instance: { ...command.instance, values: {
          ...command.instance.values, wingOwnerUnitId: actor.unitId } } }] : undefined;
      } },
      'effect-resolution': { priority: 110, handle(context, event) {
        if (event.type === 'unit-revived') {
          const revived = context.getUnit(event.unitId);
          return revived ? syncCrystallizedSpeed(context, revived.side, event.eventId) : undefined;
        }
        if (event.type !== 'status-removed' || event.statusId !== cicadaSnowMaidenIds.cicadaWing) return;
        const owner = context.getUnit(event.targetId);
        if (!owner) return;
        const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.ultimate, unitId: owner.unitId };
        return context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').flatMap(unit => unit.statuses.some(status =>
          status.statusId === cicadaSnowMaidenIds.freeze && status.values?.wingOwnerUnitId === owner.unitId)
          ? [{ type: 'remove-statuses' as const, source, targetId: unit.unitId, statusIds: [cicadaSnowMaidenIds.freeze],
            reason: 'consumed' as const, parentEventId: event.eventId }] : []);
      } },
      'unit-defeated': { priority: 80, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const defeated = context.getUnit(event.unitId);
        return defeated ? syncCrystallizedSpeed(context, defeated.side, event.eventId) : undefined;
      } },
      'turn-end': { priority: 80, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const endedUnit = context.getUnit(event.unitId);
        if (!endedUnit || endedUnit.unitKind === 'summon') return;
        const snowMaidens = (['blue', 'red'] as const).flatMap(side => context.getLivingUnits(side))
          .filter(unit => unit.heroId === cicadaSnowMaidenIds.hero && passivesEnabled(unit));
        return snowMaidens.flatMap(snowMaiden => {
          const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.revive, unitId: snowMaiden.unitId };
          const gainedStacks = endedUnit.unitId === snowMaiden.unitId
            && skillRank(snowMaiden, cicadaSnowMaidenIds.revive) >= 5 ? 3 : 1;
          const flower = snowMaiden.statuses.find(status => status.statusId === cicadaSnowMaidenIds.iceFlower);
          const totalStacks = (flower?.stacks ?? 0) + gainedStacks;
          const triggerCount = !context.isUnitUnableToAct(snowMaiden.unitId) ? Math.floor(totalStacks / 6) : 0;
          if (triggerCount === 0) return [{ type: 'add-status' as const, source, targetId: snowMaiden.unitId,
            parentEventId: event.eventId, instance: { instanceId: `${cicadaSnowMaidenIds.iceFlower}:${snowMaiden.unitId}`,
              statusId: cicadaSnowMaidenIds.iceFlower, source, stacks: gainedStacks, duration: { kind: 'permanent' as const } } }];
          const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: snowMaiden.unitId,
            statusIds: [cicadaSnowMaidenIds.iceFlower], reason: 'consumed', parentEventId: event.eventId }];
          const remainingStacks = totalStacks - triggerCount * 6;
          if (remainingStacks > 0) commands.push({ type: 'add-status', source, targetId: snowMaiden.unitId,
            parentEventId: event.eventId, instance: { instanceId: `${cicadaSnowMaidenIds.iceFlower}:${snowMaiden.unitId}`,
              statusId: cicadaSnowMaidenIds.iceFlower, source, stacks: remainingStacks, duration: { kind: 'permanent' } } });
          const sourceStats = context.getEffectiveStats(snowMaiden.unitId);
          if (!sourceStats) return commands;
          const targets = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
            .filter(unit => unit.unitId !== snowMaiden.unitId);
          const burstSource = { kind: 'skill' as const, id: cicadaSnowMaidenIds.iceBurst, unitId: snowMaiden.unitId };
          for (let burst = 0; burst < triggerCount; burst++) for (const target of targets) {
            const targetStats = context.getEffectiveStats(target.unitId);
            if (!targetStats) continue;
            const frozenEnemy = target.side !== snowMaiden.side
              && target.statuses.some(status => status.statusId === cicadaSnowMaidenIds.freeze);
            const ratio = 4.5 * (frozenEnemy && skillRank(snowMaiden, cicadaSnowMaidenIds.revive) >= 2 ? 1.5 : 1);
            const hit = calculateIndirectDamage({ attack: sourceStats.defense, defense: targetStats.defense,
              ratio, critDamage: sourceStats.critDamage }, context.random);
            const allyReduction = target.side === snowMaiden.side && skillRank(snowMaiden, cicadaSnowMaidenIds.revive) >= 4 ? .7 : 1;
            commands.push({ type: 'lose-life', source: burstSource, targetId: target.unitId,
              amount: hit.amount * allyReduction, lifeLossKind: 'indirect', parentEventId: event.eventId });
          }
          return commands;
        });
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      if (actor.statuses.some(status => status.statusId === cicadaSnowMaidenIds.springCallReady))
        return { actorId: unitId, skillId: cicadaSnowMaidenIds.springCall, targetIds: context.getLivingUnits(actor.side).map(ally => ally.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      const crystallized = context.state.sides[actor.side].map(id => context.getUnit(id)).find(unit => Boolean(unit && unit.hp <= 0
        && unit.statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized)));
      if (crystallized) return { actorId: unitId, skillId: cicadaSnowMaidenIds.revive, targetIds: [crystallized.unitId],
        shape: 'single', targetRelation: 'ally' };
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const target = lowestHealthEnemy(context, actor); if (!target) return undefined;
      const anyFrozen = enemies.some(enemy => enemy.statuses.some(status => status.statusId === cicadaSnowMaidenIds.freeze));
      if (!anyFrozen && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const damageTarget = enemies.filter(enemy => enemy.unitKind !== 'onmyoji')
          .sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
            - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack)
            || left.unitId.localeCompare(right.unitId))[0] ?? target;
        return lineupIntent(unitId, cicadaSnowMaidenIds.ultimate, [damageTarget.unitId], 'single');
      }
      return lineupIntent(unitId, cicadaSnowMaidenIds.basic, [target.unitId], 'single');
    },
  };
}

function syncCrystallizedSpeed(context: BattleContext, side: 'blue' | 'red', parentEventId: string): EffectCommand[] {
  const crystallizedCount = context.state.sides[side].map(unitId => context.getUnit(unitId))
    .filter(unit => unit?.statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized)).length;
  const commands: EffectCommand[] = [];
  for (const snowMaiden of context.getLivingUnits(side).filter(unit => unit.heroId === cicadaSnowMaidenIds.hero)) {
    const current = snowMaiden.statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallizedSpeed);
    const source = { kind: 'skill' as const, id: cicadaSnowMaidenIds.revive, unitId: snowMaiden.unitId };
    if (skillRank(snowMaiden, cicadaSnowMaidenIds.revive) < 3 || crystallizedCount === 0) {
      if (current) commands.push({ type: 'remove-statuses', source, targetId: snowMaiden.unitId,
        statusIds: [cicadaSnowMaidenIds.crystallizedSpeed], reason: 'consumed', parentEventId });
      continue;
    }
    commands.push({ type: 'add-status', source, targetId: snowMaiden.unitId, parentEventId, instance: {
      instanceId: `${cicadaSnowMaidenIds.crystallizedSpeed}:${snowMaiden.unitId}`,
      statusId: cicadaSnowMaidenIds.crystallizedSpeed, source, stacks: crystallizedCount, duration: { kind: 'permanent' as const },
      modifiers: [{ stat: 'speed' as const, operation: 'flat' as const, amount: 50, perStack: true }],
    } });
  }
  return commands;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}
