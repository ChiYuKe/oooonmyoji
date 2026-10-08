import type { SoulDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, UnitState } from '../core/types';
import { heroSkillsCatalog } from '../../../../../shared/hero-skills-data';
import { soulsEnabled } from '../core/soul-eligibility';
import type { ContentRegistry } from './registry';

export const echoingInsectIds = { soul: 'soul:300088' } as const;

/** 应声虫：友方普通攻击后，携带者有20%概率使用普攻协战。 */
export function registerEchoingInsect(registry: ContentRegistry): void {
  registry.registerSoul({
    id: echoingInsectIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['四件套协战率20%已接入普通攻击后触发；攻击被动不再连锁触发。二件套暴击属性由阵容面板提供，帧图中的反击/协战类别和协战御魂联动边界待核。'],
    handlers: { 'action-end': { priority: 45, handle(context, event) { return echoAfterAllyBasic(context, event); } } },
  });
}

function echoAfterAllyBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || !event.soulTriggersAllowed
    || event.scheduling !== undefined || !event.intent) return;
  const attacker = context.getUnit(event.intent.actorId);
  if (!attacker || attacker.hp <= 0) return;
  const targets = event.intent.targetIds.map(id => context.getUnit(id))
    .filter((target): target is UnitState => Boolean(target && target.hp > 0 && target.side !== attacker.side));
  if (targets.length === 0) return;
  const target = targets[0]!;
  const commands: EffectCommand[] = [];
  for (const wearer of context.getLivingUnits(attacker.side).filter(unit => unit.soulId === echoingInsectIds.soul
    && unit.unitId !== attacker.unitId && soulsEnabled(unit))) {
    if (context.random() >= .2) continue;
    const basic = heroSkillsCatalog.heroes[wearer.heroId]?.skills[0];
    if (!basic) continue;
    const source = { kind: 'soul' as const, id: echoingInsectIds.soul, unitId: wearer.unitId };
    const intent: ActionIntent = { actorId: wearer.unitId, skillId: String(basic.id), targetIds: [target.unitId],
      shape: 'single', targetRelation: 'enemy', kind: 'passive' };
    commands.push({ type: 'schedule-action', source, intent, scheduling: 'assist', parentEventId: event.eventId });
  }
  return commands;
}
