export type DuelTargetSide = 'ally' | 'enemy' | 'self';
export type DuelTargetShape = 'single' | 'multiple' | 'all' | 'none';

export interface DuelSkillInference {
  targetSides: DuelTargetSide[];
  targetShape: DuelTargetShape;
  effectIds: string[];
  confident: boolean;
  sourceText: string;
}

const EFFECT_RULES: Array<[string, RegExp]> = [
  ['damage', /伤害|造成.{0,8}(?:点)?伤害|攻击.{0,8}(?:目标|全体)/],
  ['healing', /治疗|恢复.{0,8}生命|回复.{0,8}生命/],
  ['shield', /护盾|盾|吸收.{0,8}伤害/],
  ['control', /控制|眩晕|沉默|冰冻|变形|嘲讽|混乱|睡眠|减速/],
  ['dispel', /驱散|移除.{0,8}(?:增益|减益|控制)|解除.{0,8}控制/],
  ['gauge_push', /提升.{0,8}行动条|增加.{0,8}行动条|推进.{0,8}行动条|拉条/],
  ['gauge_pull', /击退.{0,8}行动条|降低.{0,8}行动条|减少.{0,8}行动条|推条/],
  ['revive', /复活/],
];

export function inferDuelSkill(description: string | undefined): DuelSkillInference {
  const fullText = (description ?? '').replace(/\r\n?/g, '\n');
  const cast = fullText.match(/【施放】([\s\S]*)/);
  const sourceText = (cast?.[1] ?? fullText).replace(/^[^\n]*唯一效果[^\n]*\n?/u, '').trim();
  const enemy = /攻击敌方|对敌方|敌方(?:全体|目标|式神|单位)|全体敌方|选择敌方|使敌方/u.test(sourceText);
  const ally = /为友方|对友方|友方(?:全体|目标|式神|单位)|全体友方|选择友方|使友方/u.test(sourceText);
  const self = /自身|自己/u.test(sourceText);
  const targetSides: DuelTargetSide[] = [];
  const genericAttackTarget = /攻击.{0,6}目标|对目标.{0,6}(?:造成|施加)|目标.{0,6}(?:受到|造成)/u.test(sourceText);
  if (enemy || (!ally && !self && genericAttackTarget)) targetSides.push('enemy');
  if (ally) targetSides.push('ally');
  if (self && !ally) targetSides.push('self');

  const targetShape: DuelTargetShape = /(?:敌方全体|全体敌方|全体友方|友方全体)/u.test(sourceText) ? 'all'
    : /随机.{0,4}(?:个|名)|生命最低的\d|最多\d|\d个(?:友方|敌方)/u.test(sourceText) ? 'multiple'
      : targetSides.length ? 'single' : 'none';
  const effectIds = EFFECT_RULES.filter(([, pattern]) => pattern.test(sourceText)).map(([id]) => id);
  if (!effectIds.length) effectIds.push('other');
  return { targetSides, targetShape, effectIds, confident: Boolean(description && (targetSides.length || effectIds[0] !== 'other')), sourceText };
}
