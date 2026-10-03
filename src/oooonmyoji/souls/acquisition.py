"""Read-only soul acquisition with temporary ADB root and guaranteed cleanup."""
from __future__ import annotations

import datetime
import json
import math
import re
import struct
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

from .memory import Reader, Objects
from .details import client_tables, enrich

DEFAULT_PACKAGE = "com.netease.onmyoji.wyzymnqsd_cps"


class Cancelled(Exception):
    pass


class Adb:
    def __init__(self, executable, serial, check=lambda: None):
        self.executable, self.serial, self.check = executable, serial, check

    def command(self, *args, check=True):
        if check: self.check()
        proc = subprocess.run([self.executable, "-s", self.serial, *args],
                              capture_output=True, timeout=12,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if proc.returncode:
            raise ValueError("实例连接失败，请刷新实例后重试")
        return proc.stdout

    def ready_identity(self, check=True):
        for attempt in range(20):
            try: return self.command("shell", "id", check=check).decode()
            except (ValueError, subprocess.TimeoutExpired):
                if attempt == 19: raise ValueError("实例连接超时，请检查模拟器")
                if check: self.check()
                time.sleep(.3)


@contextmanager
def temporary_root(adb, progress):
    originally_root = adb.ready_identity().startswith("uid=0(")
    changed = False
    try:
        if not originally_root:
            progress("正在准备读取权限")
            # Mark before the request: cancellation can arrive while adbd restarts.
            changed = True
            adb.command("root")
            if not adb.ready_identity().startswith("uid=0("):
                raise ValueError("此实例不支持读取御魂，请检查模拟器是否支持 ADB Root")
        yield
    finally:
        if changed:
            try: progress("正在恢复实例连接")
            except OSError: pass  # A closed desktop pipe must not prevent restoring adbd.
            adb.command("unroot", check=False)
            if not adb.ready_identity(check=False).startswith("uid=2000("):
                raise ValueError("临时读取权限未能恢复，请在该实例执行 adb unroot")


def process_report(adb, package):
    try: processes = adb.command("exec-out", "pidof", package).decode().split()
    except ValueError: raise ValueError("请先在所选实例中启动阴阳师并登录角色") from None
    if not processes: raise ValueError("请先在所选实例中启动阴阳师并登录角色")
    pid = int(processes[0])
    maps = adb.command("exec-out", "cat", f"/proc/{pid}/maps").decode()
    mapping = next((line for line in maps.splitlines()
                    if "libclient.so" in line and " 00000000 " in line), None)
    if not mapping: raise ValueError("当前游戏客户端不支持御魂读取")
    base, library = int(mapping.split("-", 1)[0], 16), mapping.split()[-1]

    def read(offset, length):
        start = offset // 4096 * 4096
        raw = adb.command("exec-out", "dd", f"if={library}", "bs=4096",
                          f"skip={start // 4096}", f"count={math.ceil((offset-start+length)/4096)}", "status=none")
        data = raw[offset-start:offset-start+length]
        if len(data) != length: raise ValueError("读取客户端信息失败")
        return data

    header = read(0, 64)
    if header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 62:
        raise ValueError("目前支持 64 位 x86 模拟器客户端，此实例的架构不匹配")
    offset = struct.unpack_from("<Q", header, 40)[0]
    size, count, names_index = struct.unpack_from("<HHH", header, 58)
    if size != 64 or not 0 < count < 1000 or names_index >= count:
        raise ValueError("客户端结构不受支持")
    raw = read(offset, size * count)
    sections = [struct.unpack_from("<IIQQQQIIQQ", raw, i * size) for i in range(count)]
    section = sections[names_index]
    names = read(section[4], section[5])
    named = {names[s[0]:names.find(b"\0", s[0])].decode(): s for s in sections}
    table = named[".dynsym"]
    symbols = read(table[4], table[5])
    section = sections[table[6]]
    strings = read(section[4], section[5])
    wanted = {"_PyRuntime", "PyDict_Type", "PyUnicode_Type", "PyLong_Type", "PyFloat_Type", "PyModule_Type"}
    found = {}
    for offset in range(0, len(symbols), table[9]):
        name, _, _, defined, value, _ = struct.unpack_from("<IBBHQQ", symbols, offset)
        name = strings[name:strings.find(b"\0", name)].decode(errors="replace")
        if name in wanted and defined: found[name] = hex(base + value)
    if set(found) != wanted: raise ValueError("当前客户端缺少读取所需的信息")
    return {"pid": pid, "package": package, "serial": adb.serial, "python_symbols": found}


def normalize_record(uid, record):
    rates = record.get("rattr") or []
    item = record.get("equipId")
    return {
        "id": uid, "itemId": item, "suitId": record.get("suitId"),
        "position": (item // 10000) % 10 if isinstance(item, int) and 1 <= (item // 10000) % 10 <= 6 else None,
        "stars": record.get("qua"), "level": record.get("strongLevel"),
        "locked": bool(record.get("lock")), "equipped": bool(record.get("inHero")),
        "discarded": bool(record.get("garbage")),
        "baseAttributeIndex": record.get("base_rindex"),
        "baseValue": record.get("strengthenedBaseAttrValue"),
        "attributeRolls": [{"name": name, "factor": factor} for name, factor in rates],
    }


def acquire(adb, package, instance_id, output, progress, icon_root=None):
    with temporary_root(adb, progress):
        progress("正在定位当前角色的御魂背包")
        report = process_report(adb, package)
        r = Reader(report, adb.executable, adb.serial, adb.check)
        o = Objects(r)
        interpreter = r.ptr(r.symbols["_PyRuntime"] + 40)
        sys_dict = r.dictionary(r.ptr(interpreter + 904), {"version"})
        if not o.value(sys_dict["version"]).startswith("3.11."):
            raise ValueError("当前游戏版本不支持御魂读取")
        modules = r.dictionary(r.ptr(interpreter + 888), {"Globals", "com.Equip"})
        player = r.module_dictionary(modules["Globals"])["player1"]
        if o.type_name(player) != "ClientAvatar": raise ValueError("请先在此实例登录角色")
        if not r.ptr(r.ptr(player + 8) + 168) & 16: raise ValueError("角色结构不受支持")
        fields = r.dictionary(r.ptr(player - 24), {"inventory", "inventory_finish"})
        if not o.value(fields["inventory_finish"]): raise ValueError("游戏正在加载背包，请稍后重试")
        inventory_ptr = fields["inventory"]
        header = r.read(inventory_ptr + 16, 16)
        inventory = r.dictionary(inventory_ptr)
        if len(inventory) != struct.unpack_from("<Q", header)[0]:
            raise ValueError("背包数据不完整，请稍后重试")
        records, errors, layouts = {}, [], {}
        wanted = {"_uid", "_equipId", "_suitId", "_qua", "_strongLevel", "_lock", "_garbage", "_inHero",
                  "_base_rindex", "_strengthenedBaseAttrValue", "_rattr", "_single_attr", "_init_dict", "_randomAttrDict"}
        total = len(inventory)
        progress("正在读取御魂", 0, total)
        for index, (uid, address) in enumerate(inventory.items()):
            adb.check()
            try:
                if o.type_name(address) != "Equip": raise ValueError("御魂对象不受支持")
                t = r.ptr(address + 8)
                if t not in layouts: layouts[t] = o.slots(address)
                record = {k[1:]: o.value(r.ptr(address + off)) for k, off in layouts[t].items() if k in wanted}
                if record["uid"] != uid: raise ValueError("御魂在读取期间发生变化")
                if record.get("init_dict") is not None: raise ValueError("御魂属性尚未加载")
                records[uid] = record
            except (ValueError, UnicodeError, KeyError) as exc:
                errors.append({"id": uid, "message": str(exc)})
            if (index + 1) % 100 == 0 or index + 1 == total:
                progress("正在读取御魂", index + 1, total)
        r.blocks.clear()
        if r.read(inventory_ptr + 16, 16) != header:
            raise ValueError("读取期间御魂背包发生变化，请重新获取")
        if int(adb.command("exec-out", "pidof", package).decode().split()[0]) != report["pid"]:
            raise ValueError("读取期间游戏已重启，请重新获取")
        # Account switching must never label a previous character as the current one.
        current_globals = r.module_dictionary(modules["Globals"])
        if current_globals["player1"] != player:
            raise ValueError("读取期间角色发生变化，请重新获取")
        progress("正在解析御魂名称和详细属性")
        tables = client_tables(o, modules["com.Equip"])
        detailed = [enrich(normalize_record(uid, rec), rec, tables, icon_root) for uid, rec in records.items()]
        result = {"instanceId": instance_id, "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "total": total, "souls": detailed,
                  "failed": len(errors), "warnings": ["暂不包含收纳库存；尚未加载的属性表会标记为待解析；图标取自藏宝阁官方资源，未收录的套装不显示图标。"],
                  "source": "memory"}
        raw_export = {"report": report, "result": result, "records": records, "errors": errors, "tables": tables}
    # Publish only after permissions have been restored successfully.
    # ``output`` 存界面直接用的快照（体积小、下次打开即载入），原始导出单独落盘备查。
    adb.check()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    _write_json(output, result)
    _write_json(output.with_name("raw.json"), raw_export)
    return result


def _write_json(destination: Path, value: object) -> None:
    temporary = destination.with_name(f"{destination.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=True, allow_nan=False), encoding="utf-8")
    temporary.replace(destination)
