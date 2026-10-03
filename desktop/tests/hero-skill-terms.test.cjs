const {test}=require('node:test');
const assert=require('node:assert/strict');
const {heroSkillTerms,splitHeroSkillTerms}=require('../dist-test-renderer/shared/hero-skill-terms.js');
const skill=(name,description,extraSkills=[])=>({id:1,name,description,extraSkills});

test('mark definitions stay scoped to their hero and include the related in-game definition',()=>{
  const terms=heroSkillTerms(354,[]);
  const feather=terms.find(term=>term.name==='羽授');
  assert.match(feather.description,/首次普攻/);
  assert.deepEqual(feather.related,['羽念']);
  assert.match(terms.find(term=>term.name==='羽念').description,/10%.*5层/);
  assert.equal(heroSkillTerms(217,[]).some(term=>term.name==='羽授'),false);
  assert.match(heroSkillTerms(217,[]).find(term=>term.name==='唯一效果').description,/同名式神/);
});

test('referenced skills include attached skills and use the currently selected hero definitions',()=>{
  const first=heroSkillTerms(1,[skill('协战','式神甲说明',[skill('追魂','附加技能说明')])]);
  const second=heroSkillTerms(2,[skill('协战','式神乙说明')]);
  assert.equal(first.find(term=>term.name==='追魂').description,'附加技能说明');
  assert.equal(first.find(term=>term.name==='协战').description,'式神甲说明');
  assert.equal(second.find(term=>term.name==='协战').description,'式神乙说明');
});

test('literal matching prefers complete skill names and preserves original text',()=>{
  const terms=['墨影','墨影剑光','术语(特殊)+'].map(name=>({name,description:name}));
  const text='「墨影剑光」\n墨影、术语(特殊)+。<img src=x>0.5%';
  const parts=splitHeroSkillTerms(text,terms);
  assert.equal(parts.map(part=>part.text).join(''),text);
  assert.deepEqual(parts.filter(part=>part.term).map(part=>part.term.name),['墨影剑光','墨影','术语(特殊)+']);
  assert.deepEqual(splitHeroSkillTerms('没有术语',terms),[{text:'没有术语'}]);
  assert.deepEqual(splitHeroSkillTerms('',terms),[{text:''}]);
  assert.deepEqual(splitHeroSkillTerms('普通正文',[]),[{text:'普通正文'}]);
});
