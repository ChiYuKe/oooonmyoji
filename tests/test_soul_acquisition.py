import struct
import unittest

from src.oooonmyoji.souls.acquisition import Cancelled, normalize_record, temporary_root
from src.oooonmyoji.souls.memory import Reader


class FakeAdb:
    def __init__(self, root=False, refuse=False):
        self.root, self.refuse, self.commands = root, refuse, []

    def ready_identity(self, check=True):
        return 'uid=0(root)' if self.root else 'uid=2000(shell)'

    def command(self, cmd, check=True):
        self.commands.append((cmd, check))
        self.root = cmd == 'root' and not self.refuse


class SoulAcquisitionTests(unittest.TestCase):
    def test_temporary_root_restores_on_success_failure_and_cancel(self):
        for failure in (None, ValueError('failed'), Cancelled()):
            with self.subTest(failure=failure):
                adb = FakeAdb()
                try:
                    with temporary_root(adb, lambda *args: None):
                        self.assertTrue(adb.root)
                        if failure: raise failure
                except (ValueError, Cancelled): pass
                self.assertFalse(adb.root)
                self.assertEqual(adb.commands, [('root', True), ('unroot', False)])

    def test_existing_root_permission_is_preserved(self):
        adb = FakeAdb(root=True)
        with temporary_root(adb, lambda *args: None): pass
        self.assertTrue(adb.root)
        self.assertEqual(adb.commands, [])

    def test_closed_progress_pipe_cannot_skip_permission_restoration(self):
        adb = FakeAdb()
        def progress(message):
            if '恢复' in message: raise BrokenPipeError()
        with temporary_root(adb, progress): pass
        self.assertFalse(adb.root)
        self.assertEqual(adb.commands[-1], ('unroot', False))

    def test_root_refusal_still_runs_cleanup(self):
        adb = FakeAdb(refuse=True)
        with self.assertRaisesRegex(ValueError, '不支持'):
            with temporary_root(adb, lambda *args: None): self.fail('must not read')
        self.assertEqual(adb.commands[-1], ('unroot', False))

    def test_memory_read_crosses_block_boundary_without_diagnostic_bytes(self):
        r = Reader.__new__(Reader)
        r.check = lambda: None
        r.ranges, r.starts, r.blocks, r.pid = [(0x10000, 0x30000)], [0x10000], {}, 1
        def read(*args):
            self.assertIn('status=none', args)
            skip = int(next(arg.split('=')[1] for arg in args if arg.startswith('skip=')))
            return (b'A' if skip == 16 else b'B') * 65536
        r.adb = read
        self.assertEqual(r.read(0x1fffc, 8), b'AAAABBBB')
        self.assertEqual(r.ptr(0x1fffc), struct.unpack('<Q', b'AAAABBBB')[0])

    def test_read_rejects_truncated_block(self):
        r = Reader.__new__(Reader)
        r.check = lambda: None
        r.ranges, r.starts, r.blocks, r.pid = [(0x10000, 0x20000)], [0x10000], {}, 1
        r.adb = lambda *args: b'partial'
        with self.assertRaisesRegex(ValueError, 'short'): r.read(0x10000, 8)

    def test_normalization_preserves_roll_factors_and_null_unknown_position(self):
        item = normalize_record('id', {'equipId': 150006, 'suitId': 300010, 'qua': 6,
                              'strongLevel': 0, 'lock': True, 'rattr': [['speedAdditionVal', .9]]})
        self.assertEqual(item['position'], 5)
        self.assertEqual(item['attributeRolls'], [{'name': 'speedAdditionVal', 'factor': .9}])
        self.assertIsNone(normalize_record('id', {})['position'])


if __name__ == '__main__': unittest.main()
