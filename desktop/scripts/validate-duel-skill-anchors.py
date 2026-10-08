"""Compare the checked-in skill table with rows directly decoded by the client."""
import json
from pathlib import Path
import re
import sys

source = Path(sys.argv[1])
repository = Path(__file__).resolve().parent.parent
truth = json.loads((source / 'out/skill_rows_captured.json').read_text(encoding='utf-8'))
generated = json.loads((repository / 'src/shared/game-skill-data.generated.json').read_text(encoding='utf-8'))
rows = generated['rows']
diffs = []
for key, expected in truth.items():
    match = re.fullmatch(r'\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*\)', key)
    if not match:
        diffs.append({'key': key, 'error': 'invalid truth key'})
        continue
    canonical = ':'.join(match.groups())
    actual = rows.get(canonical)
    if actual is None:
        diffs.append({'key': canonical, 'error': 'missing captured row'})
        continue
    for field, value in expected.items():
        if actual.get(field) != value:
            diffs.append({'key': canonical, 'field': field, 'expected': value, 'actual': actual.get(field)})

output = repository / 'out/duel-fidelity/runtime-anchor-validation.json'
report = {'anchorRows': len(truth), 'checkedFields': sum(map(len, truth.values())),
          'differences': diffs, 'passed': not diffs}
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'differences'}, ensure_ascii=False))
if diffs:
    raise SystemExit(f'{len(diffs)} differences; see {output}')
