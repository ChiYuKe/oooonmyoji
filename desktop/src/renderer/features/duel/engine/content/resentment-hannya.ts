import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passiveSuppressionStatusId, passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { EffectCommand } from '../core/types';
import type { ContentRegistry } from './registry';

export const resentmentHannyaIds = { hero: 331, basic: '3311', ultimate: '3313', passive: '3312',
  maskBreak: '3316', sealBarrier: 'status.hero.331.seal-barrier', sealMask: 'status.hero.331.seal-mask',
  hateSpread: 'status.hero.331.hate-spread', hateMark: 'status.hero.331.hate-mark',
  critWindow: 'status.hero.331.crit-window', spreadAttackWindow: 'status.hero.331.spread-attack-window' } as const;

const barrierBasicRatios = [.8, .8, .88, .92, 1] as const;

export function registerResentmentHannya(registry: ContentRegistry): void {
  const maskBreak = createMaskBreakSkill();
  registry.registerStatus({ id: resentmentHannyaIds.hateMark, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 9 });
  registry.registerStatus({ id: resentmentHannyaIds.critWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 1 });
  registry.registerStatus({ id: resentmentHannyaIds.spreadAttackWindow, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 1 });
  registry.registerStatus({ id: resentmentHannyaIds.sealBarrier, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 9 });
  registry.registerStatus({ id: resentmentHannyaIds.sealMask, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', grantedSkills: [maskBreak],
    selectAction(context, actor, instance) {
      const ownerId = instance.source.unitId;
      const owner = ownerId ? context.getUnit(ownerId) : undefined;
      const hasBarrier = owner?.hp && owner.hp > 0 && owner.side !== actor.side
        && owner.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier);
      if (!hasBarrier || (context.state.resources[actor.side]?.fire ?? 0) < 1) return undefined;
      return { actorId: actor.unitId, skillId: resentmentHannyaIds.maskBreak, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
    } });
  registry.registerStatus({ id: resentmentHannyaIds.hateSpread, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createResentmentHannyaDefinition());
}

function createResentmentHannyaDefinition(): HeroDefinition {
  const basicAttack = createBasicAttackSkill(resentmentHannyaIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const basic: SkillDefinition = { ...basicAttack, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    if (!actor) return [];
    const barrier = actor.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier);
    if (barrier) {
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const attackerStats = context.getEffectiveStats(actor.unitId);
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!target || !targetStats || !attackerStats) return [];
      const source = { kind: 'skill' as const, id: resentmentHannyaIds.basic, unitId: actor.unitId };
      const ratio = barrierBasicRatios[Math.max(0, skillLevel(actor, resentmentHannyaIds.basic) - 1)]
        ?? Number(parameters.ratio ?? 1) * .8;
      return [0, 1].map(() => {
        const damage = context.calculateDamage({ attack: attackerStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attackerStats.crit,
          critDamage: attackerStats.critDamage }, actor, target);
        return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical };
      });
    }
    return [...basicAttack.execute(context, intent, parameters), ...gainHateMarks(context, actor.unitId,
      { kind: 'skill', id: resentmentHannyaIds.basic, unitId: actor.unitId }, 1)];
  } };
  const barrierSkill: SkillDefinition = { id: resentmentHannyaIds.passive,
    resourceCostsByLevel: [{ resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 },
      { resourceId: 'fire', amount: 0 }, { resourceId: 'fire', amount: 0 }, { resourceId: 'fire', amount: 0 }],
    target: 'self', targetRelation: 'ally', levels: [1, 2, 3, 4, 5].map(level => ({ level })),
    canUse(state, actor) {
      return !actor.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier)
        && (actor.statuses.find(status => status.statusId === resentmentHannyaIds.hateMark)?.stacks ?? 0) >= 9;
    },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || !barrierSkill.canUse?.(context.state, actor)) return [];
      const source = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId: actor.unitId };
      const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: actor.unitId,
        statusIds: [resentmentHannyaIds.hateMark], reason: 'consumed' },
      { type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${resentmentHannyaIds.sealBarrier}:${actor.unitId}`,
        statusId: resentmentHannyaIds.sealBarrier, source, stacks: 9, duration: { kind: 'permanent' } } }];
      const opposingSide = actor.side === 'blue' ? 'red' : 'blue';
      for (const enemy of context.getLivingUnits(opposingSide)) {
        commands.push({ type: 'add-status', source, targetId: enemy.unitId, instance: { instanceId: `${resentmentHannyaIds.sealMask}:${actor.unitId}:${enemy.unitId}`,
          statusId: resentmentHannyaIds.sealMask, source, stacks: 1, duration: { kind: 'permanent' } } });
        commands.push({ type: 'add-status', source, targetId: enemy.unitId, instance: { instanceId: `${passiveSuppressionStatusId}:${actor.unitId}:${enemy.unitId}`,
          statusId: passiveSuppressionStatusId, source, stacks: 1, duration: { kind: 'permanent' } } });
      }
      return commands;
    } };
  const ratios = [.72, .74, .77, .8, .8] as const;
  const ultimate: SkillDefinition = { id: resentmentHannyaIds.ultimate, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'multi' as const, targetRelation: 'enemy' as const,
    levels: ratios.map((ratio, index) => ({ ratio, ...(index === 4 ? { lowHealthExtraRatio: .8 } : {}) })),
    execute(context: BattleContext, intent: ActionIntent, parameters): readonly EffectCommand[] {
      const actor = context.getUnit(intent.actorId); const actorStats = actor && context.getEffectiveStats(actor.unitId);
      const ratio = Number(parameters.ratio ?? .72); const primaryId = intent.targetIds[0];
      if (!actor || !actorStats || !primaryId) return [];
      const source = { kind: 'skill' as const, id: resentmentHannyaIds.ultimate, unitId: actor.unitId };
      const commands: EffectCommand[] = [];
      const hit = (targetId: string): void => {
        const target = context.getUnit(targetId); const targetStats = target && context.getEffectiveStats(target.unitId);
        if (!target || target.hp <= 0 || target.side === actor.side || !targetStats) return;
        const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
      };
      for (let index = 0; index < 3; index++) hit(primaryId);
      const areaHitCount = actor.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier)
        && skillLevel(actor, resentmentHannyaIds.ultimate) >= 2 ? 2 : 1;
      for (let index = 0; index < areaHitCount; index++) for (const targetId of intent.targetIds) hit(targetId);
      const extraRatio = Number(parameters.lowHealthExtraRatio ?? 0);
      if (extraRatio > 0) {
        const lowHealthAllies = context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon'
          && ally.hp / Math.max(1, ally.stats.hp) < .5);
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        for (const _ally of lowHealthAllies) {
          const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))];
          if (!target) continue;
          const targetStats = context.getEffectiveStats(target.unitId);
          if (!targetStats) continue;
          const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: extraRatio, critChance: actorStats.crit,
            critDamage: actorStats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        }
      }
      if (skillLevel(actor, resentmentHannyaIds.ultimate) >= 2)
        commands.push(...gainHateMarks(context, actor.unitId, source, 3));
      return commands;
    } };
  return { id: resentmentHannyaIds.hero, skills: [basic, barrierSkill, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['仇恨印记上限9层，每层+10个百分点效果抵抗/+5%减伤，满层解除控制并推45%行动条；五级先机6层，敌方暴击回印记40%/40%/40%/80%/100%，每行动最多一次；二级起友方式神阵亡+3层、攻击带仇恨蔓延的敌人每次攻击每目标最多+1层；封印期间普攻两段倍率80%/80%/88%/92%/100%并吸血15%；启阵耗3火（三级起免费），开9面且禁止继续得印；破阵技能耗1火破2面，结界全破时尝试给敌方附1回合仇恨蔓延；二级起大招在结界内多打一轮全体并获得3层印记，五级按每个低于50%生命的非召唤友方对随机敌方造成80%伤害。鬼面表外破碎条件、仇恨蔓延抵抗边界及御魂联动仍待核对；御怨般若不在10点场阵容中，没有直接触发帧。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      return skillLevel(actor, resentmentHannyaIds.passive) >= 5
        ? gainHateMarks(context, unitId, { kind: 'skill', id: resentmentHannyaIds.passive, unitId }, 6) : [];
    },
    handlers: {
      hit: { priority: 60, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const sourceUnit = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        const commands: EffectCommand[] = [];
        if (sourceUnit?.heroId === resentmentHannyaIds.hero && target && target.side !== sourceUnit.side) {
          const spreads = target.statuses.filter(status => status.statusId === resentmentHannyaIds.hateSpread
            && status.source.unitId === sourceUnit.unitId);
          if (spreads.length && skillLevel(sourceUnit, resentmentHannyaIds.passive) >= 2) {
            const attackKey = String(event.attackId ?? event.actionId ?? event.eventId);
            const windowId = `${resentmentHannyaIds.spreadAttackWindow}:${sourceUnit.unitId}:${target.unitId}`;
            const window = sourceUnit.statuses.find(status => status.instanceId === windowId);
            if (window?.values?.attackKey !== attackKey) {
              const source = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId: sourceUnit.unitId };
              commands.push(...gainHateMarks(context, sourceUnit.unitId, source, 1, event.eventId));
              commands.push({ type: 'add-status', source, targetId: sourceUnit.unitId, parentEventId: event.eventId,
                instance: { instanceId: windowId, statusId: resentmentHannyaIds.spreadAttackWindow,
                  source, stacks: 1, duration: { kind: 'permanent' }, values: { attackKey } } });
            }
          }
          if (event.source.id === resentmentHannyaIds.basic && event.hpLost > 0
            && sourceUnit.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier))
            commands.push({ type: 'heal', source: event.source, targetId: sourceUnit.unitId, amount: event.hpLost * .15,
              parentEventId: event.eventId });
        }
        if (!event.isCritical || !event.actionId) return commands;
        const attacker = context.getUnit(event.source.unitId);
        const recipient = context.getUnit(event.targetId);
        if (!attacker || !recipient || attacker.side === recipient.side) return commands;
        const hannyas = context.getLivingUnits(recipient.side).filter(unit => unit.heroId === resentmentHannyaIds.hero
          && passivesEnabled(unit));
        for (const hannya of hannyas) {
          const window = hannya.statuses.find(status => status.statusId === resentmentHannyaIds.critWindow);
          if (window?.values?.actionId === event.actionId) continue;
          const source = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId: hannya.unitId };
          commands.push({ type: 'add-status', source, targetId: hannya.unitId, parentEventId: event.eventId,
            instance: { instanceId: `${resentmentHannyaIds.critWindow}:${hannya.unitId}`, statusId: resentmentHannyaIds.critWindow,
              source, stacks: 1, duration: { kind: 'permanent' }, values: { actionId: event.actionId } } });
          const rank = skillLevel(hannya, resentmentHannyaIds.passive);
          const chance = rank >= 5 ? 1 : rank >= 4 ? .8 : .4;
          if (context.random() < chance)
            commands.push(...gainHateMarks(context, hannya.unitId, source, 1, event.eventId));
        }
        return commands;
      } },
      'action-end': { priority: 60, handle(context, event) {
        if (event.type !== 'action-ended' || event.skillId !== resentmentHannyaIds.maskBreak || !event.intent) return;
        const breaker = context.getUnit(event.intent.actorId);
        if (!breaker) return;
        const masks = breaker.statuses.filter(status => status.statusId === resentmentHannyaIds.sealMask);
        const ownedMask = masks.find(status => {
          const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
          return owner?.statuses.some(item => item.statusId === resentmentHannyaIds.sealBarrier);
        });
        const ownerId = ownedMask?.source.unitId;
        const owner = ownerId ? context.getUnit(ownerId) : undefined;
        const barrier = owner?.statuses.find(status => status.statusId === resentmentHannyaIds.sealBarrier);
        if (!owner || !barrier) return;
        const remaining = Math.max(0, barrier.stacks - 2);
        const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: barrier.source, targetId: owner.unitId,
          instanceIds: [barrier.instanceId], parentEventId: event.eventId }];
        if (remaining > 0) commands.push({ type: 'add-status', source: barrier.source, targetId: owner.unitId, parentEventId: event.eventId,
          instance: { ...barrier, instanceId: `${resentmentHannyaIds.sealBarrier}:${owner.unitId}:${remaining}`,
            stacks: remaining } });
        else return closeSealBarrier(context, owner.unitId, event.eventId);
        return commands;
      } },
      'unit-defeated': { priority: 60, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const defeated = context.getUnit(event.unitId);
        if (!defeated || defeated.unitKind === 'summon') return;
        const commands: EffectCommand[] = [];
        if (defeated.heroId === resentmentHannyaIds.hero) {
          const barrier = defeated.statuses.find(status => status.statusId === resentmentHannyaIds.sealBarrier);
          const source = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId: defeated.unitId };
          if (barrier) commands.push({ type: 'remove-status-instances', source, targetId: defeated.unitId,
            instanceIds: [barrier.instanceId], parentEventId: event.eventId });
          const opposingSide = defeated.side === 'blue' ? 'red' : 'blue';
          for (const unitId of context.state.sides[opposingSide]) {
            const unit = context.getUnit(unitId);
            if (!unit) continue;
            const ownedStatuses = unit.statuses.filter(status => status.source.unitId === defeated.unitId
              && (status.statusId === resentmentHannyaIds.sealMask || status.statusId === passiveSuppressionStatusId));
            if (ownedStatuses.length) commands.push({ type: 'remove-status-instances', source, targetId: unitId,
              instanceIds: ownedStatuses.map(status => status.instanceId), parentEventId: event.eventId });
          }
        }
        const hannyas = context.getLivingUnits(defeated.side).filter(unit => unit.heroId === resentmentHannyaIds.hero
          && passivesEnabled(unit) && skillLevel(unit, resentmentHannyaIds.passive) >= 2);
        for (const hannya of hannyas) commands.push(...gainHateMarks(context, hannya.unitId,
          { kind: 'skill', id: resentmentHannyaIds.passive, unitId: hannya.unitId }, 3, event.eventId));
        return commands;
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const marks = actor.statuses.find(status => status.statusId === resentmentHannyaIds.hateMark)?.stacks ?? 0;
      if (marks >= 9 && !actor.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier)) {
        const level = skillLevel(actor, resentmentHannyaIds.passive);
        const cost = level >= 3 ? 0 : 3;
        if ((context.state.resources[actor.side]?.fire ?? 0) >= cost)
          return lineupIntent(unitId, resentmentHannyaIds.passive, [unitId], 'self');
      }
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? lineupIntent(unitId, resentmentHannyaIds.ultimate, [lowestHealthEnemy(context, actor)!.unitId,
          ...enemies.filter(enemy => enemy.unitId !== lowestHealthEnemy(context, actor)!.unitId).map(enemy => enemy.unitId)], 'multi')
        : lineupIntent(unitId, resentmentHannyaIds.basic, [lowestHealthEnemy(context, actor)!.unitId], 'single');
    },
  };
}

function gainHateMarks(context: BattleContext, unitId: string, source: import('../core/types').SourceRef, stacks: number,
  parentEventId?: string): EffectCommand[] {
  const unit = context.getUnit(unitId);
  if (!unit) return [];
  if (unit.statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier)) return [];
  const current = unit.statuses.find(status => status.statusId === resentmentHannyaIds.hateMark)?.stacks ?? 0;
  const gained = Math.min(stacks, 9 - current);
  if (gained <= 0) return [];
  const markSource = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId };
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
    instanceId: `${resentmentHannyaIds.hateMark}:${unitId}`, statusId: resentmentHannyaIds.hateMark,
    source: markSource, stacks: gained, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .1, perStack: true },
      { stat: 'damageTaken', operation: 'percent', amount: -.05, perStack: true }],
  } }];
  if (current < 9 && current + gained >= 9) {
    const controls = unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
    if (controls.length) commands.push({ type: 'remove-status-instances', source: markSource, targetId: unitId,
      instanceIds: controls.map(status => status.instanceId), reason: 'consumed', ...(parentEventId ? { parentEventId } : {}) });
    commands.push({ type: 'change-action-gauge', source: markSource, targetId: unitId, amount: 45,
      ...(parentEventId ? { parentEventId } : {}) });
  }
  return commands;
}

function createMaskBreakSkill(): SkillDefinition {
  return { id: resentmentHannyaIds.maskBreak, resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'self', targetRelation: 'ally', levels: [{ level: 1 }], execute: () => [] };
}

function closeSealBarrier(context: BattleContext, ownerId: string, parentEventId: string): EffectCommand[] {
  const owner = context.getUnit(ownerId);
  const barrier = owner?.statuses.find(status => status.statusId === resentmentHannyaIds.sealBarrier);
  if (!owner || !barrier) return [];
  const source = { kind: 'skill' as const, id: resentmentHannyaIds.passive, unitId: ownerId };
  const opposingSide = owner.side === 'blue' ? 'red' : 'blue';
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: ownerId,
    instanceIds: [barrier.instanceId], parentEventId }];
  for (const unitId of context.state.sides[opposingSide]) {
    const unit = context.getUnit(unitId);
    if (!unit) continue;
    const ownedStatuses = unit.statuses.filter(status => status.source.unitId === ownerId
      && (status.statusId === resentmentHannyaIds.sealMask || status.statusId === passiveSuppressionStatusId));
    if (ownedStatuses.length) commands.push({ type: 'remove-status-instances', source, targetId: unitId,
      instanceIds: ownedStatuses.map(status => status.instanceId), parentEventId });
    if (unit.hp > 0) commands.push(...attemptDebuff(context, { source, targetId: unitId,
      statusId: resentmentHannyaIds.hateSpread, baseChance: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId,
      modifiers: [{ stat: 'crit', operation: 'flat', amount: .5 },
        { stat: 'damage', operation: 'percent', amount: -.35 }] }));
  }
  return commands;
}

function skillLevel(unit: Readonly<import('../core/types').UnitState> | undefined, skillId: string): number {
  const level = unit?.skillLevels?.[skillId];
  return Number.isInteger(level) ? Math.max(1, Math.min(5, level!)) : Math.max(1, Math.min(5, unit?.skillLevel ?? 1));
}
