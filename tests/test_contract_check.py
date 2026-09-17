"""把 tests/contract_check.py 接入 pytest：两端常量漂移必须让测试失败。"""
from __future__ import annotations

try:
    from tests import contract_check
except ImportError:  # 直接以 tests/ 为根目录运行时（例如 pytest tests）
    import contract_check  # type: ignore[no-redef]


def test_python_and_desktop_contracts_stay_aligned() -> None:
    assert contract_check.main() == 0
