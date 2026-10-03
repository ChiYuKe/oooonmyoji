"""Cache the public NetEase Shikigami directory portraits for the offline picker."""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
SOURCE = "https://yys.res.netease.com/pc/zt/20161108171335/data/shishen/{id}.png?v6"
FALLBACK_SOURCE = "https://cbg-yys.res.netease.com/game_res/hero/{id}/{id}.png"


def fetch(hero: dict, directory: pathlib.Path, cached: dict | None = None) -> dict:
    """Keep cached portraits; try the official CBG portrait when the directory lacks one."""
    target = directory / f"{hero['id']}.png"
    result = {"id": hero["id"], "name": hero["name"], "url": SOURCE.format(id=hero["id"])}
    try:
        if target.exists():
            data = target.read_bytes()
            if cached and cached.get("url"):
                result["url"] = cached["url"]
        else:
            for source in (SOURCE, FALLBACK_SOURCE):
                result["url"] = source.format(id=hero["id"])
                try:
                    request = urllib.request.Request(result["url"], headers={
                        "User-Agent": "Mozilla/5.0", "Referer": "https://yys.cbg.163.com/" if source == FALLBACK_SOURCE else "https://yys.163.com/shishen/",
                        "Accept": "image/png",
                    })
                    with urllib.request.urlopen(request, timeout=15) as response:
                        data = response.read()
                    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                        raise ValueError("Expected a PNG portrait")
                    break
                except (OSError, ValueError):
                    if source == FALLBACK_SOURCE:
                        raise
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Expected a PNG portrait")
        target.write_bytes(data)
        result.update(file=target.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    except (OSError, ValueError) as error:
        result["error"] = str(error)
    return result


def main() -> None:
    text = (ROOT / "desktop/src/shared/soul-catalog-data.ts").read_text(encoding="utf-8")
    catalog = json.loads(text[text.index("{"):text.rindex("}") + 1])
    directory = ROOT / "assets/hero-icons"
    directory.mkdir(parents=True, exist_ok=True)

    manifest_path = directory / "manifest.json"
    cached = {row["id"]: row for row in json.loads(manifest_path.read_text(encoding="utf-8"))} if manifest_path.exists() else {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        manifest = list(pool.map(lambda hero: fetch(hero, directory, cached.get(hero["id"])), catalog["heroes"]))
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"downloaded": sum("file" in item for item in manifest),
                      "missing": [item["name"] for item in manifest if "error" in item]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
