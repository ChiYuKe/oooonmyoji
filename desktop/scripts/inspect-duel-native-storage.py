"""Inspect native skill storage pointers and ELF exports without client execution."""
from pathlib import Path
import json
import sys
SOURCE = Path(sys.argv[1])
sys.path.insert(0, str(SOURCE))
from yystool.resolve import Resolver
from yystool.pyfields import fields, module_dict, type_name, bindict_heads
from yystool.pywalk import region_of
r = Resolver(verbose=False)
holder = r.module_globals('battleengine.TurnMgrComp')['DATA_SKILL']
module = fields(r.mem, r.rt, holder)['_dataModule']
data = module_dict(r.mem, r.rt, module)['bin_data']
state = r.mem.u64(data + 16)
report = {'data': hex(data), 'state': hex(state), 'bytes': r.mem.read(state, 256).hex(' '), 'pointers': []}
for offset in range(0, 256, 8):
    pointer = r.mem.u64(state + offset)
    region = region_of(r.mem.regs, pointer)
    row = {'offset': offset, 'value': hex(pointer)}
    if region:
        row.update(type=type_name(r.mem, r.rt, pointer), memory=r.mem.read(pointer, 80).hex(' '))
    report['pointers'].append(row)
report['heads'] = [hex(x) for x in bindict_heads(r.mem, state)]
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity/runtime/native-storage.json'
output.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
