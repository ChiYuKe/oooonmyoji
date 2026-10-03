import pathlib
import tempfile
import unittest

from src.oooonmyoji.souls.details import ICON_DIRECTORY, enrich, icon_url


class SoulIconUrlTests(unittest.TestCase):
    def test_icon_url_points_at_the_project_resource(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            target = root / ICON_DIRECTORY
            target.mkdir(parents=True)
            (target / "300022.png").write_bytes(b"\x89PNG\r\n\x1a\n")
            self.assertEqual(icon_url(300022, root),
                             "onmyoji-resource://project/assets/soul-icons/300022.png")

    def test_missing_icon_and_unknown_inputs_resolve_to_none(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            self.assertIsNone(icon_url(300022, root))
            self.assertIsNone(icon_url(None, root))
            self.assertIsNone(icon_url("300022", root))
            self.assertIsNone(icon_url(300022, None))

    def test_enrich_keeps_icon_url_absent_without_an_icon_root(self):
        soul = {"itemId": 150006, "suitId": 300022, "baseAttributeIndex": 0, "baseValue": None,
                "attributeRolls": []}
        tables = {"suits": {300022: {"suit_n": "心眼", "icon": "hscard_0022_"}}}
        result = enrich(dict(soul), {}, tables)
        self.assertEqual(result["name"], "心眼")
        self.assertEqual(result["iconKey"], "hscard_0022_")
        self.assertIsNone(result["iconUrl"])


if __name__ == "__main__":
    unittest.main()
