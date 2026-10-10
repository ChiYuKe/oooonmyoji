import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const shadowCrocIds = {
  hero: 375, basic: '3751', passive: '3752', ultimate: '3753',
  shadowprey: 'status.hero.375.shadowprey', shadowbind: 'status.hero.375.shadowbind',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const shadowpreyChance = [.4, .5, .5, .6, .6] as const;
const shadowpreyDamage = [.15, .15, .3, .3, .3] as const;
const aoeRatio = [.3, .3, .3, .3, .3] as const;
const finalRatio = [.6, .7, .7, .8, .8] as const;
const bindChance = [.2, .2, .35, .35, .5] as const;
const enemySide = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isShadowCroc = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === shadowCrocIds.hero;
const rank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));
const sourceFor = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });

export function registerShadowCroc(registry: ContentRegistry): void {
  const ids = shadowCrocIds;
  const statuses: StatusDefinition[] = [
    { id: ids.shadowprey, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 2 },
    { id: ids.shadowbind, mechanicsCoverage: 'partial', category: 'control', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basicTemplate = createBasicAttackSkill(ids.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate };
  const ultimate: SkillDefinition = {
    id: ids.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: .3 }, { ratio: .3 }, { ratio: .3 }, { ratio: .3 }, { ratio: .3 }],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isShadowCroc(owner) || owner.hp <= 0) return [];
      const targets = [...new Set(intent.targetIds)].map(id => context.getUnit(id))
        .filter((target): target is Readonly<UnitState> => Boolean(target && target.hp > 0 && target.side !== owner.side));
      const selectedId = intent.selectedTargetId ?? intent.targetIds[0];
      const source = sourceFor(ids.ultimate, owner.unitId);
      const commands: EffectCommand[] = [];
      // The skill first strikes all enemies twice, then finishes the selected enemy once.
      for (let hit = 0; hit < 2; hit++) {
        for (const target of targets) commands.push(damageCommand(context, owner, target, source, aoeRatio[rank(owner, ids.ultimate) - 1]!));
      }
      const selected = selectedId ? context.getUnit(selectedId) : undefined;
      if (selected && selected.hp > 0 && selected.side !== owner.side) {
        const skillRank = rank(owner, ids.ultimate);
        const hit = damageCommand(context, owner, selected, source, finalRatio[skillRank - 1]!);
        commands.push(hit);
        const control = attemptControl(context, { attemptId: `${ids.shadowbind}:${owner.unitId}:${selected.unitId}:${context.state.counters.action}`,
          source, targetId: selected.unitId, statusId: ids.shadowbind, controlType: '影缚',
          baseChance: bindChance[skillRank - 1]!, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (control) commands.push(control);
      }
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3751–3753技能/状态表接入影袭倍率、幕影盖地两段群攻加选中目标终段、影缚命中概率与不可驱散/无法动作状态；影食按普攻和三技能每次实际命中判定，最多2层，第二层消耗并造成攻击15%/30%的穿盾伤害，满级被动恢复最大生命3%。未在10点场帧序列中观察到影鳄；影食触发与伤害减免/穿盾结算及连续实战触发时序仍待有影鳄的对局帧核实。'],
    aiCoverageNotes: ['社区AI记录为无条件使用三技能；引擎不会自动将缺火技能降为普攻，当前策略明确在不足3火时选择普攻。三技能的单体终段目标优先级缺少客户端AI实测，暂取输入选中目标/敌方首位，故AI仅部分覆盖。'],
    handlers: { hit: { priority: 41, handle(context, event) { return applyShadowprey(context, event); } } },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || !isShadowCroc(actor)) return undefined;
      const enemies = context.getLivingUnits(enemySide(actor.side));
      if (!enemies.length) return undefined;
      const target = enemies[0]!;
      if ((context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0) < 3)
        return { actorId: unitId, skillId: ids.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: ids.ultimate, targetIds: enemies.map(enemy => enemy.unitId),
        selectedTargetId: target.unitId, shape: 'all-enemies', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function damageCommand(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
    ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
}

function applyShadowprey(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.suppressSourcePassiveTriggers || !event.source.unitId
    || (event.source.id !== shadowCrocIds.basic && event.source.id !== shadowCrocIds.ultimate)) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || !isShadowCroc(owner) || owner.hp <= 0 || !passivesEnabled(owner)
    || !target || target.hp <= 0 || target.side === owner.side) return;
  const passiveRank = rank(owner, shadowCrocIds.passive);
  const source = sourceFor(shadowCrocIds.passive, owner.unitId);
  const application = attemptDebuff(context, { source, targetId: target.unitId, statusId: shadowCrocIds.shadowprey,
    baseChance: shadowpreyChance[passiveRank - 1]!, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    parentEventId: event.eventId });
  if (!application.some(command => command.type === 'add-status')) return application;
  const mark = target.statuses.find(status => status.statusId === shadowCrocIds.shadowprey
    && status.source.unitId === owner.unitId);
  if (!mark) return application.map(command => command.type === 'add-status' ? { ...command,
    instance: { ...command.instance, instanceId: `${shadowCrocIds.shadowprey}:${owner.unitId}:${target.unitId}` } } : command);

  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const damage = context.calculateDamage({ attack: attack.attack, defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio: shadowpreyDamage[passiveRank - 1]!,
    critChance: 0, critDamage: attack.critDamage }, owner, target);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId },
  { type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount, ignoreShield: true,
    ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: false, parentEventId: event.eventId }];
  if (passiveRank >= 5) commands.push({ type: 'heal', source, targetId: owner.unitId,
    amount: owner.stats.hp * .03, parentEventId: event.eventId });
  return commands;
}
