import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import { lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const inabaKaguyaHimeIds = { hero: 372, basic: '3721', realm: '3722', ultimate: '3723', moonFeast: '3724',
  wish: 'status.hero.372.wish', realmStatus: 'status.hero.372.moon-realm', blessing: 'status.hero.372.wish-blessing',
  wishPower: 'status.hero.372.wish-power', wishShield: 'status.hero.372.wish-shield',
  realmDiscount: 'status.hero.372.realm-discount', wishAccess: 'status.hero.372.wish-access' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

export function registerInabaKaguyaHime(registry: ContentRegistry): void {
  const ids = inabaKaguyaHimeIds;
  const statuses: StatusDefinition[] = [
    { id: ids.wish, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 8 },
    { id: ids.realmStatus, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: ids.blessing, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: ids.wishPower, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 25 },
    { id: ids.wishShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 8 },
    { id: ids.realmDiscount, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: ids.wishAccess, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace', maxStacks: 8, policyResourceBonus: { resourceId: 'fire', amount: 1 } },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basicTemplate = createBasicAttackSkill(ids.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate };
  const realm: SkillDefinition = { id: ids.realm, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{}, {}, {}, {}, {}], canUse(state, actor) {
      return actor.hp > 0 && actor.heroId === ids.hero && isFirstInaba(state, actor);
    },
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: actor.statuses.some(status => status.statusId === ids.realmDiscount) ? 1 : 2 }; },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.heroId !== ids.hero || !isFirstInaba(context.state, owner)) return [];
      return openRealm(context, owner, false);
    } };
  const ultimate: SkillDefinition = { id: ids.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: 1.38 }], canUse(_state, actor) { return actor.hp > 0 && actor.heroId === ids.hero; },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.heroId !== ids.hero) return [];
      return ultimateCommands(context, owner, ids.ultimate);
    } };
  registry.registerHero({ id: ids.hero, skills: [basic, realm, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3721至3724技能/状态行接入幻境、愿力、愿佑、团队愿力抵火、群攻邀战及满级阈值效果。因幡兔伤害与幻境御魂产火转换已接入；愿力累计提供计数、精确邀战插队、唯一效果持有者、护盾层覆盖和御魂顺序仍待连续帧核验。'],
    aiCoverageNotes: ['按社区AI：无幻境或幻境剩余1回合时用2技能，否则用3技能；3技能选生命上限最低敌人并优先站位靠前。鬼火不足但可用愿力替代的AI判定及残局目标仍需帧核。'],
    handlers: {
      'battle-start': { priority: 40, handle(context, event) { return startBattle(context, event); } },
      'turn-start': { priority: 40, handle(context, event) { return turnStart(context, event); } },
      'action-end': { priority: 40, handle(context, event) { return afterAllySkill(context, event); } },
      'effect-resolution': { priority: 39, handle(context, event) { return handleEffectResolution(context, event); } },
      'resource-payment': { priority: 38, handle(context, event) { return handleResourcePayment(context, event); } },
      'attack-end': { priority: 38, handle(context, event) { return inviteBlessedAllies(context, event, registry); } },
      'unit-defeated': { priority: 38, handle(context, event) { return removeDefeatedRealm(context, event); } },
    },
    resolveActionAdjustment(state, actor, skill) {
      if (skill.actionKind !== 'skill' || actor.hp <= 0) return undefined;
      const owner = state.sides[actor.side].map(unitId => state.units[unitId]).find(unit => unit && isInaba(unit)
        && unit.statuses.some(status => status.statusId === ids.realmStatus)
        && unit.statuses.some(status => status.statusId === ids.wish && status.stacks > 0));
      if (!owner) return undefined;
      return { resourceCostSubstitutions: [{ resourceId: 'fire', statusId: ids.wish, sourceUnitId: owner.unitId,
        whenInsufficient: true, linkedStatusId: ids.wishAccess, recordStatusId: ids.wishPower }] };
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.heroId !== ids.hero) return undefined;
      const realmStatus = actor.statuses.find(status => status.statusId === ids.realmStatus);
      if (!isFirstInaba(context.state, actor)) {
        const enemy = lowestHealthEnemy(context, actor);
        return enemy ? lineupIntent(unitId, ids.basic, [enemy.unitId], 'single') : undefined;
      }
      if (!realmStatus || (realmStatus.duration.kind === 'count' && realmStatus.duration.remaining <= 1))
        return { actorId: unitId, skillId: ids.realm, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => maxHp(context, a) - maxHp(context, b)
        || formationIndex(context, a.unitId) - formationIndex(context, b.unitId))[0]!;
      return lineupIntent(unitId, ids.ultimate, [target.unitId], 'all-enemies');
    },
  });
}

function startBattle(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const owner = context.getLivingUnits(side).find(unit => isInaba(unit));
    if (!owner) continue;
    if (!owner.statuses.some(status => status.statusId === inabaKaguyaHimeIds.wishPower)) {
      const source = inabaSource(inabaKaguyaHimeIds.ultimate, owner.unitId);
      commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
        instance: { instanceId: `${inabaKaguyaHimeIds.wishPower}:${owner.unitId}`, statusId: inabaKaguyaHimeIds.wishPower,
          source, stacks: 1, duration: { kind: 'permanent' } } });
    }
    if (rank(owner, inabaKaguyaHimeIds.realm) >= 5) commands.push(...openRealm(context, owner, true));
  }
  return commands.length ? commands : undefined;
}

function openRealm(context: BattleContext, owner: Readonly<UnitState>, free: boolean): EffectCommand[] {
  const ids = inabaKaguyaHimeIds;
  const source = inabaSource(ids.realm, owner.unitId);
  const turns = rank(owner, ids.realm) >= 4 ? 2 : 1;
  const commands: EffectCommand[] = [];
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${ids.realmStatus}:${owner.unitId}`,
    statusId: ids.realmStatus, source, stacks: 1, duration: { kind: 'count', remaining: turns, owner: 'source-turn' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .8 }] } });
  addWish(commands, owner, 3, ids.realm);
  const wish = owner.statuses.find(status => status.statusId === ids.wish)?.stacks ?? 0;
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${ids.wishAccess}:${owner.unitId}`,
    statusId: ids.wishAccess, source, stacks: Math.min(8, wish + Math.min(3, 8 - wish)),
    duration: { kind: 'count', remaining: turns, owner: 'source-turn' } } });
  return commands;
}

function turnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started' || event.scheduling === 'extra-turn') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isInaba(owner) || rank(owner, inabaKaguyaHimeIds.realm) < 3
    || !owner.statuses.some(status => status.statusId === inabaKaguyaHimeIds.realmStatus)) return;
  const commands: EffectCommand[] = [];
  addWish(commands, owner, 3, inabaKaguyaHimeIds.realm);
  return commands;
}

function addWish(commands: EffectCommand[], owner: Readonly<UnitState>, amount: number, sourceId: string): void {
  const current = owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wish);
  const add = Math.min(amount, 8 - (current?.stacks ?? 0));
  if (add <= 0) return;
  const source = inabaSource(sourceId, owner.unitId);
  if (!current) commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${inabaKaguyaHimeIds.wish}:${owner.unitId}`,
    statusId: inabaKaguyaHimeIds.wish, source, stacks: add, duration: { kind: 'permanent' } } });
  else commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId, instanceId: current.instanceId, amount: add });
  if (owner.statuses.some(status => status.statusId === inabaKaguyaHimeIds.realmStatus)) {
    const access = owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wishAccess);
    const next = Math.min(8, (current?.stacks ?? 0) + add);
    if (access) commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId, instanceId: access.instanceId,
      amount: next - access.stacks });
    else commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${inabaKaguyaHimeIds.wishAccess}:${owner.unitId}`,
      statusId: inabaKaguyaHimeIds.wishAccess, source, stacks: next,
      duration: { kind: 'count', remaining: owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.realmStatus)?.duration.kind === 'count'
        ? (owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.realmStatus)!.duration as { kind: 'count'; remaining: number }).remaining : 1,
        owner: 'source-turn' } } });
  }
}

function afterAllySkill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const ally = context.getUnit(event.source.unitId);
  if (ally && event.skillId === inabaKaguyaHimeIds.realm && isInaba(ally)) {
    const discount = ally.statuses.find(status => status.statusId === inabaKaguyaHimeIds.realmDiscount);
    return discount ? [{ type: 'remove-status-instances', source: inabaSource(inabaKaguyaHimeIds.realm, ally.unitId),
      targetId: ally.unitId, instanceIds: [discount.instanceId], reason: 'consumed', parentEventId: event.eventId }] : undefined;
  }
  if (event.actionKind !== 'skill' || event.source.id === inabaKaguyaHimeIds.realm) return;
  if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  const owner = context.getLivingUnits(ally.side).find(unit => isInaba(unit)
    && unit.statuses.some(status => status.statusId === inabaKaguyaHimeIds.realmStatus));
  if (!owner || owner.unitId === ally.unitId) return;
  const source = inabaSource(inabaKaguyaHimeIds.realm, owner.unitId);
  const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  return [{ type: 'add-status', source, targetId: ally.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${inabaKaguyaHimeIds.blessing}:${owner.unitId}:${ally.unitId}`,
      statusId: inabaKaguyaHimeIds.blessing, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'critDamage', operation: 'flat', amount: Math.min(1.2, ownerStats.critDamage * .3) },
        { stat: 'defense', operation: 'flat', amount: Math.min(200, ownerStats.defense * .3) }] } }];
}

function convertSoulFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after <= event.before
    || event.source.kind !== 'soul' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0) return;
  const owner = context.getLivingUnits(actor.side).find(unit => isInaba(unit)
    && rank(unit, inabaKaguyaHimeIds.realm) >= 2 && unit.statuses.some(status => status.statusId === inabaKaguyaHimeIds.realmStatus));
  if (!owner) return;
  const count = Math.min(8 - (owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wish)?.stacks ?? 0), event.after - event.before);
  if (count <= 0) return;
  const commands: EffectCommand[] = [];
  const current = owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wish);
  const source = inabaSource(inabaKaguyaHimeIds.realm, owner.unitId);
  if (!current) commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${inabaKaguyaHimeIds.wish}:${owner.unitId}`, statusId: inabaKaguyaHimeIds.wish,
      source, stacks: count, duration: { kind: 'permanent' } } });
  else commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId, instanceId: current.instanceId,
    amount: count, parentEventId: event.eventId });
  const access = owner.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wishAccess);
  if (access) commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId,
    instanceId: access.instanceId, amount: count, parentEventId: event.eventId });
  commands.push({ type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: -count, parentEventId: event.eventId });
  return commands;
}

function onWishProvided(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-stacks-changed' || event.statusId !== inabaKaguyaHimeIds.wishPower || !event.targetId) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || !isInaba(owner)) return;
  const ids = inabaKaguyaHimeIds, provided = Math.max(0, event.after - 1), delta = Math.max(0, event.after - event.before);
  const source = inabaSource(ids.ultimate, owner.unitId);
  const commands: EffectCommand[] = [];
  const modifiers = rank(owner, ids.ultimate) >= 2
    ? [{ stat: 'critDamage' as const, operation: 'flat' as const, amount: Math.min(1.2, provided * .05) }] : [];
  const current = owner.statuses.find(status => status.statusId === ids.wishPower);
  if (current && modifiers.length) commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { ...current, stacks: event.after, modifiers } });
  if (delta > 0 && rank(owner, ids.ultimate) >= 3) {
    const maxHp = context.getEffectiveStats(owner.unitId)?.hp ?? owner.stats.hp;
    for (let index = 0; index < delta; index++) commands.push({ type: 'add-status', source, targetId: owner.unitId,
      parentEventId: event.eventId, instance: { instanceId: `${ids.wishShield}:${owner.unitId}:${event.eventId}:${index}`,
        statusId: ids.wishShield, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        values: { shieldRemaining: maxHp * .12 } } });
  }
  return commands.length ? commands : undefined;
}

function handleResourcePayment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(convertSoulFire(context, event) ?? []), ...(onWishProvided(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function handleEffectResolution(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'status-removed' && event.statusId === inabaKaguyaHimeIds.realmStatus) {
    const owner = context.getUnit(event.targetId);
    const access = owner?.statuses.find(status => status.statusId === inabaKaguyaHimeIds.wishAccess);
    return owner && access ? [{ type: 'remove-status-instances', source: inabaSource(inabaKaguyaHimeIds.realm, owner.unitId),
      targetId: owner.unitId, instanceIds: [access.instanceId], reason: 'consumed', parentEventId: event.eventId }] : undefined;
  }
  return convertSoulFire(context, event);
}

function removeDefeatedRealm(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isInaba(owner)) return;
  const statuses = owner.statuses.filter(status => status.statusId === inabaKaguyaHimeIds.realmStatus
    || status.statusId === inabaKaguyaHimeIds.wishAccess);
  if (!statuses.length) return;
  return [{ type: 'remove-status-instances', source: inabaSource(inabaKaguyaHimeIds.realm, owner.unitId),
    targetId: owner.unitId, instanceIds: statuses.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId }];
}

function inviteBlessedAllies(context: BattleContext, event: BattleEvent, registry: ContentRegistry): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== inabaKaguyaHimeIds.ultimate || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || !isInaba(owner)) return;
  const target = (event.targetHealthChanges ?? []).map(change => context.getUnit(change.targetId)).find(unit => unit?.hp && unit.side !== owner.side);
  if (!target) return;
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitId === owner.unitId || ally.unitKind === 'summon'
      || !ally.statuses.some(status => status.statusId === inabaKaguyaHimeIds.blessing && status.source.unitId === owner.unitId)) continue;
    const hero = registry.getHero(ally.heroId);
    const basic = hero?.skills.find(skill => skill.actionKind === 'basic') ?? hero?.skills.find(skill => skill.id === `${ally.heroId}1`);
    if (!basic) continue;
    commands.push({ type: 'schedule-action', source: inabaSource(inabaKaguyaHimeIds.ultimate, owner.unitId),
      intent: { actorId: ally.unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' },
      scheduling: 'assist', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function ultimateCommands(context: BattleContext, owner: Readonly<UnitState>, skillId: string): EffectCommand[] {
  const ids = inabaKaguyaHimeIds;
  const current = owner.statuses.find(status => status.statusId === ids.wish);
  const provisioned = Math.max(0, (owner.statuses.find(status => status.statusId === ids.wishPower)?.stacks ?? 1) - 1);
  const commands: EffectCommand[] = attackAll(context, owner, skillId, 1.38, provisioned >= 12);
  const source = inabaSource(skillId, owner.unitId);
  commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { instanceId: `${ids.realmDiscount}:${owner.unitId}`, statusId: ids.realmDiscount, source, stacks: 1,
      duration: { kind: 'permanent' } } });
  if (rank(owner, ids.ultimate) >= 5 && provisioned >= 24) for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) {
    commands.push(...attack(context, owner, enemy, 1.53, ids.moonFeast, true));
  }
  return commands;
}

function attackAll(context: BattleContext, owner: Readonly<UnitState>, skillId: string, ratio: number, suppressTriggers: boolean): EffectCommand[] {
  return context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').map(target => attack(context, owner, target, ratio, skillId, suppressTriggers)[0]!);
}

function attack(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, skillId: string,
  suppressTriggers = false): EffectCommand[] {
  const atk = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const def = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: atk.attack, defense: def.defense, defenseIgnore: effectiveDefenseIgnore(owner), ratio,
    critChance: atk.crit, critDamage: atk.critDamage }, owner, target);
  return [{ type: 'deal-damage', source: inabaSource(skillId, owner.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, atk.critDamage) } : {}),
    ...(suppressTriggers ? { suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
      suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true } : {}) }];
}

function rank(owner: Readonly<UnitState>, id: string): number { return Math.max(1, Math.min(6, owner.skillLevels?.[id] ?? owner.skillLevel)); }
function isInaba(owner: Readonly<UnitState>): boolean { return owner.heroId === inabaKaguyaHimeIds.hero && owner.unitKind !== 'summon'; }
function inabaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function formationIndex(context: BattleContext, unitId: string): number {
  const unit = context.getUnit(unitId);
  return unit ? context.state.sides[unit.side].indexOf(unitId) : Number.MAX_SAFE_INTEGER;
}
function maxHp(context: BattleContext, unit: Readonly<UnitState>): number {
  return context.getEffectiveStats(unit.unitId)?.hp ?? unit.stats.hp;
}

function isFirstInaba(state: import('../core/types').BattleState, actor: Readonly<UnitState>): boolean {
  return state.sides[actor.side].map(unitId => state.units[unitId]).find(unit => unit && isInaba(unit))?.unitId === actor.unitId;
}
