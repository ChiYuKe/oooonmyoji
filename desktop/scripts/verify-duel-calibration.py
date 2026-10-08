"""Run the supplied reference validator on local outputs without changing its project."""
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sys

source = Path(sys.argv[1])
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity'
spec = spec_from_file_location('reference_validator', source / 'tools/validate_engine.py')
validator = module_from_spec(spec)
spec.loader.exec_module(validator)
validator.DS = str(output / 'guess_dataset.json')
validator.PR = str(output / 'predictions.json')
validator.OUT = str(output / 'reference-validation-report.json')
validator.main()
actual = json.loads((output / 'validation_report.json').read_text(encoding='utf-8'))
reference = json.loads((output / 'reference-validation-report.json').read_text(encoding='utf-8'))
for field in ('n', 'accuracy', 'brier', 'logloss'):
    if abs(actual[field] - reference[field]) > 1e-12:
        raise ValueError(f'Reference validation differs: {field}: {actual[field]} != {reference[field]}')
print('All metrics match the supplied reference validator.')
