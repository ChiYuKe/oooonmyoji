"""Download the Onmyoji soul-suit icon set from the official CBG CDN.

The 藏宝阁 yys web app builds suit icons as

    https://cbg-yys.res.netease.com/game_res/suit/<套装编号>.png

(see the ``yuhun-collocation`` chunk: ``g_res_url + "/game_res/suit/" + suitid + ".png"``;
``g_res_url`` is the site's ``CBG_CONFIG.resUrl``).  Requesting the CDN with
``Accept: image/png`` yields real PNG instead of the default WebP.

The suit list lives in ``assets/soul-icons/manifest.json`` (编号 / 名称 / 图标键), so this
script only needs network access — no device and no game client:

    python -m src.oooonmyoji.tools.fetch_soul_icons
    python -m src.oooonmyoji.tools.fetch_soul_icons --ids 300100 300101
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import urllib.error
import urllib.request

ICON_DIRECTORY = pathlib.Path("assets") / "soul-icons"
RES_URL = "https://cbg-yys.res.netease.com"
SOURCE = RES_URL + "/game_res/suit/{}.png"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://yys.cbg.163.com/",
    "Accept": "image/png,image/*;q=0.8,*/*;q=0.5",
}


def project_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def load_manifest(target: pathlib.Path) -> dict[int, dict[str, object]]:
    path = target / "manifest.json"
    if not path.is_file():
        return {}
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {int(row["suitId"]): row for row in rows}


def download(url: str) -> bytes | None:
    """Return the icon bytes, or None when the CDN has no icon for that suit id."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=25) as response:
            return response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ids", type=int, nargs="*", default=[],
                        help="额外/指定的套装编号；默认刷新清单里的全部编号")
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    target = project_root() / ICON_DIRECTORY
    target.mkdir(parents=True, exist_ok=True)
    known = load_manifest(target)
    for suit_id in args.ids:
        known.setdefault(suit_id, {"suitId": suit_id, "name": None, "icon": None})
    if not known:
        print("清单为空，请用 --ids 指定要下载的套装编号")
        return 1

    def work(suit_id: int) -> dict[str, object]:
        row = dict(known.get(suit_id, {"suitId": suit_id, "name": None, "icon": None}))
        file_name = f"{suit_id}.png"
        url = SOURCE.format(suit_id)
        data = download(url)
        row.update(suitId=suit_id, file=file_name, url=url)
        if data:
            (target / file_name).write_bytes(data)
            row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            row.pop("missing", None)
        else:
            row.pop("bytes", None)
            row.pop("sha256", None)
            row["missing"] = True
        return row

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(work, sorted(known)))

    payload = [{key: row[key] for key in
                ("suitId", "name", "icon", "file", "url", "bytes", "sha256", "missing")
                if key in row}
               for row in rows]
    (target / "manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    missing = [row["suitId"] for row in rows if row.get("missing")]
    print(f"下载成功 {len(rows) - len(missing)}/{len(rows)}；清单已更新：{target / 'manifest.json'}")
    if missing:
        print("藏宝阁无此编号图标：", missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
