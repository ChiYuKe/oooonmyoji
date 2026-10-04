"""Check packed artwork for exporters without requiring Node or extracting images."""
import json
import re
import struct
from functools import lru_cache
from pathlib import Path

ARCHIVE = "resources/onmyoji-icons.asar"


@lru_cache(maxsize=4)
def _index(filename: str, modified: int, size: int) -> tuple[dict, int]:
    # ASAR starts with an 8-byte size pickle followed by a UTF-8 JSON header pickle.
    with open(filename, "rb") as stream:
        prefix = stream.read(8)
        if len(prefix) != 8 or struct.unpack("<I", prefix[:4])[0] != 4:
            return {}, 0
        header_size = struct.unpack("<I", prefix[4:])[0]
        if not 8 <= header_size <= min(8_000_000, size - 8):
            return {}, 0
        header = stream.read(header_size)
    if len(header) != header_size:
        return {}, 0
    text_size = struct.unpack("<I", header[4:8])[0]
    if text_size > header_size - 8:
        return {}, 0
    files = json.loads(header[8:8 + text_size]).get("files", {})
    return (files if isinstance(files, dict) else {}), size - 8 - header_size


def has_icon_resource(root: Path, relative: str) -> bool:
    if not re.fullmatch(r"assets/(hero|skill|soul)-icons/[0-9]+\.png", relative):
        return False
    if (root / relative).is_file():
        return True
    try:
        archive = root / ARCHIVE
        stat = archive.stat()
        files, data_size = _index(str(archive), stat.st_mtime_ns, stat.st_size)
        node = {"files": files}
        for name in relative.split("/")[1:]:
            node = node["files"][name]
        return (isinstance(node.get("size"), int) and node["size"] > 0
                and isinstance(node.get("offset"), str) and node["offset"].isdigit()
                and int(node["offset"]) + node["size"] <= data_size
                and "link" not in node and not node.get("unpacked"))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, struct.error):
        return False
