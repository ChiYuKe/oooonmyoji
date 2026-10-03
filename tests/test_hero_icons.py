import pathlib
import tempfile
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from src.oooonmyoji.tools.fetch_hero_icons import FALLBACK_SOURCE, SOURCE, fetch


class HeroIconDownloadTests(unittest.TestCase):
    def test_missing_portrait_uses_official_cbg_and_keeps_cache_source(self):
        hero = {"id": 413, "name": "大吉达摩"}
        data = (pathlib.Path(__file__).resolve().parents[1] / "assets/hero-icons/413.png").read_bytes()
        response = MagicMock()
        response.__enter__.return_value.read.return_value = data
        with tempfile.TemporaryDirectory() as folder:
            directory = pathlib.Path(folder)
            with patch("urllib.request.urlopen", side_effect=[urllib.error.HTTPError(SOURCE.format(id=413), 404, "Not Found", {}, None), response]) as read:
                row = fetch(hero, directory)
                self.assertEqual([call.args[0].full_url for call in read.call_args_list], [SOURCE.format(id=413), FALLBACK_SOURCE.format(id=413)])
            self.assertNotIn("error", row)
            self.assertEqual(row["url"], FALLBACK_SOURCE.format(id=413))
            self.assertEqual((directory / "413.png").read_bytes(), data)
            with patch("urllib.request.urlopen") as read:
                self.assertEqual(fetch(hero, directory, row), row)
                read.assert_not_called()

    def test_failed_sources_do_not_save_html_as_a_portrait(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"<html>missing</html>"
        with tempfile.TemporaryDirectory() as folder, patch("urllib.request.urlopen", return_value=response) as read:
            row = fetch({"id": 499, "name": "鬼武达摩"}, pathlib.Path(folder))
            self.assertEqual(read.call_count, 2)
            self.assertIn("error", row)
            self.assertFalse((pathlib.Path(folder) / "499.png").exists())


if __name__ == "__main__":
    unittest.main()
