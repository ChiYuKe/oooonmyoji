"""Report unresolved blob record boundaries against known client rows, without guessing fields."""
import json
from pathlib import Path
import struct
import sys

source = Path(sys.argv[1])
blob = (source / 'dump/skill_blob.bin').read_bytes()
count = struct.unpack_from('<I', blob)[0]
offsets = struct.unpack_from(f'<{count}I', blob, 8)
base = 8 + count * 4
stream = blob[base + offsets[-1]:]
records = json.loads((source / 'out/skill_records_index.json').read_text(encoding='utf-8'))
known = json.loads((source / 'out/qianji_rows.json').read_text(encoding='utf-8'))
report = {'byteLength': len(blob), 'poolEntries': count, 'streamLength': len(stream),
          'indexedRecords': len(records), 'header': stream[:350].hex(' '), 'knownRecords': []}
for index, record in enumerate(records):
    # The scanner's 'a' is the integer type marker 01; 'b' is the level.
    key = f"({record['id']}, {record['b']}, -1)"
    if key not in known:
        continue
    end = records[index + 1]['off'] if index + 1 < len(records) else len(stream)
    report['knownRecords'].append({'key': key, 'offset': record['off'],
        'encoded': stream[record['off']:end].hex(' '), 'expected': known[key]})
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity/skill-blob-inspection.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('header:', report['header'])
for offset in [1238023, 2620, 4923, 6196, 6292, 5297, 5507, 153750, 1394444, 697222, 345868]:
    print('reference', offset, stream[offset:offset + 180].hex(' '))
for row in report['knownRecords'][:10]:
    print(row['key'], row['offset'], row['encoded'], row['expected'])
