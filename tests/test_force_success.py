"""`force_success` 装饰器：把节点的失败改写成成功（UE `UBTDecorator_ForceSuccess`）。

判定标准照抄 UE，不自己发明语义：

- Sequence 的判定（`Behavior Tree Node Reference: Composites` 原文）："Sequence nodes execute
  their children from left to right. They **stop executing when one of their children fails**.
  If a child fails, then the Sequence fails." —— Sequence 本身没有"失败继续"的开关。
- 要让某一步失败也不中断，UE 的做法是给**那个子节点**挂 Force Success
  （`UBTDecorator_ForceSuccess` 类描述："Change node result to Success useful for creating
  optional branches in sequence"），把它的结果改写成成功。

所以这里锁定的是：**改写对象是被装饰的那个节点的结果**，Sequence 语义一行不改。

Python 与 TypeScript 的常量一致性由 `tests/contract_check.py` 把关（`DECORATOR_TYPES`）。
"""

from __future__ import annotations

from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionResult, ActionStatus
from src.oooonmyoji.config.loader import _validate_json_schema
from src.oooonmyoji.exceptions import CancelledError, ConfigError
from src.oooonmyoji.workflows.dsl import emit_document, parse_document
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.graph_schema import GRAPH_SCHEMA

from tests.test_workflows import (
    Context,
    CountingAction,
    CountingFailAction,
    EchoAction,
    action_spec,
    registry,
    task,
    tree,
    validate,
)


class CancelAction(Action):
    name = "test.cancel"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        raise CancelledError("stop requested")


def _event(result: Any, step_id: str) -> dict[str, Any]:
    return next(item for item in result.step_history if item["step_id"] == step_id)


# --------------------------------------------------------------------------------------
# 运行语义
# --------------------------------------------------------------------------------------


def _optional_sequence(risky_decorators: list[dict[str, Any]]) -> dict[str, Any]:
    return tree([
        {"id": "steps", "type": "sequence", "children": ["first", "risky", "last"]},
        task("first", "test.echo"),
        task("risky", "test.count_fail", decorators=risky_decorators),
        task("last", "test.echo"),
    ], "steps")


def test_force_success_turns_a_failed_step_into_an_optional_branch() -> None:
    action = CountingFailAction()
    actions = registry(action_spec(EchoAction()), action_spec(action))
    raw = _optional_sequence([{"type": "force_success"}])

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.SUCCEEDED
    assert result.error is None
    assert action.calls == 1
    ids = [item["step_id"] for item in result.step_history]
    assert ids.index("first") < ids.index("risky") < ids.index("last"), "失败的那一步之后兄弟照常执行"
    assert _event(result, "steps")["status"] == ActionStatus.SUCCEEDED.value


def test_without_the_decorator_the_same_sequence_stops_at_the_failure() -> None:
    """对照：同样的文档、只去掉装饰器，Sequence 就停在失败的那一步。"""

    action = CountingFailAction()
    actions = registry(action_spec(EchoAction()), action_spec(action))
    raw = _optional_sequence([])

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.FAILED
    assert "last" not in [item["step_id"] for item in result.step_history]


def test_force_success_records_the_original_failure_on_the_step_event() -> None:
    """状态按父节点看到的结果记（succeeded），原始失败另存一份，日志里仍看得见。"""

    actions = registry(action_spec(EchoAction()), action_spec(CountingFailAction()))
    raw = _optional_sequence([{"type": "force_success"}])

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    risky = _event(result, "risky")
    assert risky["status"] == ActionStatus.SUCCEEDED.value
    assert risky["forced_success"] is True
    assert risky["original_status"] == ActionStatus.FAILED.value
    assert risky["original_error"] == "expected failure"
    assert risky["original_error_category"] == "test"
    # 不改写 `error`：`error` / `error_breadcrumb` 是"这里真的失败了"的信号。
    assert "error" not in risky
    assert "error_breadcrumb" not in risky


def test_force_success_on_a_subtree_makes_the_whole_branch_optional() -> None:
    """挂在子树（内层 Sequence）上 = UE 所说的「可选分支」：整段失败都不中断外层。"""

    actions = registry(action_spec(EchoAction()), action_spec(CountingFailAction()))
    raw = tree([
        {"id": "outer", "type": "sequence", "children": ["optional", "last"]},
        {"id": "optional", "type": "sequence", "decorators": [{"type": "force_success"}], "children": ["inner"]},
        task("inner", "test.count_fail"),
        task("last", "test.echo"),
    ], "outer")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.SUCCEEDED
    ids = [item["step_id"] for item in result.step_history]
    assert ids.index("optional") < ids.index("last")
    # 只有被装饰的那一层被改写：里面那步仍然如实记成失败。
    assert _event(result, "inner")["status"] == ActionStatus.FAILED.value
    assert "forced_success" not in _event(result, "inner")
    assert _event(result, "optional")["forced_success"] is True


def test_force_success_does_not_hide_the_failure_from_retry() -> None:
    """改写发生在 retry 之后：重试看的是真实结果，不会因为"反正会成功"而少试几次。"""

    action = CountingFailAction()
    actions = registry(action_spec(action))
    raw = tree([
        task("item", "test.count_fail", decorators=[{"type": "retry", "attempts": 3}, {"type": "force_success"}]),
    ], "item")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.SUCCEEDED
    assert action.calls == 3
    item = _event(result, "item")
    assert item["attempts"] == 3
    assert item["forced_success"] is True


def test_force_success_does_not_swallow_cancellation() -> None:
    """取消（UE 的 Aborted）不被改写：吞掉它会让"停止"这个信号消失。"""

    actions = registry(action_spec(EchoAction()), action_spec(CancelAction()))
    raw = tree([
        {"id": "steps", "type": "sequence", "children": ["risky", "last"]},
        task("risky", "test.cancel", decorators=[{"type": "force_success"}]),
        task("last", "test.echo"),
    ], "steps")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.CANCELLED
    risky = _event(result, "risky")
    assert risky["status"] == ActionStatus.CANCELLED.value
    assert "forced_success" not in risky
    assert "last" not in [item["step_id"] for item in result.step_history]


def test_force_success_does_not_invent_an_output_for_a_failed_node() -> None:
    """改写的是结果，不是输出：真失败过的节点没有 output，下游引用它会**响亮地**失败。

    UE 同样如此 —— Force Success 只改 node result，不会替任务去写黑板。校验期仍把它的输出当成
    可用（`graph.guaranteed_output_node_ids` 只按节点类型推），所以这里把运行期的实际后果钉住：
    引用取不到值 → 下游那个节点按 `workflow` 类错误失败，而不是静默拿到空值。
    """

    actions = registry(action_spec(EchoAction()), action_spec(CountingFailAction()))
    raw = tree([
        {"id": "steps", "type": "sequence", "children": ["risky", "after"]},
        task("risky", "test.count_fail", decorators=[{"type": "force_success"}]),
        task("after", "test.echo", params={"value": {"ref": "nodes.risky.output.calls"}}),
    ], "steps")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert _event(result, "risky")["status"] == ActionStatus.SUCCEEDED.value
    after = _event(result, "after")
    assert after["status"] == ActionStatus.FAILED.value
    assert after["error_category"] == "workflow"
    assert "reference is unavailable" in after["error"]


def test_force_success_plus_bool_judge_turns_a_step_outcome_into_a_boolean() -> None:
    """最典型的用法：**把「这一步成没成」变成一个 bool 给判断节点用。**

    观察者的成败本身不是值。`vision.wait_template` 可以用 `allow_timeout: true` 直接把结论
    变成输出里的 bool（`output.found`），那是它的正路；但对于**没有**这种开关的动作，
    通用做法是给它挂 `force_success`（失败不中断），再紧跟一张 `bool_judge` 写
    `exists nodes.<它>.output.<字段>`（成功才登记输出，失败时字段不存在 → 假），
    把 bool 接到判断节点的布尔条件口。

    顺带钉住一个坑：**不挂 `force_success` 时 `exists` 照样能过校验**（`exists` 按
    `possibly_available_node_ids` 判定），但运行时那一步失败会直接中断 Sequence，判断节点根本执行不到 ——
    这条路径看起来合法却永远走不通，所以这里两个方向都测。
    """

    def run(wait_action: Any) -> Any:
        actions = registry(action_spec(wait_action), action_spec(EchoAction()))
        raw = tree([
            {"id": "steps", "type": "sequence", "children": ["wait", "cond"]},
            task("wait", wait_action.name, decorators=[{"type": "force_success"}]),
            {"id": "judge", "type": "bool_judge", "expression": {"exists": {"ref": "nodes.wait.output.calls"}}},
            {"id": "cond", "type": "condition", "expression": {"ref": "nodes.judge.output.value"},
             "children": ["entered", "missed"], "ports": ["true", "false"]},
            task("entered", "test.echo"), task("missed", "test.echo"),
        ], "steps")
        return WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    hit = run(CountingAction())
    assert hit.status == ActionStatus.SUCCEEDED
    ids = [item["step_id"] for item in hit.step_history]
    assert "entered" in ids and "missed" not in ids, "等到了：bool_judge 为真，走真口"
    assert _event(hit, "judge")["output"] == {"value": True}
    assert "forced_success" not in _event(hit, "wait")

    miss = run(CountingFailAction())
    assert miss.status == ActionStatus.SUCCEEDED
    ids = [item["step_id"] for item in miss.step_history]
    assert "missed" in ids and "entered" not in ids, "没等到：bool_judge 为假，走假口"
    assert _event(miss, "judge")["output"] == {"value": False}
    assert _event(miss, "wait")["forced_success"] is True


def test_force_success_also_masks_a_condition_branch_miss() -> None:
    """判断节点不成立也是"失败"：挂上它，false 口没接也不会中断后面的步骤。"""

    actions = registry(action_spec(EchoAction()))
    raw = tree([
        {"id": "steps", "type": "sequence", "children": ["judge", "last"]},
        {"id": "judge", "type": "condition", "expression": {"eq": [1, 2]}, "decorators": [{"type": "force_success"}]},
        task("last", "test.echo"),
    ], "steps")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.SUCCEEDED
    judge = _event(result, "judge")
    assert judge["status"] == ActionStatus.SUCCEEDED.value
    assert judge["forced_success"] is True
    assert judge["original_error_category"] == "condition"


# --------------------------------------------------------------------------------------
# 校验与 DSL
# --------------------------------------------------------------------------------------


def test_validator_accepts_force_success_without_extra_fields() -> None:
    actions = registry(action_spec(EchoAction()))

    ok = validate(tree([task("item", "test.echo", decorators=[{"type": "force_success"}])], "item"), actions)
    assert [decorator.type for decorator in ok.node_map["item"].decorators] == ["force_success"]


def test_validator_rejects_extra_or_duplicate_force_success_fields() -> None:
    actions = registry(action_spec(EchoAction()))

    extra = tree([task("item", "test.echo", decorators=[{"type": "force_success", "seconds": 1}])], "item")
    with pytest.raises(ConfigError, match="unknown fields"):
        validate(extra, actions)

    duplicate = tree([task("item", "test.echo", decorators=[{"type": "force_success"}, {"type": "force_success"}])], "item")
    with pytest.raises(ConfigError, match="duplicate force_success"):
        validate(duplicate, actions)


def test_force_success_follows_the_existing_decorator_placement_rules() -> None:
    """它不是特权装饰器：root 与 instance_parallel 的既有禁令照样生效。"""

    actions = registry(action_spec(EchoAction()))
    raw = tree([task("item", "test.echo")], "item")
    raw["nodes"][0]["decorators"] = [{"type": "force_success"}]
    with pytest.raises(ConfigError, match="root cannot have decorators"):
        validate(raw, actions)


DSL_TEXT = "\n".join([
    "workflow force",
    "  version: 1.0.0",
    "  resolution: [1280, 720]",
    "  root: root",
    "  inputs: {}",
    "  variables: {}",
    "  node root root",
    "    at: [0, 0]",
    "  node item task",
    "    at: [0, 100]",
    "    action: input.tap",
    "    params: {}",
    "    decorator force_success",
    "  edges:",
    "    root -> item",
    "",
])


def test_dsl_writes_force_success_as_a_bare_decorator_line() -> None:
    document = parse_document(DSL_TEXT, path="force.owf")
    nodes = {node["id"]: node for node in document["nodes"]}
    assert nodes["item"]["decorators"] == [{"type": "force_success"}]

    text = emit_document(document)
    assert "    decorator force_success\n" in text
    # 它没有参数，所以不该写出任何子行（`decorator force_success` 下一行必须是下一个键/块）。
    assert "decorator force_success\n      " not in text
    # 再读一遍仍然是同一个装饰器（写-读稳定）。
    again = {node["id"]: node for node in parse_document(text, path="force.owf")["nodes"]}
    assert again["item"]["decorators"] == [{"type": "force_success"}]


def test_graph_schema_accepts_the_bare_force_success_decorator() -> None:
    """.owf 载入路径先过 `GRAPH_SCHEMA`（装饰器 type 是封闭枚举）。"""

    document = parse_document(DSL_TEXT, path="force.owf")
    _validate_json_schema(document, GRAPH_SCHEMA, "workflow graph force.owf")
