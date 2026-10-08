import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const shuraKidomaruIds = {
  hero: 396, basic: '3961', trapSkill: '3962', citySkill: '3963', unique: 'status.hero.396.unique',
  trap: 'status.hero.396.hunting-trap', soulNet: 'status.hero.396.soul-net', delirium: 'status.hero.396.delirium',
  forcedAttack: 'status.hero.396.forced-attack', actionLock: 'status.hero.396.action-lock',
} as const;

const basicRatios = [.5, .53, .56, .59, .62] as const;
const cityRatios = [.77, .86, .95, .95, .95] as const;

/** Shura Kidomaru's currently modeled skill and passive rules. Target priority and the Lv.5 pursuit follow-up remain partial. */
export function registerShuraKidomaru(registry: ContentRegistry): void {
  const status = (id: string, fields: Omit<Parameters<ContentRegistry['registerStatus']>[0], 'id'>) => registry.registerStatus({
    id, mechanicsCoverage: 'partial', ...fields,
  });
  status(shuraKidomaruIds.unique, { dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  status(shuraKidomaruIds.trap, { dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep',
    protectsFromDirectTargeting: true });
  status(shuraKidomaruIds.soulNet, { category: 'mark', dispellable: false, sealable: false, durationOwner: 'permanent',
    refreshPolicy: 'replace', maxStacks: 3, controlProtection: 'immune' });
  status(shuraKidomaruIds.delirium, { category: 'debuff', dispellable: true, sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(shuraKidomaruIds.forcedAttack, { category: 'other', dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(shuraKidomaruIds.actionLock, { category: 'debuff', dispellable: true, sealable: true, durationOwner: 'target-turn',
    refreshPolicy: 'refresh-duration', preventsActionGaugeChange: true });
  registry.registerHero(createShuraKidomaruDefinition());
}

export function createShuraKidomaruDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: shuraKidomaruIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      const attack = actor && context.getEffectiveStats(actor.unitId); const defense = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !attack || !defense) return [];
      const source = shuraSource(shuraKidomaruIds.basic, actor.unitId);
      return Array.from({ length: 2 }, () => {
        const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
          ratio: Number(params.ratio ?? .5), critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
        return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
      });
    } };
  const trap: SkillDefinition = { id: shuraKidomaruIds.trapSkill, resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(level => ({ level })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      const source = shuraSource(shuraKidomaruIds.trapSkill, actor.unitId);
      const net = netStatus(actor); const gain = Number(params.level) >= 5 ? 3 : 2;
      const commands: EffectCommand[] = [];
      if (hasStatus(actor, shuraKidomaruIds.unique)) commands.push({ type: 'remove-statuses', source, targetId: actor.unitId,
        statusIds: [shuraKidomaruIds.trap], reason: 'consumed' });
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: shuraKidomaruIds.delirium,
        baseChance: 1, duration: { kind: 'permanent' }, values: { ownerUnitId: actor.unitId } }));
      commands.push({ type: 'add-status', source, targetId: actor.unitId,
        instance: makeStatus(shuraKidomaruIds.soulNet, actor.unitId, source, { kind: 'permanent' },
          { reductions: Number(net?.values?.reductions ?? 0) }, Math.min(3, (net?.stacks ?? 0) + gain), netDamageModifier(actor, Math.min(3, (net?.stacks ?? 0) + gain))) });
      if (!net) commands.push({ type: 'change-action-gauge', source, targetId: actor.unitId, amount: 40 });
      return commands;
    } };
  const city: SkillDefinition = { id: shuraKidomaruIds.citySkill, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'multi', targetRelation: 'enemy', levels: cityRatios.map((ratio, index) => ({ ratio, level: index + 1, hits: 3 })),
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const stats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !stats) return [];
      const net = netStatus(actor); const area = Boolean(net); const targets = area
        ? context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
        : intent.targetIds.map(id => context.getUnit(id)).filter((target): target is NonNullable<typeof target> => Boolean(target && target.hp > 0));
      if (!targets.length) return [];
      const source = shuraSource(shuraKidomaruIds.citySkill, actor.unitId);
      const commands: EffectCommand[] = [];
      if (net && Number(params.level) >= 4) commands.push(netCommand(actor, net.source, Math.min(3, net.stacks + 1), Number(net.values?.reductions ?? 0)));
      for (const target of targets) {
        for (let hitIndex = 0; hitIndex < 3; hitIndex++) {
          const targetStats = context.getEffectiveStats(target.unitId); if (!targetStats) continue;
          const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
            ratio: Number(params.ratio ?? .77), critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
        }
      }
      if (!area) for (const target of targets) commands.push({ type: 'add-status', source, targetId: target.unitId,
        instance: makeStatus(shuraKidomaruIds.actionLock, `${actor.unitId}:${target.unitId}`, source,
          { kind: 'count', remaining: 2, owner: 'target-turn' }) });
      return commands;
    } };
  return { id: shuraKidomaruIds.hero, skills: [basic, trap, city], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['失魂按客户端等级表使用60%基础概率，陷阱技能三级起升至80%，并对怪物无效；回合开始强制普攻使用基础概率、施加者命中及目标抵抗判定；新目标抵抗时保留旧失魂标记，仅在成功附加后替换；魂网跨技能加层保持单一状态实例，减伤与四级追猎加层按对应技能等级判定；魂网减层和追猎不受被动封印影响；追猎绝击只抑制受击方御魂、保留攻击方御魂触发，修罗鬼童丸无法行动时不追加；陷阱刷新窗口仍待核验'],
    initialize(context, unitId) {
      const unit = context.getUnit(unitId); if (!unit) return [];
      const sameHero = context.state.sides[unit.side].map(id => context.getUnit(id)).filter(other => other?.heroId === shuraKidomaruIds.hero);
      if (sameHero[0]?.unitId !== unitId) return [];
      const source = shuraSource(shuraKidomaruIds.trapSkill, unitId);
      return [
        { type: 'add-status', source, targetId: unitId, instance: makeStatus(shuraKidomaruIds.unique, unitId, source, { kind: 'permanent' }) },
        { type: 'add-status', source, targetId: unitId, instance: makeStatus(shuraKidomaruIds.trap, unitId, source, { kind: 'permanent' }) },
      ];
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const net = netStatus(actor); const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (!net && fire >= 2) return intent(unitId, shuraKidomaruIds.trapSkill, [enemies[0]!.unitId], 'single');
      if (net && fire >= 3) return intent(unitId, shuraKidomaruIds.citySkill,
        net ? enemies.map(enemy => enemy.unitId) : [enemies[0]!.unitId], 'multi');
      return intent(unitId, shuraKidomaruIds.basic, [enemies[0]!.unitId], 'single');
    },
    handlers: {
      'effect-resolution': { priority: 110, handle(context, event) {
        if (event.type !== 'status-added' || event.instance.statusId !== shuraKidomaruIds.delirium) return;
        const ownerId = event.instance.source.unitId;
        const owner = ownerId && context.getUnit(ownerId);
        if (!owner) return;
        const oldMarks = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
          .filter(target => target.unitId !== event.targetId).flatMap(target => target.statuses
            .filter(status => status.statusId === shuraKidomaruIds.delirium
              && status.source.unitId === owner.unitId).map(status => ({ targetId: target.unitId, instanceId: status.instanceId })));
        return oldMarks.map(mark => ({ type: 'remove-status-instances' as const, source: event.instance.source,
          targetId: mark.targetId, instanceIds: [mark.instanceId], reason: 'replaced' as const, parentEventId: event.eventId }));
      } },
      'turn-start': { priority: 110, handle: (context, event) => onMarkTurnStart(context, event) },
      'turn-end': { priority: 110, handle: (context, event) => onNetDeplete(context, event) },
      'control-application': { priority: 110, handle: (context, event) => onControlBlocked(context, event) },
      hit: { priority: 110, handle: (context, event) => onCityHit(context, event) },
    } };
}

function onMarkTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const victim = context.getUnit(event.unitId); if (!victim || victim.hp <= 0) return;
  const delirium = victim.statuses.find(status => status.statusId === shuraKidomaruIds.delirium); if (!delirium) return;
  const owner = context.getUnit(String(delirium.values?.ownerUnitId ?? ''));
  const source = delirium.source;
  const oldForced = victim.statuses.find(status => status.statusId === shuraKidomaruIds.forcedAttack);
  const commands: EffectCommand[] = oldForced ? [{ type: 'remove-statuses', source, targetId: victim.unitId,
    statusIds: [shuraKidomaruIds.forcedAttack], reason: 'consumed', parentEventId: event.eventId }] : [];
  if (!owner || owner.hp <= 0 || !passivesEnabled(owner) || victim.unitKind === 'monster') return commands;
  const baseChance = skillRank(owner, shuraKidomaruIds.trapSkill) >= 3 ? .8 : .6;
  commands.push(...attemptDebuff(context, { source, targetId: victim.unitId, statusId: shuraKidomaruIds.forcedAttack,
    baseChance, duration: { kind: 'permanent' }, parentEventId: event.eventId,
    values: { controlType: 'forced-random-ally' } }));
  return commands;
}

function onCityHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== shuraKidomaruIds.citySkill || event.hpLost <= 0 || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId); if (!actor || actor.hp <= 0) return;
  return [{ type: 'heal', source: shuraSource(shuraKidomaruIds.citySkill, actor.unitId), targetId: actor.unitId, amount: event.hpLost * .5,
    parentEventId: event.eventId }];
}

function onNetDeplete(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.heroId !== shuraKidomaruIds.hero) return;
  return reduceNet(context, actor, event.eventId);
}

function onControlBlocked(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-blocked') return;
  const actor = context.getUnit(event.targetId); if (!actor || actor.heroId !== shuraKidomaruIds.hero || !netStatus(actor)) return;
  return reduceNet(context, actor, event.eventId);
}

function reduceNet(context: BattleContext, actor: NonNullable<ReturnType<BattleContext['getUnit']>>, parentEventId?: string): EffectCommand[] | undefined {
  const net = netStatus(actor); if (!net) return;
  const source = shuraSource(shuraKidomaruIds.trapSkill, actor.unitId);
  const lost = Number(net.values?.reductions ?? 0) + 1;
  const commands: EffectCommand[] = [net.stacks > 1
    ? netCommand(actor, source, net.stacks - 1, lost)
    : { type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [shuraKidomaruIds.soulNet], reason: 'consumed' }];
  if (net.stacks <= 1 && hasStatus(actor, shuraKidomaruIds.unique)) commands.push({ type: 'add-status', source, targetId: actor.unitId,
    instance: makeStatus(shuraKidomaruIds.trap, actor.unitId, source, { kind: 'permanent' }) });
  if (skillRank(actor, shuraKidomaruIds.citySkill) >= 5 && lost % 2 === 0 && !context.isUnitUnableToAct(actor.unitId)) {
    const targets = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
    const attack = context.getEffectiveStats(actor.unitId);
    if (targets.length && attack) {
      const hits = targets.flatMap(target => {
        const defense = context.getEffectiveStats(target.unitId); if (!defense) return [];
        return Array.from({ length: 2 }, () => {
          const base = attack.attack * .49;
          const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: .49, critChance: attack.crit,
            critDamage: attack.critDamage }, actor, target);
          return { targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
            ...(result.isCritical ? { criticalBaseAmount: base, isCritical: true } : {}) };
        });
      });
      if (hits.length) commands.push({ type: 'schedule-attack', source: shuraSource(shuraKidomaruIds.citySkill, actor.unitId), intent: { actorId: actor.unitId,
        skillId: shuraKidomaruIds.citySkill, targetIds: targets.map(target => target.unitId), shape: 'all-enemies',
        targetRelation: 'enemy', kind: 'skill' }, scheduling: 'extra-action', hits, suppressTargetSoulTriggers: true, parentEventId });
    }
  }
  if (parentEventId) return commands.map(command => ({ ...command, parentEventId }));
  return commands;
}

function netCommand(actor: NonNullable<ReturnType<BattleContext['getUnit']>>, source: SourceRef, stacks: number, reductions: number): EffectCommand {
  return { type: 'add-status', source, targetId: actor.unitId,
    instance: makeStatus(shuraKidomaruIds.soulNet, actor.unitId, source, { kind: 'permanent' }, { reductions }, stacks, netDamageModifier(actor, stacks)) };
}
function netDamageModifier(actor: NonNullable<ReturnType<BattleContext['getUnit']>>, stacks: number): StatusInstance['modifiers'] {
  const trapRank = skillRank(actor, shuraKidomaruIds.trapSkill);
  const rate = trapRank >= 4 ? .3 : trapRank >= 2 ? .2 : 0;
  return rate ? [{ stat: 'damageTaken', operation: 'percent', amount: -rate * stacks }] : undefined;
}
function skillRank(unit: { skillLevel: number; skillLevels?: Readonly<Record<string, number>> }, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isInteger(rank) ? Math.max(1, Math.min(5, rank!)) : Math.max(1, Math.min(5, unit.skillLevel));
}
function netStatus(unit: NonNullable<ReturnType<BattleContext['getUnit']>>): StatusInstance | undefined {
  return unit.statuses.find(status => status.statusId === shuraKidomaruIds.soulNet);
}
function hasStatus(unit: NonNullable<ReturnType<BattleContext['getUnit']>>, statusId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId);
}
function makeStatus(statusId: string, key: string, source: SourceRef, duration: StatusInstance['duration'],
  values: StatusInstance['values'] = {}, stacks = 1, modifiers?: StatusInstance['modifiers']): StatusInstance {
  return { instanceId: `${statusId}:${key}`, statusId, source, duration, stacks, values, ...(modifiers ? { modifiers } : {}) };
}
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}
function shuraSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
