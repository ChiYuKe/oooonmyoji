const {test}=require('node:test');
const assert=require('node:assert/strict');
const {skillDescriptionText}=require('../dist-test-renderer/shared/hero-skills.js');

test('a leading 唯一效果 marker always keeps its own line',()=>{
  assert.equal(skillDescriptionText('唯一效果。创造命运星河幻境'),'唯一效果。\n创造命运星河幻境');
  assert.equal(skillDescriptionText('唯一效果。荡涤心中尘埃，战斗开始时'),'唯一效果。\n荡涤心中尘埃，战斗开始时');
  assert.equal(skillDescriptionText('唯一效果，友方受到攻击时获得海图守护'),'唯一效果，\n友方受到攻击时获得海图守护');
  assert.equal(skillDescriptionText('（唯一效果）若自身初始暴击超过120%时'),'（唯一效果）\n若自身初始暴击超过120%时');
  assert.equal(skillDescriptionText('唯一效果\n在每个行动结束时'),'唯一效果\n在每个行动结束时');
  assert.equal(skillDescriptionText('唯一效果。\n战斗开始时'),'唯一效果。\n战斗开始时');
  assert.equal(skillDescriptionText('唯一效果。 \n战斗开始时'),'唯一效果。\n战斗开始时');
  assert.equal(skillDescriptionText('\r\n唯一效果。耗火减少1点'),'唯一效果。\n耗火减少1点');
});

test('line breaks already in the catalog survive and other text stays untouched',()=>{
  const trailing='选择一名非召唤物敌方，施加怨。每回目限施放1次，唯一效果。';
  assert.equal(skillDescriptionText(trailing),trailing);
  const inline='战斗开始时，若自身初始攻击高于防御的700%，进入攻击架势。\n唯一效果。掌控神器布都御魂。';
  assert.equal(skillDescriptionText(inline),inline);
  const multi='召回了所有面具。\n\n唯一效果，先机：释放自身的7个面具。';
  assert.equal(skillDescriptionText(multi),multi);
  assert.equal(skillDescriptionText(''),'');
  assert.equal(skillDescriptionText('暂无技能描述。'),'暂无技能描述。');
});
