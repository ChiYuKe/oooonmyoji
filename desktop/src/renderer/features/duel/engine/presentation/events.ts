import type { BattleEvent, SideId } from '../core/types';
import { soulCatalog } from '../../../../../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../../../../../shared/hero-skills-data';

/** Formats structured events for Chinese battle logs; it does not participate in settlement. */
export function presentBattleEvent(event: BattleEvent, label: (id: string) => string = id => id): string {
  switch (event.type) {
    case 'battle-started': return '战斗开始。';
    case 'turn-started': return `${label(event.unitId)}的回合开始。`;
    case 'turn-ended': return `${label(event.unitId)}的回合结束。`;
    case 'damage': return `${label(event.targetId)}受到${Math.round(event.amount)}点${event.damageKind === 'true' ? '真实' : ''}伤害${event.fatalProtectionStatusId ? '（免疫致命伤害）' : (event.criticalAbsorbed ?? 0) > 0 ? `（共鸣之墙吸收${Math.round(event.criticalAbsorbed!)}点暴击伤害）` : ''}。`;
    case 'life-lost': return `${label(event.targetId)}损失${Math.round(event.hpLost)}点生命。`;
    case 'unit-defeated': return `${label(event.unitId)}被击败。`;
    case 'unit-revived': return `${label(event.unitId)}复活并恢复至${Math.round(event.hp)}点生命。`;
    case 'revive-blocked': return `${label(event.unitId)}因${statusLabel(event.protectionStatusId)}无法复活。`;
    case 'unit-summoned': return `${label(event.ownerUnitId)}召唤了${label(event.unitId)}。`;
    case 'attack-start': return `${label(event.source.unitId ?? event.source.id)}开始攻击。`;
    case 'attack-ended': return `攻击结束，共命中${event.hitCount}段。`;
    case 'healing': return `${label(event.targetId)}恢复${Math.round(event.hpGained)}点生命。`;
    case 'healing-blocked': return `${label(event.targetId)}受到四时一隅限制，无法恢复生命。`;
    case 'health-restored': return `${label(event.targetId)}直接恢复${Math.round(event.hpGained)}点生命。`;
    case 'max-health-changed': return `${label(event.targetId)}生命上限：${Math.round(event.before)}→${Math.round(event.after)}。`;
    case 'action-ended': return `${label(event.source.unitId ?? event.source.id)}行动结算结束。`;
    case 'content-triggered': return `${label(event.source.unitId ?? event.contentId)}触发${event.contentId}：${event.label}。`;
    case 'control-applied': return `${label(event.targetId)}受到控制：${statusLabel(event.statusId)}。`;
    case 'control-resisted': return `${label(event.targetId)}抵抗了${event.controlType}效果。`;
    case 'control-blocked': return event.blockReason === 'immunity'
      ? `${label(event.targetId)}免疫了控制效果。`
      : `${label(event.targetId)}的控制效果被${statusLabel(event.protectionStatusId ?? '控制保护')}抵挡。`;
    case 'status-resisted': return `${label(event.targetId)}抵抗了状态：${statusLabel(event.statusId)}。`;
    case 'resource-changed': return `${sideLabel(event.side)}${resourceLabel(event.resourceId)}：${event.before}→${event.after}。`;
    case 'resource-overflow': return `${sideLabel(event.side)}${resourceLabel(event.resourceId)}溢出${event.amount}。`;
    case 'resource-meter-set': return `${sideLabel(event.side)}${resourceLabel(event.resourceId)}行动条设为${event.progressAfter}格。`;
    case 'resource-meter-advanced': return `${sideLabel(event.side)}${resourceLabel(event.resourceId)}行动条：${event.progressBefore}→${event.progressAfter}格${event.supplied > 0 ? `，补充${event.supplied}` : ''}。`;
    case 'action-gauge-changed': return `${label(event.unitId)}行动条：${Math.round(event.before)}→${Math.round(event.after)}。`;
    case 'status-added': return `${label(event.targetId)}获得${statusLabel(event.instance.statusId)}。`;
    case 'status-stacks-changed': return `${label(event.targetId)}的${statusLabel(event.statusId)}层数：${event.before}→${event.after}。`;
    case 'status-removed': return `${label(event.targetId)}失去${statusLabel(event.instanceId.split(':')[0] ?? event.instanceId)}。`;
    case 'status-application-blocked': return event.blockReason === 'immunity'
      ? `${label(event.targetId)}免疫了${statusLabel(event.attemptedStatusId)}。`
      : `${label(event.targetId)}施加的${statusLabel(event.attemptedStatusId)}被${statusLabel(event.protectionStatusId ?? '状态保护')}抵挡。`;
    case 'healing-converted': return `${label(event.targetId)}的治疗转化为${Math.round(event.shieldAmount)}点护盾。`;
    case 'battle-ended': {
      const outcome = event.winner === 'draw' ? '双方平局' : `${sideLabel(event.winner)}获胜`;
      const ending = event.reason === 'action-limit' ? '达到行动上限后按生命比例判定'
        : event.reason === 'trigger-budget' ? '触发预算超限，对局无效' : '全灭结束';
      return `对局结束：${outcome}（${ending}）。`;
    }
    case 'action-declared': return `行动 ${event.actionId ?? 0}｜${actionLabel(event.intent.actorId, event.intent.skillId, label)}`;
    case 'action-skipped': return `${label(event.actorId)}本次无法行动。`;
    case 'action-scheduled': return event.preResolved ? `${label(event.intent.actorId)}发动追加攻击。`
      : `${label(event.intent.actorId)}获得追加行动${event.freeCast ? '（无消耗）' : ''}。`;
    case 'turn-scheduled': return `${label(event.unitId)}获得额外回合。`;
  }
}

export function presentBattleEvents(events: readonly BattleEvent[], label?: (id: string) => string): string[] {
  const visible = events.filter(event => event.type !== 'action-ended');
  const paidActionEvents = new Set<string>();
  const lines: string[] = [];
  for (let index = 0; index < visible.length; index++) {
    const event = visible[index]!;
    if (event.type === 'resource-changed' && event.phase === 'resource-payment' && paidActionEvents.has(event.eventId)) continue;
    if (event.type !== 'action-declared') {
      lines.push(presentBattleEvent(event, label));
      continue;
    }
    const payment = visible.slice(index + 1).find((candidate): candidate is Extract<BattleEvent, { type: 'resource-changed' }> =>
      candidate.type === 'resource-changed' && candidate.phase === 'resource-payment'
      && candidate.actionId === event.actionId && candidate.source.unitId === event.intent.actorId);
    if (payment) paidActionEvents.add(payment.eventId);
    const actionLine = presentBattleEvent(event, label);
    lines.push(payment ? `${actionLine}（${resourceLabel(payment.resourceId)} ${payment.before}→${payment.after}）` : actionLine);
  }
  return lines;
}

function sideLabel(side: SideId): string {
  return side === 'blue' ? '蓝方' : '红方';
}

const knownStatusLabels: Record<string, string> = {
  'core.shield': '护盾',
  'status.hero.238.blessing-seed': '祝福种子',
  'status.hero.238.photosynthesis': '光合作用',
  'status.hero.585.blood-flower': '血花',
  'status.hero.295.protection': '庇护',
};

function statusLabel(id: string): string {
  return knownStatusLabels[id] ?? id;
}

function resourceLabel(id: string): string {
  return id === 'fire' ? '鬼火' : id;
}

function actionLabel(actorId: string, skillId: string, label: (id: string) => string): string {
  const actorLabel = label(actorId);
  const fallback = /^fallback\.hero\.(\d+)\.basic$/.exec(skillId);
  if (fallback) {
    const heroName = soulCatalog.heroes.find(hero => String(hero.id) === fallback[1])?.name ?? '该式神';
    return `${actorLabel}使用通用普攻（${heroName}的技能规则尚未迁移）。`;
  }
  const actorName = actorLabel.split('·').at(-1) ?? actorLabel;
  const hero = soulCatalog.heroes.find(profile => profile.name === actorName);
  const skills = hero ? heroSkillsCatalog.heroes[hero.id]?.skills ?? [] : [];
  const skill = [...skills, ...skills.flatMap(item => item.extraSkills)].find(item => String(item.id) === skillId);
  return `${actorLabel}使用技能「${skill?.name ?? skillId}」。`;
}
