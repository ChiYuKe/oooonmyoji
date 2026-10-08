import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const demonFoxIds = {
  hero: 254,
  basic: '2541',
  passive: '2542',
  ultimate: '2543',
  attack: 'status.hero.254.attack-stacks',
  followUpLock: 'status.hero.254.follow-up-lock',
} as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const ultimateRatios = [.66, .69, .72, .75, .78] as const;
const attackPerStack = [.02, .03, .04, .05, .06] as const;

export function registerDemonFox(registry: ContentRegistry): void {
  registry.registerStatus({ id: demonFoxIds.attack, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 10 });
  registry.registerStatus({ id: demonFoxIds.followUpLock, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createDemonFoxDefinition());
}

export function createDemonFoxDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(demonFoxIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: demonFoxIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, hitsPerCast: 2, repeatChance: .5, maxCasts: 10 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!owner || !target) return [];
      const ratio = Number(parameters.ratio ?? .66);
      const hitCount = Math.max(2, Math.floor(Number(parameters.hitsPerCast ?? 2)));
      const maxCasts = Math.max(1, Math.min(10, Math.floor(Number(parameters.maxCasts ?? 10))));
      let casts = 1;
      while (casts < maxCasts && context.random() < Number(parameters.repeatChance ?? .5)) casts++;
      const source = foxSource(demonFoxIds.ultimate, owner.unitId);
      const commands: EffectCommand[] = [];
      for (let cast = 0; cast < casts; cast++) {
        for (let hit = 0; hit < hitCount; hit++) {
          const liveOwner = context.getUnit(owner.unitId);
          const liveTarget = context.getUnit(target.unitId);
          if (!liveOwner || liveOwner.hp <= 0 || !liveTarget || liveTarget.hp <= 0) break;
          const attack = context.getEffectiveStats(liveOwner.unitId) ?? liveOwner.stats;
          const defense = context.getEffectiveStats(liveTarget.unitId)?.defense ?? liveTarget.stats.defense;
          const damage = context.calculateDamage({ attack: attack.attack, defense,
            defenseIgnore: effectiveDefenseIgnore(liveOwner), ratio,
            critChance: attack.crit, critDamage: attack.critDamage }, liveOwner, liveTarget);
          commands.push({ type: 'deal-damage', source, targetId: liveTarget.unitId, amount: damage.amount,
            ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        }
      }
      return commands;
    },
  };
  return {
    id: demonFoxIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能表接入风刃倍率、狂风刃卷3火/每次两段/50%重复施放（至多10次），以及造成伤害叠加攻击（每层2%至6%、最多10层）和目标生命高于50%时每次攻击至多一次的50%概率追击；追击触发时点、封印边界与实战帧仍待确认'],
    handlers: { hit: { priority: 32, handle(context, event) { return onDemonFoxHit(context, event); } } },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const skillId = (context.state.resources[owner.side]?.fire ?? 0) >= 3 ? demonFoxIds.ultimate : demonFoxIds.basic;
      return { actorId: owner.unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function onDemonFoxHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || !event.source.unitId
    || ![demonFoxIds.basic, demonFoxIds.ultimate].includes(event.source.id as typeof demonFoxIds.basic)) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== demonFoxIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const commands: EffectCommand[] = [];
  const previous = owner.statuses.find(status => status.statusId === demonFoxIds.attack);
  const stacks = Math.min(10, (previous?.stacks ?? 0) + 1);
  const attackStatus: StatusInstance = { instanceId: `${demonFoxIds.attack}:${owner.unitId}`,
    statusId: demonFoxIds.attack, source: foxSource(demonFoxIds.passive, owner.unitId), stacks,
    duration: { kind: 'permanent' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: attackPerStack[Math.max(0, Math.min(4, skillRank(owner) - 1))]!, perStack: true }] };
  commands.push({ type: 'add-status', source: attackStatus.source, targetId: owner.unitId,
    instance: attackStatus, parentEventId: event.eventId });

  if (event.source.id === demonFoxIds.passive || !target || target.hp <= 0 || !event.attackId
    || target.hp / Math.max(1, target.stats.hp) <= .5) return commands;
  const lock = owner.statuses.find(status => status.statusId === demonFoxIds.followUpLock);
  if (Number(lock?.values?.attackId) === event.attackId) return commands;
  const lockSource = foxSource(demonFoxIds.passive, owner.unitId);
  commands.push({ type: 'add-status', source: lockSource, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${demonFoxIds.followUpLock}:${owner.unitId}`, statusId: demonFoxIds.followUpLock,
      source: lockSource, stacks: 1, duration: { kind: 'permanent' }, values: { attackId: event.attackId } } });
  if (context.random() >= .5) return commands;
  const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
  const ratio = event.source.id === demonFoxIds.basic
    ? basicRatios[Math.max(0, Math.min(4, skillRank(owner) - 1))]!
    : ultimateRatios[Math.max(0, Math.min(4, skillRank(owner) - 1))]!;
  const damage = context.calculateDamage({ attack: ownerStats.attack
      + owner.stats.attack * attackPerStack[Math.max(0, Math.min(4, skillRank(owner) - 1))]!, defense: targetStats.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: ownerStats.crit,
    critDamage: ownerStats.critDamage }, owner, target);
  const source = foxSource(demonFoxIds.passive, owner.unitId);
  return [...commands, { type: 'schedule-attack', source, parentEventId: event.eventId, scheduling: 'counter',
    intent: { actorId: owner.unitId, skillId: demonFoxIds.passive, targetIds: [target.unitId],
      shape: 'single', targetRelation: 'enemy', kind: 'passive' }, suppressSourcePassiveTriggers: true,
    hits: [{ targetId: target.unitId, amount: damage.amount,
      ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }] }];
}

function skillRank(owner: Readonly<UnitState>): number {
  return Math.max(1, Math.min(5, Math.floor(owner.skillLevels?.[demonFoxIds.passive] ?? owner.skillLevel)));
}

function foxSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
