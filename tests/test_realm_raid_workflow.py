"""结界突破工作流的端到端语义回归。

这些用例锁定的是**行为契约**，而不是节点摆放：

- 有可突破的结界时，按 ``运行轮数`` 打满并成功结束；
- 打到一半没有结界了，要**成功**结束（不是失败），并且日志说清原因；
- 识别不到预期页面（不在结界突破页）要**失败**退出，不能被当成「打完了」；
- 从停在结算页的位置启动时，先点掉结算页再进循环。

桩 Action 只负责把「画面」翻译成 Action 结果，参数校验仍走真实的
Action manifest，因此工作流 JSON 本身也被这些用例守护。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, ActionStatus, build_action_registry
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.loader import WorkflowLoader

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_FILE = "结界突破_寮突.json"

SETTLEMENT_TEXT = "assets/templates/jxxx-templates.png"
ATTACK_BUTTON = "assets/templates/jg-template.png"
TARGET_LIT = "assets/templates/task_2-template.png"
TARGET_DIM = "assets/templates/task_2-templates.png"
REALM_TITLE = "assets/templates/realm/realm-title.png"
TARGET_TEMPLATES = {TARGET_LIT, TARGET_DIM}


class Context:
    """引擎需要的最小上下文；``log`` 收集 core.log 输出供断言使用。"""

    def __init__(self) -> None:
        self.logs: list[str] = []

    def check_cancelled(self) -> None:
        return None

    def begin_action(self) -> None:
        return None

    def bind_action(self, token: object) -> None:
        return None

    def end_action(self, token: object) -> None:
        return None

    def request_action_cancel(self, token: object = None) -> None:
        return None

    def log(self, message: str, **fields: Any) -> None:
        self.logs.append(message)


@dataclass
class World:
    """被桩 Action 读取的假画面状态。"""

    realm_page: bool = True
    targets: int = 2
    attack_present: bool = True
    settlement_present: bool = False
    calls: dict[str, int] = field(default_factory=dict)

    def hit(self, name: str) -> None:
        self.calls[name] = self.calls.get(name, 0) + 1


def _match(template: str) -> dict[str, Any]:
    return {
        "x": 300,
        "y": 96,
        "width": 53,
        "height": 60,
        "confidence": 0.94,
        "reference": [600.0, 192.0, 53.0, 60.0],
        "center": [326, 126],
        "template": template,
        "threshold": 0.85,
    }


class StubAction(Action):
    def __init__(self, world: World) -> None:
        self.world = world


class DetectState(StubAction):
    name = "vision.detect_state"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        self.world.hit("classify")
        if self.world.settlement_present:
            return ActionResult.succeeded(_state("settlement", SETTLEMENT_TEXT))
        if self.world.targets > 0:
            return ActionResult.succeeded(_state("target_lit", TARGET_LIT))
        return ActionResult.failed("none of the configured states matched", category="not_matched")


def _state(name: str, template: str) -> dict[str, Any]:
    return {"state": name, "source": "template", "confidence": 0.94, "match": _match(template), "elapsed_seconds": 0.01}


class WaitTemplate(StubAction):
    name = "vision.wait_template"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        template = str(arguments["template"])
        present = bool(arguments.get("present", True))
        self.world.hit(f"wait_template:{Path(template).name}")
        available = self._available(template)
        if available is present:
            return ActionResult.succeeded([_match(template)] if present else [])
        return ActionResult.failed(f"timed out waiting for template to {'appear' if present else 'disappear'}", category="vision")

    def _available(self, template: str) -> bool:
        name = Path(template).name
        if name == Path(REALM_TITLE).name:
            return self.world.realm_page
        if name == Path(ATTACK_BUTTON).name:
            return self.world.attack_present
        if name == Path(SETTLEMENT_TEXT).name:
            return self.world.settlement_present
        if name in {Path(item).name for item in TARGET_TEMPLATES}:
            return self.world.targets > 0
        return False


class WaitAny(StubAction):
    name = "vision.wait_any"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        self.world.hit("find_target")
        if self.world.targets > 0:
            template = str(arguments["templates"][0])
            return ActionResult.succeeded({"template": template, "match": _match(template), "elapsed_seconds": 0.01})
        return ActionResult.failed("none of the templates matched before timeout", category="not_matched")


class WaitAnyText(StubAction):
    name = "vision.wait_any_text"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        texts = [str(item) for item in arguments["texts"]]
        present = bool(arguments.get("present", True))
        if texts == ["结界突破"]:
            found = self.world.realm_page
        elif texts == ["点击屏幕继续"]:
            found = self.world.settlement_present
        else:  # pragma: no cover - 工作流目前只用这两种文字
            found = False
        if found is present:
            return ActionResult.succeeded({"matched_text": texts[0] if present else "", "confidence": 0.9 if present else 0.0, "present": present})
        return ActionResult.failed(f"timed out waiting for OCR text to {'appear' if present else 'disappear'}: {texts}", category="vision")


class TapMatch(StubAction):
    name = "input.tap_match"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        name = Path(str((arguments.get("match") or {}).get("template", ""))).name
        self.world.hit(f"tap:{name}")
        if name == Path(SETTLEMENT_TEXT).name:
            self.world.settlement_present = False
        elif name == Path(ATTACK_BUTTON).name:
            self.world.settlement_present = True  # 进攻后进入战斗，最终出现结算页
        elif name in {Path(item).name for item in TARGET_TEMPLATES}:
            self.world.targets = max(0, self.world.targets - 1)
        return ActionResult.succeeded({"revalidated": True, "skipped": False, "verified_gone": False})


def stub_registry(world: World) -> ActionRegistry:
    """真实 manifest + 桩实现：参数与输出 schema 仍由真实定义校验。"""

    real = build_action_registry(PROJECT_ROOT / "plugins" / "actions")
    registry = ActionRegistry()
    for name in ("core.log", "core.assert"):
        registry.register(real.get(name))
    for stub in (DetectState, WaitTemplate, WaitAny, WaitAnyText, TapMatch):
        registry.register(ActionSpec(real.get(stub.name).definition, stub(world)))
    return registry


@pytest.fixture(autouse=True)
def _without_decorator_delays(monkeypatch: pytest.MonkeyPatch) -> None:
    """重试/重复的等待间隔对语义没有影响，压掉以免用例变慢。"""

    monkeypatch.setattr(WorkflowEngine, "_sleep", lambda self, *args, **kwargs: None)


def run_workflow(world: World, rounds: int) -> tuple[Any, Context]:
    registry = stub_registry(world)
    loader = WorkflowLoader(PROJECT_ROOT / "workflows", registry, project_root=PROJECT_ROOT)
    spec = loader.load(WORKFLOW_FILE)
    context = Context()
    engine = WorkflowEngine(spec, registry, context, {"运行轮数": rounds})
    return engine.run(), context


def test_runs_the_requested_rounds_and_succeeds() -> None:
    world = World(realm_page=True, targets=5, attack_present=True, settlement_present=False)

    result, _ = run_workflow(world, 3)

    assert result.status == ActionStatus.SUCCEEDED
    assert result.error is None
    assert world.calls["classify"] == 3
    assert world.calls[f"tap:{Path(ATTACK_BUTTON).name}"] == 3
    assert "log_no_target" not in result.output


def test_stops_successfully_when_no_target_remains() -> None:
    world = World(realm_page=True, targets=1, attack_present=True, settlement_present=False)

    result, context = run_workflow(world, 5)

    assert result.status == ActionStatus.SUCCEEDED, result.error
    assert result.error_category is None
    # 只打了一轮就发现没有目标了，剩下的轮数没有空转。
    assert world.calls[f"tap:{Path(ATTACK_BUTTON).name}"] == 1
    assert world.targets == 0
    # 收尾分支跑过，并且日志说清了原因。
    assert result.output["log_no_target"]["message"] == "结界突破：页面上已无可突破的结界，结束本次运行"
    assert "正常结束" in result.output["log_finished"]["message"]
    assert any("已无可突破的结界" in message for message in context.logs)
    assert result.error is None


def test_fails_loudly_when_the_expected_page_is_not_there() -> None:
    """不在结界突破页时，不能被误判成「打完了」。"""

    world = World(realm_page=False, targets=0, attack_present=False, settlement_present=False)

    result, _ = run_workflow(world, 5)

    assert result.status == ActionStatus.FAILED
    assert "log_no_target" not in result.output
    assert "log_finished" not in result.output
    # 真正的根因仍留在步骤历史里（选择器最后返回的是收尾分支的条件未命中）。
    categories = [event.get("error_category") for event in result.step_history if event["step_id"] == "classify"]
    assert "not_matched" in categories


def test_dismisses_a_leftover_settlement_screen_before_raiding() -> None:
    world = World(realm_page=True, targets=1, attack_present=True, settlement_present=True)

    result, _ = run_workflow(world, 2)

    assert result.status == ActionStatus.SUCCEEDED, result.error
    assert world.calls[f"tap:{Path(SETTLEMENT_TEXT).name}"] == 2  # 一次清残留结算页 + 一次战斗后结算
    assert world.calls[f"tap:{Path(ATTACK_BUTTON).name}"] == 1
    assert world.settlement_present is False
    assert "log_no_target" not in result.output
