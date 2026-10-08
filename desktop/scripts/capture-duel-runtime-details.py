"""Read nested turn-order code and loaded configuration; never execute client code."""
import contextlib
import json
from pathlib import Path
import sys

SOURCE = Path(sys.argv[1])
OUTPUT = Path(__file__).resolve().parent.parent / 'out' / 'duel-fidelity' / 'runtime'
sys.path[:0] = [str(SOURCE), str(SOURCE / 'tools')]
from yystool.resolve import Resolver
from yystool.pywalk import decode_unicode, read_dict_entries, region_of
from yystool.pyfields import OFF_TP_DICT, type_name, fields, scalar, module_dict
import disasm4

r = Resolver(verbose=False)
d = disasm4.Dis(r.pid)
old_base = int(next(line for line in (SOURCE / 'dump/maps.txt').read_text().splitlines()
                    if 'libclient.so' in line and int(line.split()[2], 16) == 0).split('-')[0], 16)
delta = d.rt.base - old_base
d.CACHES = list(d.mem.read(disasm4.CACHES_A + delta, 256))
d.DEOPT = list(d.mem.read(disasm4.DEOPT_A + delta, 256))

def nested(code, stem):
    with (OUTPUT / (stem + '.txt')).open('w', encoding='utf-8') as file, contextlib.redirect_stdout(file):
        d.code(code, max_inst=3000)
    constants = r.mem.u64(code + 24)
    for i in range(min(200, r.mem.u64(constants + 16))):
        value = r.mem.u64(constants + 24 + i * 8)
        if region_of(r.mem.regs, value) and type_name(r.mem, r.rt, value) == 'code':
            nested(value, stem + '-const-' + str(i))

turn = r.module_globals('battleengine.TurnMgrComp')['TurnMgrComp']
for key, func in read_dict_entries(r.mem, r.rt, r.mem.u64(turn + OFF_TP_DICT), hard_limit=500) or []:
    if decode_unicode(r.mem, key) != '_updateTurnPosOnce':
        continue
    for offset in range(16, 128, 8):
        code = r.mem.u64(func + offset)
        if region_of(r.mem.regs, code) and type_name(r.mem, r.rt, code) == 'code':
            nested(code, 'turn-order')
            break

details = {}
for module, names in [('com.const', ['JumpQueuePriority']),
                      ('battleengine.SkillAi', ['SKILL_AI_DATA']),
                      ('battleengine.TurnMgrComp', ['DATA_SKILL'])]:
    globals_ = r.module_globals(module)
    for name in names:
        value = globals_.get(name)
        if not value:
            continue
        tn = type_name(r.mem, r.rt, value)
        attributes = module_dict(r.mem, r.rt, value) if tn == 'module' else fields(r.mem, r.rt, value)
        if tn == 'type':
            attributes = {decode_unicode(r.mem, key): item for key, item in
                          read_dict_entries(r.mem, r.rt, r.mem.u64(value + OFF_TP_DICT), hard_limit=300) or []}
        details[module + '.' + name] = {'type': tn, 'address': hex(value), 'fields': {
            str(key): {'type': type_name(r.mem, r.rt, item), 'address': hex(item), 'value': scalar(r.mem, r.rt, item)}
            for key, item in attributes.items() if item and not str(key).startswith('__')}}
(OUTPUT / 'details.json').write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding='utf-8')
print('Captured turn sort code and configuration metadata', flush=True)
