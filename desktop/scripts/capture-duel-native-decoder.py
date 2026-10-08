"""Disassemble the skill table's native reader without running any client function."""
from pathlib import Path
import sys
import capstone

SOURCE = Path(sys.argv[1])
sys.path.insert(0, str(SOURCE))
from yystool.resolve import Resolver
from yystool.pyfields import fields, module_dict
from yystool.pywalk import ElfSymbols
r = Resolver(verbose=False)
elf = ElfSymbols(str(SOURCE / 'dump/libclient.so'))
holder = r.module_globals('battleengine.TurnMgrComp')['DATA_SKILL']
module = fields(r.mem, r.rt, holder)['_dataModule']
data = module_dict(r.mem, r.rt, module)['bin_data']
mapping = r.mem.u64(r.mem.u64(data + 8) + 112)
reader = r.mem.u64(mapping + 8) - r.rt.base
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity/runtime/native-decoder'
output.mkdir(exist_ok=True)
symbols = {value: name for name, value in elf.symbols.items() if value}
machine = int.from_bytes(elf.data[18:20], 'little')
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64) if machine == 62 else capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
cs.skipdata = True

def dump(address, name):
    section = next((s for s in elf.secs.values() if s['addr'] <= address < s['addr'] + s['size']), None)
    if not section:
        return []
    offset = address - section['addr'] + section['offset']
    calls, lines, forward_end = [], [], address
    for instruction in cs.disasm(r.mem.read(r.rt.base + address, 4096), address):
        suffix = ''
        if instruction.mnemonic.startswith('j') and instruction.op_str.startswith('0x'):
            branch = int(instruction.op_str, 16)
            if address <= branch < address + 4096:
                forward_end = max(forward_end, branch)
        if instruction.mnemonic in ('bl', 'b', 'call', 'jmp') and instruction.op_str.lstrip('#').startswith('0x'):
            target = int(instruction.op_str.lstrip('#'), 16)
            suffix = symbols.get(target, '')
            if instruction.mnemonic in ('bl', 'call') and not suffix or instruction.mnemonic == 'jmp' and target < address:
                calls.append(target)
        lines.append(f'{instruction.address:x} {instruction.mnemonic:9} {instruction.op_str:35} {suffix}')
        if instruction.mnemonic == 'ret' and instruction.address >= forward_end:
            break
    (output / (name + '.txt')).write_text('\n'.join(lines), encoding='utf-8')
    return calls

calls = dump(reader, 'mapping-reader')
queue = [(target, 1) for target in dict.fromkeys(calls)]
seen = set()
while queue:
    target, depth = queue.pop(0)
    if target in seen or depth > 6 or not 0x44c0000 <= target < 0x44f0000:
        continue
    seen.add(target)
    children = dump(target, f'callee-{target:x}')
    queue.extend((child, depth + 1) for child in dict.fromkeys(children))
import struct, json
table = r.mem.read(r.rt.base + 0x15a9948, 48)
(output / 'tags.json').write_text(json.dumps({str(i + 1): hex(0x15a9948 + item) for i, item in
    enumerate(struct.unpack('<12i', table))}, indent=2), encoding='utf-8')
print(f'Native mapping reader: {reader:x}; {len(set(calls))} direct callees')
