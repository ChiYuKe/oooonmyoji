import json
import unittest
from pathlib import Path

from src.oooonmyoji.tools.fetch_hero_skills import merge_profile, normalize, plain


class HeroSkillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.samples = json.loads((cls.root / 'tests/fixtures/hero_skill_samples.json').read_text(encoding='utf-8'))

    def test_stat_only_awakening_keeps_all_original_skills(self):
        profile = merge_profile(self.samples['217-0']['data'], self.samples['217-1']['data'])
        self.assertEqual([skill['name'] for skill in profile['skills']], ['风袭', '钢铁之羽', '羽刃暴风'])
        self.assertIn('攻击加成增加10%', profile['awakening'])
        self.assertEqual(len(profile['skills'][2]['upgrades']), 4)

    def test_awake_override_keeps_ordinary_skills_and_extra_skill(self):
        base = self.samples['389-0']['data']
        profile = merge_profile(base, self.samples['389-1']['data'])
        self.assertEqual([skill['id'] for skill in profile['skills']], [3891, 3892, 3893])
        self.assertEqual(profile['skills'][0]['description'], base['3891']['normaldesc'])
        self.assertIn('战斗和回合开始时', profile['skills'][1]['description'])
        self.assertNotIn('战斗和回合开始时', base['3892']['normaldesc'])
        extra = profile['skills'][1]['extraSkills'][0]
        self.assertEqual(extra['name'], '天威')
        self.assertIn('211%', extra['description'])

    def test_text_preserves_line_breaks_and_rejects_icon_paths(self):
        self.assertEqual(plain('<b>攻击</b><br/>100% &amp; 生命\n提升'), '攻击\n100% & 生命\n提升')
        self.assertEqual(plain('生命<50%且伤害>100'), '生命<50%且伤害>100')
        with self.assertRaises(ValueError):
            normalize(1, {'icon': '../outside', 'name': 'invalid'})

    def test_offline_catalog_covers_roster_and_main_skill_icons(self):
        def read_catalog(file):
            raw = file.read_text(encoding='utf-8').split(' = ', 1)[1]
            return json.loads(raw[:raw.rindex('}') + 1])
        catalog = read_catalog(self.root / 'desktop/src/shared/hero-skills-data.ts')
        roster = read_catalog(self.root / 'desktop/src/shared/soul-catalog-data.ts')
        self.assertEqual(set(catalog['heroes']), {str(hero['id']) for hero in roster['heroes']})
        for hero in catalog['heroes'].values():
            self.assertTrue(hero['skills'])
            for skill in hero['skills']:
                self.assertTrue(skill['description'])
                self.assertTrue(skill['name'])
                image = self.root / 'assets/skill-icons' / (skill['icon'] + '.png')
                self.assertTrue(image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))


if __name__ == '__main__':
    unittest.main()
