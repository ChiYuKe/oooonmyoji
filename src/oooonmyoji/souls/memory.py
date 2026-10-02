"""Read-only CPython 3.11 object inspection; no target-process code execution."""
import bisect
import struct
import subprocess
class Reader:
    def __init__(self, report, adb, serial, check=lambda: None):
        self.check = check
        self.adb_path, self.serial = adb, serial
        self.pid = report["pid"]
        self.symbols = {k: int(v, 16) for k, v in report["python_symbols"].items()}
        maps = self.adb("cat", f"/proc/{self.pid}/maps").decode()
        self.ranges = []
        for line in maps.splitlines():
            pieces = line.split()
            if pieces[1][0] == "r":
                a, b = pieces[0].split("-")
                self.ranges.append((int(a, 16), int(b, 16)))
        self.starts = [a for a, _ in self.ranges]
        self.blocks = {}

    def adb(self, *args):
        self.check()
        p = subprocess.run([self.adb_path, "-s", self.serial, "exec-out", *args], capture_output=True, timeout=10,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if p.returncode: raise ValueError("read failed")
        return p.stdout

    def read(self, addr, length):
        result = bytearray()
        while length:
            self.check()
            index = bisect.bisect_right(self.starts, addr) - 1
            if index < 0 or addr >= self.ranges[index][1]: raise ValueError("unmapped address")
            lo, hi = self.ranges[index]
            block = max(lo, addr // 65536 * 65536)
            end = min(hi, block + 65536)
            if block not in self.blocks:
                raw = self.adb("dd", f"if=/proc/{self.pid}/mem", "bs=4096", f"skip={block // 4096}", f"count={(end - block) // 4096}", "status=none")
                if len(raw) != end - block: raise ValueError("short memory block read")
                self.blocks[block] = raw
            chunk = self.blocks[block][addr - block:addr - block + length]
            if not chunk: raise ValueError("short read")
            result.extend(chunk)
            addr += len(chunk)
            length -= len(chunk)
        return bytes(result)

    def ptr(self, addr): return struct.unpack("<Q", self.read(addr, 8))[0]

    def text(self, addr):
        header = self.read(addr, 48)
        if struct.unpack_from("<Q", header, 8)[0] != self.symbols["PyUnicode_Type"]: raise ValueError("not unicode")
        length = struct.unpack_from("<Q", header, 16)[0]
        state = struct.unpack_from("<I", header, 32)[0]
        kind, compact, ascii = (state >> 2) & 7, (state >> 5) & 1, (state >> 6) & 1
        if length > 10000 or kind not in (1, 2, 4): raise ValueError("unexpected unicode layout")
        start = addr + (48 if ascii else 72) if compact else self.ptr(addr + 72)
        return self.read(start, length * kind).decode({1: "latin1", 2: "utf-16-le", 4: "utf-32-le"}[kind])

    def dictionary(self, addr, wanted=None):
        result = {}
        for key, val in self.dictionary_items(addr):
            try: name = self.text(key)
            except (ValueError, UnicodeError): continue
            if wanted is not None and name not in wanted: continue
            result[name] = val
            if wanted is not None and len(result) == len(wanted): break
        return result

    def dictionary_items(self, addr):
        head = self.read(addr, 48)
        if struct.unpack_from("<Q", head, 8)[0] != self.symbols["PyDict_Type"]: raise ValueError("not dictionary")
        used, _, keys, values = struct.unpack_from("<QQQQ", head, 16)
        kh = self.read(keys, 32)
        indices_log, kind = kh[9], kh[10]
        nentries = struct.unpack_from("<Q", kh, 24)[0]
        if nentries > 100000 or indices_log > 24 or kind > 2: raise ValueError("unexpected dictionary layout")
        entries = keys + 32 + (1 << indices_log)
        size = 24 if kind == 0 else 16
        raw = self.read(entries, nentries * size)
        for i in range(nentries):
            key, val = struct.unpack_from("<QQ", raw, i * size + (8 if kind == 0 else 0))
            if values: val = self.ptr(values + i * 8)
            if not key or not val: continue
            yield key, val

    def module_dictionary(self, addr):
        if self.ptr(addr + 8) != self.symbols["PyModule_Type"]: raise ValueError("not module")
        return self.dictionary(self.ptr(addr + 16))



class Objects:
    def __init__(self, reader):
        self.r = reader
        self.type_names = {}

    def type_name(self, address):
        t = self.r.ptr(address + 8)
        if t not in self.type_names:
            self.type_names[t] = self.r.read(self.r.ptr(t + 24), 96).split(b"\0")[0].decode("ascii")
        return self.type_names[t]

    def value(self, address, depth=0):
        if not address: return None
        if depth > 8: raise ValueError("unexpected nesting")
        kind = self.type_name(address)
        if kind == "NoneType": return None
        if kind == "str": return self.r.text(address)
        if kind in ("int", "bool"):
            size = struct.unpack("<q", self.r.read(address + 16, 8))[0]
            if abs(size) > 16: raise ValueError("unexpected integer size")
            digits = struct.unpack("<" + "I" * abs(size), self.r.read(address + 24, 4 * abs(size)))
            result = sum(d << (30 * i) for i, d in enumerate(digits)) * (-1 if size < 0 else 1)
            return bool(result) if kind == "bool" else result
        if kind == "float": return struct.unpack("<d", self.r.read(address + 16, 8))[0]
        if kind in ("list", "tuple"):
            count = self.r.ptr(address + 16)
            if count > 1000: raise ValueError("unexpected sequence size")
            start = address + 24 if kind == "tuple" else self.r.ptr(address + 24)
            return [self.value(self.r.ptr(start + i * 8), depth + 1) for i in range(count)]
        if kind == "dict":
            return {self.value(k, depth + 1): self.value(v, depth + 1) for k, v in self.r.dictionary_items(address)}
        if kind == "taggeddict.taggeddict":
            count = self.r.ptr(address + 24)
            if count > 10000: raise ValueError("unexpected tagged dictionary size")
            data = self.r.ptr(address + 16)
            return {self.value(self.r.ptr(data + i * 8) & ~7, depth + 1):
                    self.value(self.r.ptr(data + (i + 1) * 8) & ~7, depth + 1)
                    for i in range(0, count * 2, 2)}
        if kind == "bindict.bindict" and self.r.ptr(address + 16) == 0:
            return self.value(self.r.ptr(address + 24), depth + 1)
        raise ValueError("unexpected value type: " + kind)

    def slots(self, address):
        t = self.r.ptr(address + 8)
        members = self.r.dictionary(self.r.ptr(t + 264))
        result = {}
        for name, descriptor in members.items():
            if self.type_name(descriptor) != "member_descriptor": continue
            definition = self.r.ptr(descriptor + 40)
            if struct.unpack("<i", self.r.read(definition + 8, 4))[0] != 16:
                raise ValueError("unsupported slot type")
            result[name] = self.r.ptr(definition + 16)
        return result

    def fields(self, address):
        t = self.r.ptr(address + 8)
        if not self.r.ptr(t + 168) & 16:
            return {k: self.r.ptr(address + off) for k, off in self.slots(address).items()}
        dictionary = self.r.ptr(address - 24)
        if dictionary: return self.r.dictionary(dictionary)
        values, keys = self.r.ptr(address - 32), self.r.ptr(t + 880)
        header = self.r.read(keys, 32)
        count = self.r.ptr(keys + 24)
        if count > 300 or header[10] != 2 or header[9] > 20:
            raise ValueError("unexpected managed dictionary layout")
        entries = keys + 32 + (1 << header[9])
        result = {}
        for i in range(count):
            key, value = self.r.ptr(entries + i * 16), self.r.ptr(values + i * 8)
            if key and value: result[self.r.text(key)] = value
        return result

