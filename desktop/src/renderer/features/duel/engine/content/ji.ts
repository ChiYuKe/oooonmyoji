import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, UnitState } from '../core/types';
import { createLineupDamageSkill, lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import { attemptDebuff } from '../mechanics/control';
import { passiveSuppressionStatusId } from '../core/passive-eligibility';
import { soulSuppressionStatusId } from '../core/soul-eligibility';
import { effectiveDefenseIgnore, effectiveStats } from '../mechanics/stats';
import type { DamageFormulaInput } from '../mechanics/damage';
import type { ContentRegistry } from './registry';

export const jiIds = {
  hero: 392, basic: '3921', seasonCore: '3922', season: '39221', summer: '39222', autumn: '39223', winter: '39224',
  ultimate: '3923', greatUltimate: '39231', fourSeason: 'status.hero.392.four-season', yearsRenewal: 'status.hero.392.years-renewal',
  summerFavor: 'status.hero.392.summer-favor', winterResist: 'status.hero.392.winter-resist',
  winterChill: 'status.hero.392.winter-chill', seasonSpirit: 'status.hero.392.season-spirit',
} as const;

const seasonNames = ['spring', 'summer', 'autumn', 'winter'] as const;
type Season = typeof seasonNames[number];

export function registerJi(registry: ContentRegistry): void {
  const status: Omit<StatusDefinition, 'id'> = { mechanicsCoverage: 'partial', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' };
  registry.registerStatus({ id: jiIds.fourSeason, ...status, category: 'buff', refreshPolicy: 'add-stack', maxStacks: 4,
    preventsLethalDamage: true, healingRestriction: { allowedSourceIds: [jiIds.season] } });
  registry.registerStatus({ id: jiIds.yearsRenewal, ...status, category: 'buff',
    refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiIds.summerFavor, ...status, category: 'buff',
    refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiIds.winterResist, ...status, category: 'buff',
    refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiIds.winterChill, ...status, category: 'debuff', dispellable: true, sealable: true,
    refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiIds.seasonSpirit, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', handlers: {
      'turn-end': { priority: 95, handle(context, event) { return onSeasonSpiritTurnEnd(context, event); } },
    } });
  registry.registerHero(createJiDefinition());
}

function createJiDefinition(): HeroDefinition {
  const basic = createLineupDamageSkill(jiIds.basic, [1, 1.05, 1.1, 1.15, 1.25], { actionKind: 'basic', canCrit: false });
  const seasons = [
    createSeasonSkill(jiIds.season, 'spring'), createSeasonSkill(jiIds.summer, 'summer'),
    createSeasonSkill(jiIds.autumn, 'autumn'), createSeasonSkill(jiIds.winter, 'winter'),
  ];
  const extraRatios = [.6, .8, 1, 1.2, 1.2] as const;
  const baseUltimate = createLineupDamageSkill(jiIds.ultimate, [.3, .3, .3, .3, .3],
    { cost: 3, target: 'all-enemies', hits: 3, canCrit: false });
  const extraHit = createLineupDamageSkill(jiIds.ultimate, extraRatios, { target: 'single', canCrit: false });
  const ultimate: SkillDefinition = { ...baseUltimate, execute(context, intent, parameters) {
    const commands: EffectCommand[] = [...baseUltimate.execute(context, intent, parameters)];
    const actor = context.getUnit(intent.actorId); if (!actor) return commands;
    const target = lowestHealthEnemy(context, actor); if (!target) return commands;
    const missingFraction = Math.max(0, 1 - actor.hp / Math.max(1, actor.stats.hp));
    const extras = Math.min(4, Math.floor((missingFraction + 1e-9) / .24));
    const ratio = extraRatios[Math.max(0, Math.min(extraRatios.length - 1, skillRank(actor, jiIds.ultimate) - 1))] ?? .6;
    for (let index = 0; index < extras; index++) commands.push(...extraHit.execute(context,
      { ...intent, targetIds: [target.unitId], shape: 'single' }, { ratio }));
    commands.push(...triggerSeasonSpiritsOnSkill(context, actor));
    return commands;
  } };
  const greatBase = createLineupDamageSkill(jiIds.greatUltimate, [.4, .4, .4, .4, .4],
    { cost: 3, target: 'all-enemies', hits: 3, canCrit: false });
  const greatExtra = createLineupDamageSkill(jiIds.greatUltimate, extraRatios, { target: 'single', canCrit: false });
  const greatUltimate: SkillDefinition = { ...greatBase, execute(context, intent, parameters) {
    const commands: EffectCommand[] = [...greatBase.execute(context, intent, parameters)];
    const actor = context.getUnit(intent.actorId); if (!actor) return commands;
    const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
      .slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp));
    const targets = enemies.slice(0, 3);
    const missingFraction = Math.max(0, 1 - actor.hp / Math.max(1, actor.stats.hp));
    const extras = Math.min(4, Math.floor((missingFraction + 1e-9) / .24));
    const ratio = extraRatios[Math.max(0, Math.min(extraRatios.length - 1, skillRank(actor, jiIds.ultimate) - 1))] ?? .6;
    for (let index = 0; index < extras; index++) for (const target of targets)
      commands.push(...greatExtra.execute(context, { ...intent, targetIds: [target.unitId], shape: 'single' }, { ratio }));
    commands.push(...triggerSeasonSpiritsOnSkill(context, actor));
    return commands;
  } };
  return { id: jiIds.hero, skills: [basic, ...seasons, ultimate, greatUltimate], aiCoverage: 'partial',
    aiCoverageNotes: ['参考本地整理的社区 AI 规则：四季流转未满4层或四时一隅未开启时优先施放四时一隅·秋；达到4层且鬼火足够时优先四季大葬。未有官方 AI 序列或配对实战记录核验'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['四时一隅等级控制先机、持续时间、同季返火及二级岁时生息减伤，四级起季灵攻击怪物造成真实伤害；弥天叶唳等级控制追加伤害与五级即时季灵；暴击抵抗按暴击伤害高于基础150%的部分每点增加0.5点；四季流转每层可抵挡一次致命伤害；季灵封印/抵抗条件及多目标选择权重仍未完整核验'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || skillRank(actor, jiIds.seasonCore) < 5) return [];
      return enterSeason(context, actor, 'spring', jiIds.season, true);
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const target = lowestHealthEnemy(context, actor); if (!target) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const stance = actor.statuses.find(status => status.statusId === jiIds.fourSeason);
      const stacks = stance?.stacks ?? 0;
      if ((!stance || stacks < 4) && fire >= 2)
        return lineupIntent(unitId, jiIds.autumn, [unitId], 'self');
      if (stance && stacks >= 4 && fire >= 3)
        return lineupIntent(unitId, jiIds.greatUltimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return lineupIntent(unitId, jiIds.basic, [target.unitId], 'single');
    },
    handlers: {
      'action-end': { priority: 90, handle(context, event) { return onSeasonAllySkill(context, event); } },
      hit: { priority: 90, handle(context, event) { return onWinterHit(context, event); } },
    },
    modifyOutgoingDamage(attacker, _target, amount) {
      if (attacker.heroId !== jiIds.hero) return amount;
      const critDamage = effectiveStats(attacker as UnitState).critDamage;
      return amount * (1 + Math.max(0, critDamage - 1.5));
    },
    beforeCalculateDamage(input, _attacker, target) {
      if (target.heroId !== jiIds.hero) return input;
      const critDamage = effectiveStats(target).critDamage;
      const bonusCritResist = Math.max(0, critDamage - 1.5) * .5;
      if (bonusCritResist <= 0) return input;
      return { ...input, critResist: (input.critResist ?? target.damageAttributes?.critResist ?? 0) + bonusCritResist };
    },
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.heroId !== jiIds.hero || skillRank(target, jiIds.seasonCore) < 2
        || !target.statuses.some(status => status.statusId === jiIds.yearsRenewal)) return amount;
      const hpFraction = Math.max(0, Math.min(1, target.hp / Math.max(1, target.stats.hp)));
      return amount * hpFraction;
    },
  };
}

function createSeasonSkill(id: string, season: Season): SkillDefinition {
  return { id, resourceCost: { resourceId: 'fire', amount: 2 }, target: 'self', targetRelation: 'ally',
    levels: [{ turns: 2 }, { turns: 2 }, { turns: 3 }, { turns: 3 }, { turns: 3 }],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
      return enterSeason(context, actor, season, id, false);
    } };
}

function enterSeason(context: BattleContext, actor: Readonly<UnitState>, season: Season, skillId: string,
  opening: boolean): EffectCommand[] {
  const current = actor.statuses.find(status => status.statusId === jiIds.fourSeason);
  const previousSeason = current?.values?.season;
  const source = { kind: 'skill' as const, id: skillId, unitId: actor.unitId };
  const remaining = skillRank(actor, jiIds.seasonCore) >= 3 ? 3 : 2;
  const stanceSource = { kind: 'skill' as const, id: jiIds.season, unitId: actor.unitId };
  const commands: EffectCommand[] = [];
  if (!opening) commands.push({ type: 'lose-life', source, targetId: actor.unitId,
    amount: Math.max(0, Math.min(actor.hp - 1, actor.stats.hp * .24)), lifeLossKind: 'direct' });
  commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${jiIds.fourSeason}:${actor.unitId}`,
    statusId: jiIds.fourSeason, source: stanceSource, stacks: 1, duration: { kind: 'count', remaining, owner: 'target-turn' },
    values: { season } } });
  if (!opening && previousSeason && previousSeason !== season) {
    commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${jiIds.yearsRenewal}:${actor.unitId}`,
      statusId: jiIds.yearsRenewal, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    } });
  } else if (!opening && previousSeason === season && skillRank(actor, jiIds.seasonCore) >= 4) {
    commands.push({ type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: 1 });
  }
  if (season === 'spring') {
    commands.push({ type: 'heal', source, targetId: actor.unitId, amount: actor.stats.hp * .24 });
    for (const ally of context.getLivingUnits(actor.side)) if (ally.unitId !== actor.unitId && ally.unitKind !== 'summon')
      commands.push({ type: 'heal', source, targetId: ally.unitId, amount: ally.stats.hp * .08 });
  }
  if (season === 'winter') {
    for (const ally of context.getLivingUnits(actor.side)) if (ally.unitKind !== 'summon')
      commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${jiIds.winterResist}:${actor.unitId}:${ally.unitId}`,
        statusId: jiIds.winterResist, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: .5 }] } });
  }
  return commands;
}

function onSeasonAllySkill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'skill' || !event.source.unitId) return;
  const caster = context.getUnit(event.source.unitId); if (!caster || caster.hp <= 0) return;
  const owners = context.getLivingUnits(caster.side).filter(unit => unit.heroId === jiIds.hero
    && unit.statuses.some(status => status.statusId === jiIds.fourSeason));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const season = owner.statuses.find(status => status.statusId === jiIds.fourSeason)?.values?.season;
    const source = { kind: 'skill' as const, id: jiIds.season, unitId: owner.unitId };
    if (season === 'spring') {
      commands.push({ type: 'heal', source, targetId: caster.unitId, amount: caster.stats.hp * .08, parentEventId: event.eventId });
      commands.push({ type: 'heal', source, targetId: owner.unitId, amount: owner.stats.hp * .08, parentEventId: event.eventId });
    } else if (season === 'summer') {
      commands.push({ type: 'add-status', source, targetId: caster.unitId, parentEventId: event.eventId,
        instance: { instanceId: `${jiIds.summerFavor}:${owner.unitId}:${caster.unitId}`, statusId: jiIds.summerFavor,
          source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }, { stat: 'hit', operation: 'flat', amount: .3 }] } });
    }
  }
  const intent = event.intent;
  if (!intent) return commands;
  const selectedEnemies = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit
    && unit.hp > 0 && unit.side !== caster.side));
  const enemies = selectedEnemies.length > 0 ? selectedEnemies : context.getLivingUnits(caster.side === 'blue' ? 'red' : 'blue');
  if (enemies.length === 0) return commands;
  const existingSpirits = Object.values(context.state.units).reduce((count, unit) => count
    + unit.statuses.filter(status => status.statusId === jiIds.seasonSpirit).length, 0);
  if (existingSpirits >= 3) return commands;
  const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
    - right.hp / Math.max(1, right.stats.hp) || left.unitId.localeCompare(right.unitId))
    .find(enemy => !enemy.statuses.some(status => status.statusId === jiIds.seasonSpirit));
  if (!target) return commands;
  const season = owners[0]?.statuses.find(status => status.statusId === jiIds.fourSeason)?.values?.season;
  const owner = owners[0];
  if (owner) {
    const source = { kind: 'skill' as const, id: jiIds.season, unitId: owner.unitId };
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${jiIds.seasonSpirit}:${owner.unitId}:${target.unitId}`, statusId: jiIds.seasonSpirit,
        source, stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
        values: { ownerUnitId: owner.unitId, season: typeof season === 'string' ? season : 'spring' } } });
  }
  return commands;
}

function onSeasonSpiritTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  const mark = target?.statuses.find(status => status.statusId === jiIds.seasonSpirit);
  if (!target || target.hp <= 0 || !mark) return;
  const ownerId = String(mark.values?.ownerUnitId ?? mark.source.unitId ?? '');
  const owner = context.getUnit(ownerId);
  return owner ? resolveSeasonSpiritAttack(context, owner, target, event.eventId) : undefined;
}

function triggerSeasonSpiritsOnSkill(context: BattleContext, actor: Readonly<UnitState>): EffectCommand[] {
  if (skillRank(actor, jiIds.ultimate) < 5) return [];
  const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
  return enemies.flatMap(target => {
    const mark = target.statuses.find(status => status.statusId === jiIds.seasonSpirit
      && String(status.values?.ownerUnitId ?? status.source.unitId ?? '') === actor.unitId);
    return mark ? resolveSeasonSpiritAttack(context, actor, target) : [];
  });
}

function resolveSeasonSpiritAttack(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>,
  parentEventId?: string): EffectCommand[] {
  if (owner.hp <= 0 || target.hp <= 0) return [];
  const mark = target.statuses.find(status => status.statusId === jiIds.seasonSpirit
    && String(status.values?.ownerUnitId ?? status.source.unitId ?? '') === owner.unitId);
  if (!mark) return [];
  const ownerStats = owner && context.getEffectiveStats(owner.unitId);
  const targetStats = context.getEffectiveStats(target.unitId);
  if (!ownerStats || !targetStats) return [];
  const season = mark.values?.season;
  const ratio = season === 'autumn' ? 1.2 : .4;
  const trueDamageToMonster = target.unitKind === 'monster' && skillRank(owner, jiIds.seasonCore) >= 4;
  const hit = context.calculateDamage({ attack: ownerStats.attack,
    defense: trueDamageToMonster ? 0 : targetStats.defense,
    defenseIgnore: trueDamageToMonster ? 0 : effectiveDefenseIgnore(owner),
    ratio, critChance: 0, critDamage: 1 }, owner, target);
  const source = { kind: 'skill' as const, id: jiIds.seasonSpirit, unitId: owner.unitId };
  const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
    amount: hit.amount, ...(trueDamageToMonster ? { damageKind: 'true' as const } : {}),
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: false,
    ...(parentEventId ? { parentEventId } : {}) }];
  if (season === 'summer') {
    const suppression = attemptDebuff(context, { source, targetId: target.unitId, statusId: passiveSuppressionStatusId,
      baseChance: .3, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, ...(parentEventId ? { parentEventId } : {}) });
    commands.push(...suppression);
    if (suppression.some(command => command.type === 'add-status')) commands.push({ type: 'add-status', source,
      targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}), instance: { instanceId: `${soulSuppressionStatusId}:${parentEventId ?? `skill:${context.state.counters.action}`}`,
        statusId: soulSuppressionStatusId, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
  }
  return commands;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}

function onWinterHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.hp <= 0 || !target || target.side === attacker.side) return;
  const owners = context.getLivingUnits(target.side).filter(unit => unit.heroId === jiIds.hero
    && unit.statuses.some(status => status.statusId === jiIds.fourSeason && status.values?.season === 'winter'));
  if (!owners.length) return;
  const owner = owners[0]!;
  const source = { kind: 'skill' as const, id: jiIds.winter, unitId: owner.unitId };
  return [{ type: 'add-status', source, targetId: attacker.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${jiIds.winterChill}:${owner.unitId}:${attacker.unitId}`, statusId: jiIds.winterChill,
      source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      modifiers: [{ stat: 'critDamage', operation: 'percent', amount: -.3 }] } }];
}
