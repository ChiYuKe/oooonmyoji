import type { BattleLogEntry } from '../core/result';

export interface BattleLogAppearance { kind: string; label: string; detail: boolean }

/** Use event types, rather than matching words such as “复活” or “行动条” in the text. */
export function describeBattleLogEntry(entry: BattleLogEntry): BattleLogAppearance {
  const event = entry.event;
  switch (event.type) {
    case 'damage': return { kind: 'damage', label: event.damageKind === 'true' ? '真实伤害'
      : event.damageKind === 'indirect' ? '间接伤害' : '伤害', detail: false };
    case 'life-lost': return { kind: 'damage', label: event.lifeLossKind === 'indirect' ? '间接伤害' : '生命损失', detail: false };
    case 'healing': return { kind: 'heal', label: '治疗', detail: false };
    case 'health-restored': return { kind: 'heal', label: '生命恢复', detail: false };
    case 'unit-revived': return { kind: 'heal', label: '复活', detail: false };
    case 'revive-blocked': return { kind: 'control', label: '禁止复活', detail: false };
    case 'unit-defeated': return { kind: 'defeat', label: '击败', detail: false };
    case 'healing-blocked': return { kind: 'control', label: '禁疗', detail: false };
    case 'healing-converted': return { kind: 'shield', label: '治疗转盾', detail: false };
    case 'control-applied': return { kind: 'control', label: '控制', detail: false };
    case 'control-resisted':
    case 'status-resisted': return { kind: 'control', label: '抵抗', detail: false };
    case 'control-blocked':
    case 'status-application-blocked': return { kind: 'control', label: '免疫', detail: false };
    case 'action-gauge-changed': return { kind: 'gauge', label: '行动条', detail: false };
    case 'resource-meter-advanced':
    case 'resource-meter-set': return { kind: 'resource', label: '回火进度', detail: false };
    case 'resource-changed':
    case 'resource-overflow':
    case 'resource-cap-changed': return { kind: 'resource', label: '鬼火', detail: false };
    case 'turn-scheduled':
    case 'action-scheduled': return { kind: 'gauge', label: '追加行动', detail: false };
    case 'status-added':
    case 'status-stacks-changed': return { kind: 'state', label: '状态', detail: true };
    case 'status-removed': return { kind: 'state', label: event.reason === 'died' ? '死亡清除'
      : event.reason === 'expired' ? '到期' : event.reason === 'dispelled' ? '驱散' : '状态', detail: true };
    case 'turn-started':
    case 'turn-ended':
    case 'attack-start':
    case 'attack-ended':
    case 'action-ended': return { kind: 'state', label: '结算', detail: true };
    default: return { kind: 'effect', label: '效果', detail: false };
  }
}

export function battleLogOriginLabel(entry: BattleLogEntry): string {
  const kind = entry.origin.direct ? '本次技能' : ({ skill: '技能触发', passive: '被动', soul: '御魂',
    status: '状态触发', system: '系统', unit: '触发者' } as const)[entry.origin.kind];
  return `${kind}${entry.origin.label ? ` · ${entry.origin.label}` : ''}`;
}
