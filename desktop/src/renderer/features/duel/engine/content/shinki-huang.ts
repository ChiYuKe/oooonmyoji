import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const shinkiHuangIds = {
  hero: 390, basic: '3901', realm: '3902', starfall: '3903',
  river: 'status.hero.390.fate-river', starPower: 'status.hero.390.star-power',
  enemyTurn: 'status.hero.390.enemy-turn-fire-check',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.15] as const;
const starfallRatios = [1.27, 1.39, 1.39, 1.39, 1.39] as const;
const extraRatios = [.56, .56, .68, .68, .68] as const;
const maxStarbursts = 6;

export function registerShinkiHuang(registry: ContentRegistry): void {
  registry.registerStatus({ id: shinkiHuangIds.river, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shinkiHuangIds.starPower, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: maxStarbursts });
  registry.registerStatus({ id: shinkiHuangIds.enemyTurn, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerHero(createShinkiHuangDefinition());
}

export function createShinkiHuangDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(shinkiHuangIds.basic, basicRatios);
  const realm: SkillDefinition = {
    id: shinkiHuangIds.realm, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{ triggerCount: maxStarbursts }],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.heroId !== shinkiHuangIds.hero || !isUniqueOwner(context.state, owner.unitId)) return [];
      return [addRiver(owner, maxStarbursts, shinkiHuangIds.realm)];
    },
  };
  const starfall: SkillDefinition = {
    id: shinkiHuangIds.starfall, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: starfallRatios.map((ratio, index) => ({
      ratio, extraRatio: extraRatios[index]!,
    })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.heroId !== shinkiHuangIds.hero) return [];
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0
        && unit.side !== owner.side));
      if (!targets.length) return [];
      const rank = skillRank(owner, shinkiHuangIds.starfall);
      const stacks = starPower(owner);
      const source = shinkiSource(shinkiHuangIds.starfall, owner.unitId);
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const commands: EffectCommand[] = [];
      for (const target of targets) {
        for (let hit = 0; hit <= stacks; hit++) {
          const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
          const ratio = hit === 0 ? Number(parameters.ratio ?? starfallRatios[rank - 1])
            : Number(parameters.extraRatio ?? extraRatios[rank - 1]);
          const damage = context.calculateDamage({ attack: attack.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
            actionKind: 'skill', damageKind: 'normal', isCritical: damage.isCritical,
            ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
            ...(damage.isCritical ? { criticalBaseAmount: damage.amount / Math.max(1, attack.critDamage) } : {}),
            ...(hit > 0 && rank >= 5 ? { suppressTargetSoulTriggers: true } : {}) });
        }
      }
      if (stacks > 0) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
        statusIds: [shinkiHuangIds.starPower], reason: 'consumed' });
      if (rank >= 4) commands.push(...extendRiver(owner, 3, source));
      return commands;
    },
  };

  return {
    id: shinkiHuangIds.hero, skills: [basic, realm, starfall], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['按可用客户端技能规则：无幻境且有2火时先开星罗云布；星辰之力达到3层且有3火时转用星流霆击。官方自动选招表及目标优先级仍未提取。'],
    mechanicsCoverageNotes: ['接入陨星等级伤害、四级先机星罗云布、命运星河最多6次星爆、敌方回合未消耗鬼火触发全体间接伤害/自疗/星辰之力、普通攻击延长次数、星流霆击消耗星辰之力并在四级幻境中续期。基础星爆逐级伤害提升、幻境中自身减伤、五级星爆被动屏蔽及额外伤害御魂屏蔽已按客户端技能行建模；星爆触发窗口、鬼火消耗判定及额外伤害的御魂屏蔽仍需实战帧核验。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== shinkiHuangIds.hero || skillRank(owner, shinkiHuangIds.realm) < 4
        || !isUniqueOwner(context.state, unitId) || !passivesEnabled(owner)) return [];
      return [addRiver(owner, maxStarbursts, shinkiHuangIds.realm)];
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const targetIds = enemies.map(unit => unit.unitId);
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (starPower(owner) >= 3 && fire >= 3) return intent(owner.unitId, shinkiHuangIds.starfall, targetIds, 'all-enemies');
      if (!hasRiver(owner) && fire >= 2) return intent(owner.unitId, shinkiHuangIds.realm, [owner.unitId], 'self', 'ally');
      const target = [...enemies].sort((a, b) => (a.hp / Math.max(1, a.stats.hp)) - (b.hp / Math.max(1, b.stats.hp)))[0]!;
      return intent(owner.unitId, shinkiHuangIds.basic, [target.unitId], 'single');
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (target.heroId === shinkiHuangIds.hero && hasRiver(target) && skillRank(target, shinkiHuangIds.realm) >= 3)
        return { amount: amount * .6, effects: [] };
      if (!attacker || attacker.side === target.side || interception?.actionKind !== 'basic') return undefined;
      const owner = state.sides[target.side].map(id => state.units[id]).find(unit => unit
        && unit.heroId === shinkiHuangIds.hero && unit.hp > 0 && hasRiver(unit) && isUniqueOwner(state, unit.unitId));
      return owner ? { amount: amount * .8, effects: [] } : undefined;
    },
    handlers: {
      'turn-start': { priority: 46, handle(context, event) { return markEnemyTurn(context, event); } },
      'resource-payment': { priority: 46, handle(context, event) { return trackFireSpend(context, event); } },
      'effect-resolution': { priority: 46, handle(context, event) { return extendFromBasic(context, event); } },
      'turn-end': { priority: 46, handle(context, event) { return resolveEnemyTurn(context, event); } },
    },
  };
}

function markEnemyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || isYinYangShi(actor)) return;
  const owner = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    .find(unit => unit.heroId === shinkiHuangIds.hero && hasRiver(unit) && isUniqueOwner(context.state, unit.unitId));
  if (!owner) return;
  const source = shinkiSource(shinkiHuangIds.realm, owner.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
    instanceId: `${shinkiHuangIds.enemyTurn}:${actor.unitId}`, statusId: shinkiHuangIds.enemyTurn, source,
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { fireSpent: false },
  }, parentEventId: event.eventId }];
}

function trackFireSpend(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  const tracker = actor?.statuses.find(status => status.statusId === shinkiHuangIds.enemyTurn);
  if (!actor || !tracker) return;
  return [{ type: 'add-status', source: tracker.source, targetId: actor.unitId,
    instance: { ...tracker, values: { ...tracker.values, fireSpent: true } }, parentEventId: event.eventId }];
}

function resolveEnemyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  const tracker = target?.statuses.find(status => status.statusId === shinkiHuangIds.enemyTurn);
  if (!target || !tracker) return;
  const owner = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
    .find(unit => unit.heroId === shinkiHuangIds.hero && unit.hp > 0 && hasRiver(unit) && isUniqueOwner(context.state, unit.unitId));
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source: tracker.source, targetId: target.unitId,
    statusIds: [shinkiHuangIds.enemyTurn], reason: 'consumed', parentEventId: event.eventId }];
  if (!owner || isYinYangShi(target) || tracker.values?.fireSpent === true) return commands;
  const field = owner.statuses.find(status => status.statusId === shinkiHuangIds.river);
  const remaining = Math.max(0, Math.min(maxStarbursts, Number(field?.values?.remaining ?? 0)));
  if (remaining <= 0) return commands;
  const burstSource = shinkiSource(shinkiHuangIds.realm, owner.unitId);
  const rank = skillRank(owner, shinkiHuangIds.realm);
  const burstCount = Number(field?.values?.burstCount ?? 0);
  const ratio = .72 * (1 + (rank >= 2 ? Math.min(.75, burstCount * .25) : 0));
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) {
    const defense = context.getEffectiveStats(enemy.unitId) ?? enemy.stats;
    const damage = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: 0, critDamage: attack.critDamage }, owner, enemy);
    commands.push({ type: 'deal-damage', source: burstSource, targetId: enemy.unitId, amount: damage.amount,
      damageKind: 'normal', actionKind: 'skill', ...(rank >= 5 ? { suppressTargetPassiveTriggers: true } : {}),
      parentEventId: event.eventId });
  }
  commands.push({ type: 'heal', source: burstSource, targetId: owner.unitId, amount: owner.stats.hp * .08,
    parentEventId: event.eventId }, ...addStarPower(owner, event.eventId));
  if (remaining <= 1) {
    commands.push({ type: 'remove-statuses', source: burstSource, targetId: owner.unitId,
      statusIds: [shinkiHuangIds.river], reason: 'expired', parentEventId: event.eventId });
    commands.push({ type: 'change-action-gauge', source: burstSource, targetId: owner.unitId, amount: 30,
      parentEventId: event.eventId });
  } else commands.push(addRiver(owner, remaining - 1, shinkiHuangIds.realm, burstCount + 1, event.eventId));
  return commands;
}

function extendFromBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== shinkiHuangIds.hero || skillRank(owner, shinkiHuangIds.basic) < 5) return;
  return extendRiver(owner, 1, shinkiSource(shinkiHuangIds.basic, owner.unitId), event.eventId);
}

function extendRiver(owner: Readonly<UnitState>, amount: number, source: SourceRef, parentEventId?: string): EffectCommand[] {
  const field = owner.statuses.find(status => status.statusId === shinkiHuangIds.river);
  if (!field) return [];
  const remaining = Math.min(maxStarbursts, Number(field.values?.remaining ?? 0) + amount);
  return [addRiver(owner, remaining, source.id, Number(field.values?.burstCount ?? 0), parentEventId)];
}

function addRiver(owner: Readonly<UnitState>, remaining: number, sourceSkillId: string, burstCount = 0,
  parentEventId?: string): EffectCommand {
  const source = shinkiSource(sourceSkillId, owner.unitId);
  return { type: 'add-status', source, targetId: owner.unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
    instanceId: `${shinkiHuangIds.river}:${owner.unitId}`, statusId: shinkiHuangIds.river, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { remaining: Math.max(0, Math.min(maxStarbursts, remaining)), burstCount },
  } };
}

function addStarPower(owner: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const current = starPower(owner);
  if (current >= maxStarbursts) return [];
  const source = shinkiSource(shinkiHuangIds.realm, owner.unitId);
  const instance: StatusInstance = { instanceId: `${shinkiHuangIds.starPower}:${owner.unitId}`,
    statusId: shinkiHuangIds.starPower, source, stacks: current + 1, duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance, parentEventId }];
}

function hasRiver(unit: Readonly<UnitState>): boolean { return unit.statuses.some(status => status.statusId === shinkiHuangIds.river); }
function starPower(unit: Readonly<UnitState>): number { return unit.statuses.find(status => status.statusId === shinkiHuangIds.starPower)?.stacks ?? 0; }
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function isYinYangShi(unit: Readonly<UnitState>): boolean { return unit.heroId >= 10 && unit.heroId <= 13; }
function isUniqueOwner(state: import('../core/types').BattleState, unitId: string): boolean {
  const unit = state.units[unitId];
  if (!unit || unit.heroId !== shinkiHuangIds.hero || unit.unitKind === 'summon' || !passivesEnabled(unit)) return false;
  const owner = state.sides[unit.side].map(id => state.units[id]).find(candidate => candidate && candidate.heroId === shinkiHuangIds.hero
    && candidate.unitKind !== 'summon' && candidate.hp > 0 && passivesEnabled(candidate));
  return owner?.unitId === unitId;
}
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation'] = 'enemy'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function shinkiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
