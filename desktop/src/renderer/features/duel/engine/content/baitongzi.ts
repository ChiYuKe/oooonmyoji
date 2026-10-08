import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const baitongziIds = {
  hero: 278,
  basic: '2781',
  passive: '2782',
  ultimate: '2783',
  spiritBasic: '27810',
  whiteProtection: 'status.hero.278.white-protection',
  spiritLifetime: 'status.hero.278.soul-lifetime',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.06, 1.11, 1.16, 1.21, 1.26] as const;

export function registerBaitongzi(registry: ContentRegistry): void {
  registry.registerStatus({ id: baitongziIds.whiteProtection, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: baitongziIds.spiritLifetime, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 47, handle(context, event) { return expireSoulAtTurnEnd(context, event); } } } });

  const basic = createBasicAttackSkill(baitongziIds.basic, basicRatios);
  const spiritBasic: SkillDefinition = { ...createBasicAttackSkill(baitongziIds.spiritBasic, [1]),
    canUse(_state, actor) { return actor.heroId === baitongziIds.hero && actor.unitKind === 'summon' && actor.displayName === '魂魄'; } };
  const ultimate: SkillDefinition = {
    id: baitongziIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map((ratio, index) => ({ ratio, rank: index + 1 })),
    canUse(_state, actor) { return actor.heroId === baitongziIds.hero && actor.awakeFilter === 1 && actor.unitKind !== 'summon'; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== baitongziIds.hero || actor.unitKind === 'summon') return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillIndex(actor, baitongziIds.ultimate)]!);
      const commands: EffectCommand[] = intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const defense = target && (context.getEffectiveStats(target.unitId) ?? target.stats).defense;
        if (!target || target.hp <= 0 || target.side === actor.side || defense === undefined) return [];
        const hit = context.calculateDamage({ attack: stats.attack, defense, ratio,
          critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source: baiSource(baitongziIds.ultimate, actor.unitId), targetId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      });
      for (const ally of context.getLivingUnits(actor.side)) commands.push(whiteProtectionCommand(actor, ally));
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: baitongziIds.hero, skills: [basic, ultimate, spiritBasic], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['罪罚·白普攻倍率、招魂3火/等级群攻倍率/一回合全队白之护（一次拦截任意伤害、效果抵抗+40%）、敌方式神阵亡后不灭普攻追击、招魂后从阵亡式神位置生成同阵营魂魄并立即普攻/存活一回合已接入。引擎没有原生阵位字段，魂魄以阵亡单位ID关联、继承其攻防生命面板；魂魄生命/防御继承的精确客户端规则、同时多个魂魄行动排序及多白童子重复召魂限制仍待帧核。'],
    interceptIncomingDamage(state, _attacker, target, amount): DamageInterception | undefined {
      const protection = target.statuses.find(status => status.statusId === baitongziIds.whiteProtection);
      if (!protection || amount <= 0) return;
      return { amount: 0, effects: [{ type: 'remove-status-instances', source: protection.source, targetId: target.unitId,
        instanceIds: [protection.instanceId], reason: 'consumed' }] };
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (actor.unitKind === 'summon' && actor.displayName === '魂魄') {
        const target = enemies[Math.floor(context.random() * enemies.length)]!;
        return baiIntent(actor.unitId, baitongziIds.spiritBasic, [target.unitId], 'single', 'enemy');
      }
      if (actor.unitKind === 'summon') return undefined;
      if (actor.awakeFilter === 1 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return baiIntent(actor.unitId, baitongziIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      return baiIntent(actor.unitId, baitongziIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
    handlers: {
      'unit-defeated': { priority: 47, handle(context, event) { return counterOnEnemyShikigamiDefeat(context, event); } },
      'attack-end': { priority: 47, handle(context, event) { return summonSoulsAfterUltimate(context, event); } },
      'effect-resolution': { priority: 47, handle(context, event) { return attackOnSoulSummoned(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function counterOnEnemyShikigamiDefeat(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const dead = context.getUnit(event.unitId);
  if (!dead || dead.unitKind !== 'shikigami') return;
  const owners = context.getLivingUnits(dead.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === baitongziIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
    if (!enemies.length) continue;
    const target = enemies[Math.floor(context.random() * enemies.length)]!;
    commands.push({ type: 'schedule-action', source: baiSource(baitongziIds.passive, owner.unitId),
      intent: baiIntent(owner.unitId, baitongziIds.basic, [target.unitId], 'single', 'enemy'),
      scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function summonSoulsAfterUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== baitongziIds.ultimate || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== baitongziIds.hero || owner.hp <= 0 || owner.unitKind === 'summon' || owner.awakeFilter !== 1) return;
  const deadUnits = Object.values(context.state.units).filter(unit => unit.hp <= 0 && unit.unitKind === 'shikigami');
  if (!deadUnits.length) return;
  const commands: EffectCommand[] = [];
  for (const [index, dead] of deadUnits.entries()) {
    const unitId = `soul:${owner.unitId}:${dead.unitId}:${event.attackId ?? context.state.counters.attack}:${index + 1}`;
    const stats = { ...dead.stats };
    const spirit: UnitState = { unitId, heroId: baitongziIds.hero, displayName: '魂魄', unitKind: 'summon',
      summonedByUnitId: owner.unitId, skillLevel: 1, side: dead.side, stats, hp: stats.hp, shield: 0,
      actionGauge: 0, statuses: [spiritLifetimeStatus(owner.unitId, unitId)], resources: {} };
    commands.push({ type: 'summon-unit', source: baiSource(baitongziIds.ultimate, owner.unitId), unit: spirit,
      parentEventId: event.eventId });
  }
  return commands;
}

function attackOnSoulSummoned(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-summoned') return;
  const spirit = context.getUnit(event.unitId);
  if (!spirit || spirit.heroId !== baitongziIds.hero || spirit.unitKind !== 'summon' || spirit.displayName !== '魂魄') return;
  const enemies = context.getLivingUnits(spirit.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length) return;
  const target = enemies[Math.floor(context.random() * enemies.length)]!;
  return [{ type: 'schedule-action', source: baiSource(baitongziIds.ultimate, spirit.summonedByUnitId ?? spirit.unitId),
    intent: baiIntent(spirit.unitId, baitongziIds.spiritBasic, [target.unitId], 'single', 'enemy'),
    scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId }];
}

function expireSoulAtTurnEnd(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const spirit = _context.getUnit(event.unitId);
  if (!spirit || spirit.heroId !== baitongziIds.hero || spirit.unitKind !== 'summon' || spirit.displayName !== '魂魄') return;
  return [{ type: 'lose-life', source: baiSource(baitongziIds.ultimate, spirit.summonedByUnitId ?? spirit.unitId),
    targetId: spirit.unitId, amount: spirit.hp, lifeLossKind: 'direct', parentEventId: event.eventId }];
}

function whiteProtectionCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>): EffectCommand {
  const source = baiSource(baitongziIds.ultimate, owner.unitId);
  const instance: StatusInstance = { instanceId: `${baitongziIds.whiteProtection}:${owner.unitId}:${target.unitId}`,
    statusId: baitongziIds.whiteProtection, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'resist', operation: 'percent', amount: .4 }], values: { blocksNextDamage: true } };
  return { type: 'add-status', source, targetId: target.unitId, instance };
}

function spiritLifetimeStatus(ownerId: string, spiritId: string): StatusInstance {
  const source = baiSource(baitongziIds.ultimate, ownerId);
  return { instanceId: `${baitongziIds.spiritLifetime}:${spiritId}`, statusId: baitongziIds.spiritLifetime,
    source, stacks: 1, duration: { kind: 'permanent' } };
}

function baiIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function skillIndex(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(0, Math.min(4, (unit.skillLevels?.[skillId] ?? unit.skillLevel) - 1));
}
function baiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
