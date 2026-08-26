"""用真实引擎源码（src/oooonmyoji）对拍扩展的校验规则。

不依赖任何 UI；把扩展 smoke.js 里的关键断言逐条交给引擎验证，
打印「引擎静态校验」与「引擎运行时行为」的真值，供与扩展逐项对照。

用法（在项目 venv 下）：
  .venv\\Scripts\\python.exe vscode-onmyoji-workflow/tests/engine_crosscheck.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve()
PROJECT_ROOT = HERE.parents[2]
SRC = PROJECT_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from oooonmyoji.actions.base import ActionSpec
from oooonmyoji.actions.builtin import BUILTIN_ACTIONS
from oooonmyoji.actions.registry import ActionRegistry
from oooonmyoji.exceptions import ConfigError, WorkflowError
from oooonmyoji.workflows.resolver import ReferenceResolver
from oooonmyoji.workflows.validator import validate_workflow


def registry() -> ActionRegistry:
    reg = ActionRegistry()
    for action, ins, outs, rs, se in BUILTIN_ACTIONS:
        reg.register(ActionSpec(action.name, "1.0.0", action, ins, outs, rs, se))
    return reg


REG = registry()

FIXTURE_EXPLORE = {
    "schema_version": 1, "id": "fixture_explore", "version": "1.0.0",
    "reference_resolution": [1920, 1080], "entry": "capture",
    "limits": {"timeout_seconds": 180, "max_steps": 50},
    "inputs_schema": {
        "type": "object",
        "properties": {
            "launch_x": {"type": "integer", "minimum": 0, "default": 1204},
            "enter_y": {"type": "integer", "minimum": 0, "default": 895},
            "verify_timeout": {"type": "number", "minimum": 0.1, "default": 10},
            "hold_ms": {"type": "integer", "minimum": 0, "default": 50},
        },
        "additionalProperties": False,
    },
    "steps": [
        {"id": "capture", "action": "core.capture", "on_success": "save"},
        {"id": "save", "action": "core.save_frame", "with": {"name": "01-before.png"}, "on_success": "wait"},
        {"id": "wait", "action": "vision.wait_template",
         "with": {"template": "assets/templates/onmyoji-launcher-icon.png",
                  "timeout_seconds": {"$ref": "inputs.verify_timeout"},
                  "roi": [1080, 450, 300, 250], "threshold": 0.7},
         "on_success": "tap"},
        {"id": "tap", "action": "input.tap",
         "when": {"and": [{"exists": {"$ref": "inputs.launch_x"}}, {"eq": [{"$ref": "inputs.hold_ms"}, 50]}]},
         "with": {"x": {"$ref": "inputs.launch_x"}, "y": {"$ref": "inputs.enter_y"}, "hold_ms": {"$ref": "inputs.hold_ms"}},
         "on_success": "log", "on_failure": "$failure"},
        {"id": "log", "action": "core.log", "with": {"message": "流程完成"}, "on_success": "$success"},
    ],
}

FIXTURE_DIAGNOSTIC = {
    "schema_version": 1, "id": "fixture_diagnostic", "version": "1.0.0",
    "reference_resolution": [1920, 1080], "entry": "capture",
    "inputs_schema": {
        "type": "object",
        "properties": {
            "template": {"type": "string", "minLength": 1},
            "threshold": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.85},
            "roi": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
            "ocr": {"type": "boolean", "default": True},
            "click": {"type": "object",
                      "properties": {"enabled": {"type": "boolean", "default": False},
                                     "revalidate": {"type": "boolean", "default": True},
                                     "hold_ms": {"type": "integer", "minimum": 0, "default": 0}},
                      "additionalProperties": False,
                      "default": {"enabled": False, "revalidate": True, "hold_ms": 0}},
        },
        "additionalProperties": False,
    },
    "steps": [
        {"id": "capture", "action": "core.capture", "on_success": "find"},
        {"id": "find", "action": "vision.match_template",
         "when": {"exists": {"$ref": "inputs.template"}},
         "with": {"template": {"$ref": "inputs.template"}, "roi": {"$ref": "inputs.roi"}, "threshold": {"$ref": "inputs.threshold"}},
         "on_success": "click", "on_skip": "ocr"},
        {"id": "click", "action": "input.tap_match",
         "when": {"and": [{"exists": {"$ref": "inputs.click.enabled"}},
                          {"eq": [{"$ref": "inputs.click.enabled"}, True]},
                          {"exists": {"$ref": "steps.find.output.0"}}]},
         "with": {"match": {"$ref": "steps.find.output.0"}, "revalidate": {"$ref": "inputs.click.revalidate"},
                  "hold_ms": {"$ref": "inputs.click.hold_ms"}},
         "on_success": "ocr", "on_skip": "ocr"},
        {"id": "ocr", "action": "vision.ocr",
         "when": {"eq": [{"$ref": "inputs.ocr"}, True]},
         "with": {"roi": {"$ref": "inputs.roi"}},
         "on_success": "$success", "on_skip": "$success"},
    ],
}


def static_v(wf, name):
    try:
        validate_workflow(wf, Path("workflows") / name, REG, project_root=PROJECT_ROOT)
        return "通过", None
    except ConfigError as exc:
        return "拒绝", str(exc)


def run_case(label, wf, expect_accept):
    verdict, msg = static_v(wf, "case.json")
    ok = (verdict == "通过") == expect_accept
    mark = "OK " if ok else "!! "
    print(f"{mark}[静态 {'通过' if verdict=='通过' else '拒绝'}] {label}")
    if msg:
        print(f"      引擎原因: {msg}")
    return ok


def main():
    failures = 0
    base = FIXTURE_EXPLORE

    print("== 合法样例（引擎静态应通过） ==")
    failures += 0 if run_case("explore 线性流程", FIXTURE_EXPLORE, True) else 1
    failures += 0 if run_case("diagnostic 分支流程", FIXTURE_DIAGNOSTIC, True) else 1

    print("\n== 非法样例（引擎静态应拒绝） ==")

    def one(*, entry="a", **kw):
        """构造只含单个入口步骤 a 的样例，避免 entry 与 steps 不一致。"""
        return dict(base, entry=entry, steps=kw["steps"])

    wf = one(steps=[{"id": "a", "action": "no.such.action", "on_success": "$success"}])
    failures += 0 if run_case("未知 Action", wf, False) else 1

    wf = one(steps=[{"id": "a", "action": "core.capture", "on_success": "ghost"}])
    failures += 0 if run_case("未知跳转目标", wf, False) else 1

    wf = dict(base, entry="a", steps=[
        {"id": "a", "action": "core.capture", "on_success": "b"},
        {"id": "a", "action": "core.log", "with": {"message": "x"}},
    ])
    failures += 0 if run_case("重复步骤 ID", wf, False) else 1

    wf = one(steps=[{"id": "a", "action": "input.tap", "retry": 3, "with": {"x": 1, "y": 2}, "on_success": "$success"}])
    failures += 0 if run_case("非法重试（input.tap 有副作用）", wf, False) else 1

    wf = one(steps=[{"id": "a", "action": "core.log", "with": {"message": {"$ref": "steps.bogus.output.0"}}, "on_success": "$success"}])
    failures += 0 if run_case("非法 $ref（未知步骤）", wf, False) else 1

    wf = one(steps=[{"id": "a", "action": "core.capture", "when": {"nope": True}, "on_success": "$success"}])
    failures += 0 if run_case("when 未知运算符", wf, False) else 1

    wf = one(steps=[{"id": "a", "action": "core.capture", "when": {"exists": True}, "on_success": "$success"}])
    failures += 0 if run_case("when exists 缺 $ref", wf, False) else 1

    wf = dict(base, entry="a", steps=[
        {"id": "orphan", "action": "core.capture", "on_success": "$success"},
        {"id": "a", "action": "core.capture", "on_success": "$success"},
    ])
    failures += 0 if run_case("不可达步骤", wf, False) else 1

    print("\n== 与扩展对齐的宽松/严格点 ==")
    # 嵌套结构操作数：引擎静态应通过
    wf = one(steps=[{"id": "a", "action": "core.capture",
                     "when": {"eq": [{"a": {"$ref": "inputs.launch_x"}}, {"a": 5}]},
                     "on_success": "$success"}])
    failures += 0 if run_case("when 二元操作数=嵌套结构（扩展已放宽）", wf, True) else 1

    # core.capture 带未知 with 参数：引擎静态「通过」，运行时「拒绝」
    wf = one(steps=[{"id": "a", "action": "core.capture", "with": {"nope": 1}, "on_success": "$success"}])
    verdict, _ = static_v(wf, "case.json")
    print(f"[静态 {'通过' if verdict=='通过' else '拒绝'}] core.capture 未知 with 参数（引擎静态不查 with）")
    from jsonschema import Draft202012Validator
    spec = REG.get("core.capture")
    err = next(iter(Draft202012Validator(spec.input_schema).iter_errors({"nope": 1})), None)
    print(f"      [运行时] 引擎执行时会拒绝: {err.message if err else '（竟然通过）'}")

    # when 直接 $ref：引擎静态「通过」，运行时会炸
    wf = one(steps=[{"id": "a", "action": "core.capture", "when": {"$ref": "inputs.launch_x"}, "on_success": "$success"}])
    verdict, _ = static_v(wf, "case.json")
    print(f"[静态 {'通过' if verdict=='通过' else '拒绝'}] when 直接 $ref（引擎静态不查）")
    try:
        ReferenceResolver({"launch_x": 1}, {}).condition({"$ref": "inputs.launch_x"})
        runtime = "通过（意外）"
    except WorkflowError as exc:
        runtime = f"拒绝: {exc}"
    print(f"      [运行时] engine.condition() = {runtime}")

    # input.tap 的 x/y 是 number（非 integer），浮点坐标静态可通过、运行时会 int() 截断
    wf = one(steps=[{"id": "a", "action": "input.tap", "with": {"x": 10.7, "y": 20.2}, "on_success": "$success"}])
    failures += 0 if run_case("input.tap 浮点 x/y（schema 为 number）", wf, True) else 1

    print("\n" + ("全部对拍通过" if failures == 0 else f"有 {failures} 处与我读码时的预期不符"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
