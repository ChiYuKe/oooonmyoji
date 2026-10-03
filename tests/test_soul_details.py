import json
import struct
import unittest
from pathlib import Path

from src.oooonmyoji.souls.acquisition import normalize_record
from src.oooonmyoji.souls.details import enrich
from src.oooonmyoji.souls.memory import Objects


class SoulDetailsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Captured rolls for the two items in the user's panel screenshot; no player identifiers.
        cls.samples = json.loads((Path(__file__).parent / 'fixtures/soul_panel_samples.json').read_text(encoding='utf-8'))
        cls.tables = {name: {int(key): row for key, row in rows.items()}
                      for name, rows in cls.samples['tables'].items()}

    def test_panel_values_equipment_and_strengthening_match_screenshot(self):
        cases = [
            ('yinmoluo', '阴摩罗', False,
             {'攻击': '23.01', '速度': '16.60', '暴击': '2.94%', '效果命中': '3.90%'}, {'速度': 5}),
            ('rinv', '日女巳时', True,
             {'生命加成': '5.26%', '防御加成': '2.48%', '攻击加成': '5.38%', '速度': '11.07'},
             {'生命加成': 1, '攻击加成': 1, '速度': 3}),
        ]
        for key, name, equipped, expected, upgrades in cases:
            with self.subTest(name=name):
                record = self.samples[key]
                soul = enrich(normalize_record('sample', record), record, self.tables)
                self.assertEqual(soul['name'], name)
                self.assertEqual((soul['position'], soul['stars'], soul['level']), (1, 6, 15))
                self.assertEqual(soul['equipped'], equipped)
                self.assertEqual(soul['mainAttribute']['value'], 486)
                self.assertTrue(soul['attributesComplete'])
                self.assertEqual({a['label']: f"{a['value'] * (100 if a['percent'] else 1):.2f}" + ('%' if a['percent'] else '')
                                  for a in soul['subAttributes']}, expected)
                for a in soul['subAttributes']:
                    self.assertEqual(a['rolls'] - 1, upgrades.get(a['label'], 0))

    def test_unloaded_coefficients_are_pending_instead_of_fabricated(self):
        record = self.samples['yinmoluo']
        soul = enrich(normalize_record('sample', record), record, {**self.tables, 'random': {}})
        self.assertFalse(soul['attributesComplete'])
        self.assertEqual(soul['subAttributes'], [])
        self.assertEqual(soul['mainAttribute']['value'], 486)

    def test_special_item_positions_use_client_equip_type(self):
        for item_id, equip_type in [(180001, 11), (180008, 12), (180009, 13),
                                    (180010, 14), (180005, 15), (180012, 16)]:
            with self.subTest(item_id=item_id):
                record = {**self.samples['yinmoluo'], 'equipId': item_id}
                tables = {**self.tables, 'init': {item_id: {**self.tables['init'][110006], 'equipType': equip_type}}}
                soul = enrich(normalize_record('sample', record), record, tables)
                self.assertEqual(soul['position'], equip_type - 10)
                self.assertTrue(soul['attributesComplete'])

    def test_missing_or_invalid_equip_type_keeps_normalized_position(self):
        for equip_type in [None, 10, 17, '11', True]:
            with self.subTest(equip_type=equip_type):
                tables = {**self.tables, 'init': {110006: {**self.tables['init'][110006], 'equipType': equip_type}}}
                record = self.samples['yinmoluo']
                self.assertEqual(enrich(normalize_record('sample', record), record, tables)['position'], 1)
                record = {**record, 'equipId': 180001}
                self.assertIsNone(enrich(normalize_record('sample', record), record, tables)['position'])

    def test_tagged_dictionary_reads_all_odd_pairs_and_pointer_tags(self):
        class Memory:
            def __init__(self):
                self.pointers = {0x1010: 0x2000, 0x1018: 3}
                self.strings = {0x3000: 'id', 0x3010: 'suit_n', 0x3020: '阴摩罗', 0x3030: 'icon', 0x3040: 'hscard_0027'}
                for i, value in enumerate([0x3001, 0x4002, 0x3013, 0x3024, 0x3035, 0x3046]):
                    self.pointers[0x2000 + i * 8] = value
            def ptr(self, address): return self.pointers[address]
            def text(self, address): return self.strings[address]
            def read(self, address, size):
                return {0x4010: struct.pack('<q', 1), 0x4018: struct.pack('<I', 300027)}[address]

        class TestObjects(Objects):
            def type_name(self, address):
                return 'taggeddict.taggeddict' if address == 0x1000 else 'int' if address == 0x4000 else 'str'

        self.assertEqual(TestObjects(Memory()).value(0x1000),
                         {'id': 300027, 'suit_n': '阴摩罗', 'icon': 'hscard_0027'})


if __name__ == '__main__': unittest.main()
