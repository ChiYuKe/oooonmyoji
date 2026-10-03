import unittest
from src.oooonmyoji.souls.hero_ownership import count_heroes, hero_details, read_equipped_souls, BORROWED_FLAGS, ensure_hero_screen
from unittest.mock import patch


def hero(uid, hero_id=217, **extra):
    return uid, {"heroUid": uid, "heroId": hero_id, **{name: False for name in BORROWED_FLAGS}, **extra}


class HeroOwnershipTests(unittest.TestCase):
    def test_equipped_souls_use_this_scan_and_client_slots_instead_of_list_order(self):
        rows = {"six": {"uid": "six", "equipId": 180001, "suitId": 10, "qua": 6, "strongLevel": 15,
                         "base_rindex": 0, "strengthenedBaseAttrValue": .55, "rattr": [], "init_dict": None},
                "one": {"uid": "one", "equipId": 110001, "suitId": 10, "qua": 6, "strongLevel": 15,
                         "base_rindex": 0, "strengthenedBaseAttrValue": 486, "rattr": [], "init_dict": None}}
        layout = {"_" + name: 16 + i * 8 for i, name in enumerate(rows['six'])}
        class Reader:
            check = staticmethod(lambda: None)
            def read(self, *args): return b'unchanged'
            def dictionary(self, address, wanted): return {uid: 1000 + i * 1000 for i, uid in enumerate(rows) if uid in wanted}
            def ptr(self, address):
                pointer = address // 1000 * 1000
                if address - pointer == 8: return 500
                row = rows[list(rows)[pointer // 1000 - 1]]
                return row[next(k[1:] for k, off in layout.items() if address - pointer == off)]
        class Objects:
            r = Reader()
            def value(self, value): return value
            def slots(self, pointer): return layout
            def type_name(self, pointer): return 'Equip'
        tables = {'init': {180001: {'equipType': 16, 'base_attr': [['attackAdditionRate', 0]]},
                            110001: {'equipType': 11, 'base_attr': [['attackAdditionVal', 0]]}}, 'suits': {10: {'suit_n': '测试'}}}
        copies = [{'equips': ['six', 'one']}, {'equips': []}]
        with patch('src.oooonmyoji.souls.hero_ownership.client_tables', return_value=tables):
            souls, guard = read_equipped_souls(Objects(), {'inventory': 99, 'inventory_finish': True}, 123, copies, lambda *args: None)
            self.assertEqual(copies[0]['equips'], ['one', None, None, None, None, 'six'])
            self.assertEqual(copies[1]['equips'], [None] * 6)
            self.assertEqual([s['position'] for s in souls], [6, 1])
            self.assertEqual(len(guard[2]), 2)
            with self.assertRaisesRegex(ValueError, '不完整'):
                read_equipped_souls(Objects(), {'inventory': 99, 'inventory_finish': True}, 123, [{'equips': ['missing']}], lambda *args: None)
            with self.assertRaisesRegex(ValueError, '位置重复'):
                rows['six']['equipId'] = 110001
                read_equipped_souls(Objects(), {'inventory': 99, 'inventory_finish': True}, 123, [{'equips': ['six', 'one']}], lambda *args: None)

    def test_details_preserve_actual_levels_and_equipment_and_deduplicate(self):
        a = hero("one", _level=18, _star=2, _awake=1, lock=True,
                 skillList=[[2173, 5], [2171, 2]], _equips=["soul"])
        self.assertEqual(hero_details([a, a, hero("borrow", _isHelpHero=True)]), [{
            "id": "one", "heroId": 217, "level": 18, "stars": 2, "awake": True, "locked": True,
            "skills": [{"id": 2171, "level": 2}, {"id": 2173, "level": 5}], "equips": ["soul"]}])

    def test_missing_invalid_detail_data_never_becomes_default_level(self):
        valid = dict(_level=1, _star=2, _awake=0, skillList=[[2171, 1]], _equips=[])
        for changes in [{"_level": None}, {"_level": 0}, {"_star": 7}, {"skillList": [[2171, 0]]},
                        {"skillList": [[2171, 1], [2171, 2]]}, {"_equips": ["same", "same"]}]:
            with self.assertRaises(ValueError): hero_details([hero("x", **{**valid, **changes})])
        self.assertEqual(hero_details([hero("material", 12, **{**valid, "_level": 60})])[0]['level'], 60)

    def test_duplicate_types_and_cross_bag_uids(self):
        a = hero("first")
        self.assertEqual(count_heroes([a, hero("second"), a, hero("third", 389)]), {"217": 2, "389": 1})

    def test_borrowed_and_trials_do_not_count(self):
        rows = [hero("own")]
        rows += [hero(flag, **{flag: True}) for flag in BORROWED_FLAGS]
        self.assertEqual(count_heroes(rows), {"217": 1})

    def test_invalid_and_changing_rows_abort(self):
        for row in [("x", {"heroId": 217}), ("x", {"heroId": True, "heroUid": "x"}), hero("x", 0)]:
            with self.assertRaises(ValueError): count_heroes([row])
        with self.assertRaises(ValueError): count_heroes([hero("same", 217), hero("same", 389)])

    def test_illustration_has_owned_is_not_inventory(self):
        self.assertEqual(count_heroes([hero("x", has_owned=False)]), {"217": 1})
        self.assertEqual(count_heroes([]), {})

    def test_cached_panel_is_insufficient_and_loading_must_finish(self):
        class Reader:
            def dictionary(self, address, wanted=None):
                return {"GhostPanel": "panel"} if address == "instances" else {}
        class Objects:
            r = Reader()
            active, stack, loaded = [], [], True
            def fields(self, value):
                return {"is_async_load_complete": self.loaded} if value == "panel" else {
                    "full_screen_ui_list": self.active, "_uiBuffer": self.stack,
                    "openUIRoot": "roots", "_uiInstMap": "instances"}
            def value(self, value): return value
            def type_name(self, value): return "GhostPanel"
        objects = Objects()
        with self.assertRaisesRegex(ValueError, "切到"): ensure_hero_screen(objects, {"uiMgr": "ui"})
        objects.stack = ["YardPanel", "GhostPanel"]
        ensure_hero_screen(objects, {"uiMgr": "ui"})
        objects.loaded = False
        with self.assertRaisesRegex(ValueError, "加载完成"): ensure_hero_screen(objects, {"uiMgr": "ui"})


if __name__ == "__main__": unittest.main()
