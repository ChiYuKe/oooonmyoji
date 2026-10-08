import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const luoxinfufuIds = {
  hero: 270,
  basic: '2701',
  passive: '2702',
  ultimate: '2703',
  mark: 'status.hero.270.spider-mark',
  stun: 'status.hero.270.stun',
  venom: 'status.hero.270.heart-eating-venom',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.72, .76, .8, .83, .83] as const;

/** 络新妇 client rows 2701–2703 and buff rows 2702–2703. */
export function registerLuoxinfufu(registry: ContentRegistry): void {
  registry.registerStatus({ id: luoxinfufuIds.mark, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: luoxinfufuIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true,
    preventsActionGaugeChange: true });
  registry.registerStatus({ id: 'status.hero.270.mark-slow', mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus(createVenomStatus());
  registry.registerHero(createLuoxinfufuDefinition());
}

export function createLuoxinfufuDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(luoxinfufuIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: luoxinfufuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map((ratio, rank) => ({ ratio, stunChance: .15, applyVenom: rank === 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = spiderSource(luoxinfufuIds.ultimate, actor.unitId);
      const attack = context.getEffectiveStats(actor.unitId);
      if (!attack) return [];
      const ratio = Number(parameters.ratio ?? .72);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === actor.side) continue;
        const targetStats = context.getEffectiveStats(targetId);
        if (!targetStats) continue;
        const hit = context.calculateDamage({ attack: attack.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit,
          critDamage: attack.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
      }
      return commands;
    },
  };
  return {
    id: luoxinfufuIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['客户端技能行确认毒针等级倍率、60%蛛印持续2回合、蛛印目标施放耗火技能时受到络新妇100%攻击间接伤害并减速20持续1回合；噬心食髓3火、72%至83%倍率、速度差每3点增加1%基础眩晕概率，五级对未眩晕目标造成136%间接伤害且每点速度差增加1%、最多加50个百分点。速度差边界和御魂联动仍需录像核验'],
    handlers: {
      hit: { priority: 100, handle(context, event) { return applySpiderMarkAndStun(context, event); } },
      'control-application': { priority: 100, handle(context, event) { return venomWhenStunBlocked(context, event); } },
      'action-end': { priority: 100, handle(context, event) { return triggerMarkOnFireSkill(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? { actorId: unitId, skillId: luoxinfufuIds.ultimate, targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: luoxinfufuIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function applySpiderMarkAndStun(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || ![luoxinfufuIds.basic, luoxinfufuIds.ultimate].includes(event.source.id as typeof luoxinfufuIds.basic)
    || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== luoxinfufuIds.hero || actor.hp <= 0 || !target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  if (passivesEnabled(actor)) commands.push(...attemptDebuff(context, { source: spiderSource(luoxinfufuIds.passive, actor.unitId),
    targetId: target.unitId, statusId: luoxinfufuIds.mark, baseChance: .6,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }));
  if (event.source.id === luoxinfufuIds.ultimate) {
    const attack = context.getEffectiveStats(actor.unitId), defense = context.getEffectiveStats(target.unitId);
    if (!attack || !defense) return commands.length ? commands : undefined;
    const speedDifference = Math.max(0, attack.speed - defense.speed);
    const rank = actor.skillLevels?.[luoxinfufuIds.ultimate] ?? actor.skillLevel;
    const stunChance = .15 + Math.floor(speedDifference / 3) * .01;
    const stun = attemptControl(context, { attemptId: `${luoxinfufuIds.stun}:${event.eventId}`,
      source: spiderSource(luoxinfufuIds.ultimate, actor.unitId), targetId: target.unitId,
      statusId: luoxinfufuIds.stun, controlType: '眩晕', baseChance: stunChance,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
    if (stun) commands.push(stun);
    if (rank >= 5 && stun?.type !== 'apply-control') commands.push(...applyVenom(context, actor, target, speedDifference, event.eventId));
  }
  return commands.length ? commands : undefined;
}

function venomWhenStunBlocked(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-blocked' || event.controlStatusId !== luoxinfufuIds.stun
    || event.source.id !== luoxinfufuIds.ultimate || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== luoxinfufuIds.hero || !target || target.hp <= 0
    || (actor.skillLevels?.[luoxinfufuIds.ultimate] ?? actor.skillLevel) < 5) return;
  const attack = context.getEffectiveStats(actor.unitId), defense = context.getEffectiveStats(target.unitId);
  if (!attack || !defense) return;
  return applyVenom(context, actor, target, Math.max(0, attack.speed - defense.speed), event.eventId);
}

function applyVenom(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, speedDifference: number,
  parentEventId: string): EffectCommand[] {
  return attemptDebuff(context, { source: spiderSource(luoxinfufuIds.ultimate, actor.unitId), targetId: target.unitId,
    statusId: luoxinfufuIds.venom, baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { indirectDamageRatio: 1.36 + Math.min(.5, speedDifference * .01) }, parentEventId });
}

function triggerMarkOnFireSkill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'skill' || !event.intent || !event.source.unitId) return;
  const target = context.getUnit(event.source.unitId);
  if (!target || target.hp <= 0 || !target.statuses.some(status => status.statusId === luoxinfufuIds.mark)) return;
  const monster = target.unitKind === 'summon' || target.unitKind === 'monster';
  const rank = target.skillLevels?.[event.skillId] ?? target.skillLevel;
  const row = battleSkillRow(event.skillId, rank, target.awakeFilter, monster)
    ?? battleSkillRow(event.skillId, rank, undefined, monster);
  if ((skillNumber(row, 'consumeVal') ?? 0) <= 0) return;
  const mark = target.statuses.find(status => status.statusId === luoxinfufuIds.mark);
  const spider = mark?.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
  if (!mark || !spider || spider.heroId !== luoxinfufuIds.hero || !passivesEnabled(spider)) return;
  const source = spiderSource(luoxinfufuIds.passive, spider.unitId);
  const attack = context.getEffectiveStats(spider.unitId), defense = context.getEffectiveStats(target.unitId);
  if (!attack || !defense) return;
  const damage = calculateIndirectDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(spider), ratio: 1, critDamage: attack.critDamage }, context.random);
  return [
    { type: 'lose-life', source, targetId: target.unitId, amount: damage.amount, lifeLossKind: 'indirect', parentEventId: event.eventId },
    { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
      instanceId: `status.hero.270.mark-slow:${spider.unitId}:${target.unitId}`,
      statusId: 'status.hero.270.mark-slow', source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: -20 }],
    } },
  ];
}

function createVenomStatus(): StatusDefinition {
  return { id: luoxinfufuIds.venom, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 82, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const target = context.getUnit(event.unitId);
      if (!target || target.hp <= 0) return;
      return target.statuses.filter(status => status.statusId === luoxinfufuIds.venom).flatMap(status => {
        const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
        const attack = owner && context.getEffectiveStats(owner.unitId), defense = context.getEffectiveStats(target.unitId);
        if (!owner || !attack || !defense) return [];
        const hit = calculateIndirectDamage({ attack: attack.attack, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(owner), ratio: Number(status.values?.indirectDamageRatio ?? 1.36),
          critDamage: attack.critDamage }, context.random);
        return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
          amount: hit.amount, lifeLossKind: 'indirect' as const, parentEventId: event.eventId }];
      });
    } } } };
}

function spiderSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
