import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const ghostKingShutenIds = {
  hero: 341, basic: '3411', passive: '3412', ultimate: '3413', stanceBasic: '34141',
  aura: 'status.hero.341.great-demon-power', controlImmunity: 'status.hero.341.red-lotus',
  stance: 'status.hero.341.ghost-king-stance', fireField: 'status.hero.341.burning-sea', fireGuard: 'status.hero.341.fire-guard',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const stanceRatios = [1.96, 2.06, 2.16, 2.26, 2.45] as const;
const splashRatios = [.2, .25, .3, .35, .4] as const;
const healingTakenPenalty = [.5, .4, .3, .3, .3] as const;
const gaugePush = [30, 30, 30, 40, 40] as const;
const dispelCount = [1, 2, 2, 2, 2] as const;

export function registerGhostKingShuten(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: ghostKingShutenIds.aura, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: ghostKingShutenIds.controlImmunity, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'immune' },
    { id: ghostKingShutenIds.stance, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: ghostKingShutenIds.fireField, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: ghostKingShutenIds.fireGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: ghostKingShutenIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, stanceRatio: stanceRatios[index]!, splashRatio: splashRatios[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== ghostKingShutenIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const stance = actor.statuses.find(status => status.statusId === ghostKingShutenIds.stance);
      if (!stance) return strike(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
      const ratio = Number(parameters.stanceRatio ?? stanceRatios[rank(actor, basic.id) - 1]!);
      return strike(context, actor, target, ghostKingShutenIds.stanceBasic, ratio);
    } };
  const passive: SkillDefinition = { id: ghostKingShutenIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: healingTakenPenalty.map((penalty, index) => ({ healingTaken: 1 - penalty, selfMultiplier: index >= 4 ? 2 : 1,
      damageReduction: index >= 2 ? 1 : 0 })), canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: ghostKingShutenIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: gaugePush.map((push, index) => ({ push, dispel: dispelCount[index]!, duration: 2, damageHealRatio: index >= 2 ? .2 : 0,
      fireBurn: .24, clearLowHpControls: index >= 4 })),
    canUse(_state, actor) { return actor.heroId === ghostKingShutenIds.hero
      && !actor.statuses.some(status => status.statusId === ghostKingShutenIds.stance); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== ghostKingShutenIds.hero || actor.hp <= 0) return [];
      const source = shutenSource(ultimate.id, actor.unitId), level = rank(actor, ultimate.id), commands: EffectCommand[] = [];
      for (const enemy of context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')) {
        commands.push({ type: 'change-action-gauge', source, targetId: enemy.unitId, amount: -Number(parameters.push ?? gaugePush[level - 1]!) });
        const buffs = enemy.statuses.filter(status => context.getStatusCategory(status.statusId) === 'buff' && context.isStatusDispellable(status.statusId));
        if (buffs.length) commands.push({ type: 'dispel-statuses', source, targetId: enemy.unitId,
          instanceIds: buffs.slice(0, Number(parameters.dispel ?? dispelCount[level - 1]!)).map(status => status.instanceId),
          maxCount: Number(parameters.dispel ?? dispelCount[level - 1]!) });
      }
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${ghostKingShutenIds.stance}:${actor.unitId}`, statusId: ghostKingShutenIds.stance, source, stacks: 1,
        duration: { kind: 'count', remaining: Number(parameters.duration ?? 2), owner: 'target-turn' }, values: { damageTotal: 0 },
      } });
      const fieldSource = shutenSource(ghostKingShutenIds.ultimate, actor.unitId);
      for (const ally of context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon')) commands.push({
        type: 'add-status', source: fieldSource, targetId: ally.unitId, instance: {
          instanceId: `${ghostKingShutenIds.fireField}:${actor.unitId}:${ally.unitId}`, statusId: ghostKingShutenIds.fireField,
          source: fieldSource, stacks: 1, duration: { kind: 'count', remaining: Number(parameters.duration ?? 2), owner: 'source-turn' },
          values: { burn: Number(parameters.fireBurn ?? .24), healRatio: Number(parameters.damageHealRatio ?? (level >= 3 ? .2 : 0)),
            clearLowHpControls: Boolean(parameters.clearLowHpControls ?? level >= 5) },
        },
      });
      return commands;
    } };

  const definition: HeroDefinition = {
    id: ghostKingShutenIds.hero, skills: [basic, passive, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能行接入焚天普攻100%至125%；红莲被动使自身免疫控制并降低受到治疗，友方大妖之力按已损生命比例提高伤害（三级起并提高减伤），五级自身效果翻倍。天火怒焱耗3火、击退敌方全体30%/40%行动条、驱散1/2个增益并进入2回合鬼王姿态；姿态下普攻替换为196%至245%伤害并对其他敌人造成主目标实际命中伤害20%至40%的间接溅射。姿态期间友方回合开始灼烧当前生命24%并获得伤害免疫至下次自身回合开始；三级起姿态结束全队恢复鬼王期间造成伤害的20%，五级灼烧低于30%生命的友方时解除控制。行动条实际推移及姿态结束恢复的伤害统计口径仍需帧核验；鬼王酒吞童子不在10点场阵容。'],
    initialize(context, unitId) { return initializeShuten(context, unitId); },
    handlers: {
      'turn-start': { priority: 341, handle(context, event) { return resolveBurningSea(context, event); } },
      hit: { priority: 341, handle(context, event) { return updateAuraAfterHpChange(context, event); } },
      'turn-end': { priority: 341, handle(context, event) { return resolveStanceEnd(context, event); } },
      'status-expiration': { priority: 341, handle(context, event) { return clearExpiredField(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== ghostKingShutenIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      if (!actor.statuses.some(status => status.statusId === ghostKingShutenIds.stance) && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: ultimate.id, targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = enemies.slice().sort((a, b) => b.hp / Math.max(1, b.stats.hp) - a.hp / Math.max(1, a.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function initializeShuten(context: BattleContext, unitId: string): EffectCommand[] {
  const owner = context.getUnit(unitId);
  if (!owner || owner.heroId !== ghostKingShutenIds.hero || !passivesEnabled(owner)) return [];
  const level = rank(owner, ghostKingShutenIds.passive), firstOwner = context.getLivingUnits(owner.side)
    .find(unit => unit.heroId === ghostKingShutenIds.hero && passivesEnabled(unit));
  const commands: EffectCommand[] = [{ type: 'add-status', source: shutenSource(ghostKingShutenIds.passive, owner.unitId),
    targetId: owner.unitId, instance: { instanceId: `${ghostKingShutenIds.controlImmunity}:${owner.unitId}`,
      statusId: ghostKingShutenIds.controlImmunity, source: shutenSource(ghostKingShutenIds.passive, owner.unitId), stacks: 1,
      duration: { kind: 'permanent' }, modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -healingTakenPenalty[level - 1]! }] } }];
  if (firstOwner?.unitId !== owner.unitId) return commands;
  for (const ally of context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon'))
    commands.push(auraCommand(owner, ally, level));
  return commands;
}

function resolveBurningSea(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const ally = context.getUnit(event.unitId); if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  const fields = ally.statuses.filter(status => status.statusId === ghostKingShutenIds.fireField);
  const commands: EffectCommand[] = [];
  for (const field of fields) {
    const owner = context.getUnit(field.source.unitId ?? '');
    const stance = owner?.statuses.find(status => status.statusId === ghostKingShutenIds.stance);
    const oldGuard = ally.statuses.find(status => status.statusId === ghostKingShutenIds.fireGuard && status.source.unitId === field.source.unitId);
    if (oldGuard) commands.push({ type: 'remove-status-instances', source: oldGuard.source, targetId: ally.unitId,
      instanceIds: [oldGuard.instanceId], reason: 'consumed', parentEventId: event.eventId });
    if (!owner || owner.hp <= 0 || !stance) {
      commands.push({ type: 'remove-status-instances', source: field.source, targetId: ally.unitId,
        instanceIds: [field.instanceId], reason: 'consumed', parentEventId: event.eventId });
      continue;
    }
    const burn = Math.min(ally.hp, ally.hp * Number(field.values?.burn ?? .24));
    commands.push({ type: 'lose-life', source: field.source, targetId: ally.unitId, amount: burn, lifeLossKind: 'direct', parentEventId: event.eventId });
    const guardSource = shutenSource(ghostKingShutenIds.ultimate, owner.unitId);
    commands.push({ type: 'add-status', source: guardSource, targetId: ally.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${ghostKingShutenIds.fireGuard}:${owner.unitId}:${ally.unitId}`, statusId: ghostKingShutenIds.fireGuard,
      source: guardSource, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -1 }],
    } });
    if (Boolean(field.values?.clearLowHpControls) && (ally.hp - burn) / Math.max(1, ally.stats.hp) < .3) {
      const controls = ally.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
      if (controls.length) commands.push({ type: 'dispel-statuses', source: guardSource, targetId: ally.unitId,
        instanceIds: controls.map(status => status.instanceId), maxCount: controls.length, filter: 'debuff-or-control', parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function updateAuraAfterHpChange(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if ((event.type !== 'damage' && event.type !== 'life-lost' && event.type !== 'healing' && event.type !== 'health-restored')
    || !('targetId' in event)) return;
  const commands: EffectCommand[] = [];
  const target = context.getUnit(event.targetId);
  if (target && target.hp > 0) {
    const auras = target.statuses.filter(status => status.statusId === ghostKingShutenIds.aura);
    commands.push(...auras.map(aura => {
      const owner = context.getUnit(aura.source.unitId ?? '');
      return owner ? auraCommand(owner, target, rank(owner, ghostKingShutenIds.passive)) : undefined;
    }).filter((command): command is EffectCommand => command !== undefined));
  }
  if ((event.type === 'damage' || event.type === 'life-lost') && event.source.unitId
    && event.source.id === ghostKingShutenIds.stanceBasic) {
    const owner = context.getUnit(event.source.unitId);
    const stance = owner?.statuses.find(status => status.statusId === ghostKingShutenIds.stance);
    if (owner?.heroId === ghostKingShutenIds.hero && stance) {
      let totalDamage = event.type === 'damage' ? event.amount : event.hpLost;
      if (event.type === 'damage' && target) {
        const splashRatio = splashRatios[rank(owner, ghostKingShutenIds.basic) - 1]!;
        for (const enemy of context.getLivingUnits(target.side).filter(unit => unit.unitId !== target.unitId)) {
          totalDamage += Math.min(enemy.hp, event.amount * splashRatio);
          commands.push({ type: 'lose-life', source: shutenSource(ghostKingShutenIds.stanceBasic, owner.unitId),
            targetId: enemy.unitId, amount: event.amount * splashRatio, lifeLossKind: 'indirect', parentEventId: event.eventId });
        }
      }
      commands.push({ type: 'add-status', source: stance.source, targetId: owner.unitId, parentEventId: event.eventId,
        instance: { ...stance, values: { ...stance.values, damageTotal: Number(stance.values?.damageTotal ?? 0) + totalDamage } } });
    }
  }
  return commands.length ? commands : undefined;
}

function resolveStanceEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId); if (!owner || owner.heroId !== ghostKingShutenIds.hero) return;
  const stance = owner.statuses.find(status => status.statusId === ghostKingShutenIds.stance);
  if (!stance || stance.duration.kind !== 'count' || stance.duration.remaining > 1) return;
  const healRatio = Number(stance.values?.healRatio ?? (rank(owner, ghostKingShutenIds.ultimate) >= 3 ? .2 : 0));
  const healing = Number(stance.values?.damageTotal ?? 0) * healRatio;
  if (healing <= 0) return;
  return context.getLivingUnits(owner.side).map(ally => ({ type: 'heal' as const,
    source: shutenSource(ghostKingShutenIds.ultimate, owner.unitId), targetId: ally.unitId, amount: healing, parentEventId: event.eventId }));
}

function clearExpiredField(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== ghostKingShutenIds.stance) return;
  const ownerId = event.source.unitId; if (!ownerId) return;
  const commands: EffectCommand[] = [];
  for (const unit of Object.values(context.state.units)) for (const status of unit.statuses) {
    if ((status.statusId === ghostKingShutenIds.fireField || status.statusId === ghostKingShutenIds.fireGuard)
      && status.source.unitId === ownerId) commands.push({ type: 'remove-status-instances', source: status.source,
        targetId: unit.unitId, instanceIds: [status.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function auraCommand(owner: Readonly<UnitState>, ally: Readonly<UnitState>, level: number): EffectCommand {
  const source = shutenSource(ghostKingShutenIds.passive, owner.unitId), missing = Math.max(0, 1 - ally.hp / Math.max(1, ally.stats.hp));
  const selfMultiplier = ally.unitId === owner.unitId && level >= 5 ? 2 : 1;
  const damageReduction = level >= 3 ? 1 : 0;
  return { type: 'add-status', source, targetId: ally.unitId, instance: {
    instanceId: `${ghostKingShutenIds.aura}:${owner.unitId}:${ally.unitId}`, statusId: ghostKingShutenIds.aura, source,
    stacks: 1, duration: { kind: 'permanent' }, values: { selfMultiplier, damageReduction },
    modifiers: [{ stat: 'damage', operation: 'percent', amount: missing * selfMultiplier },
      ...(damageReduction ? [{ stat: 'damageTaken' as const, operation: 'percent' as const, amount: -missing }] : [])],
  } };
}

function strike(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: shutenSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function shutenSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
