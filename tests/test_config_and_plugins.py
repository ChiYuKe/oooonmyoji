from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.oooonmyoji.actions import build_action_registry
from src.oooonmyoji.actions.manifest import (
    ACTION_MANIFEST_SCHEMA,
    CARD_CONTROLS,
    COLOR_PATTERN,
    KEY_PATTERN,
    POINT_SCHEMA,
    ActionDefinition,
    ParameterDefinition,
    apply_parameter_defaults,
    compile_parameters,
)
from src.oooonmyoji.config import load_config
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.loader import WorkflowLoader


def _write_config(path: Path, *, tasks: list[dict] | None = None) -> Path:
    config_dir = path / "config"
    config_dir.mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    (path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 4,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = config_dir / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "instances": [{"id": "one", "backend": "adb", "adb_serial": "serial"}],
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "tasks": tasks or [{"id": "check", "workflow": "simple", "instance": "one"}],
    }), encoding="utf-8")
    return config_path


def test_config_and_workflow_manifest_validate(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))
    registry = build_action_registry(config.action_dir)
    workflows = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir).discover()
    assert config.instance("one").backend == "adb"
    assert config.discover_mumu_instances is False
    assert workflows["simple"].resolution == (1920, 1080)


def test_workflow_loader_reuses_snapshot_until_file_changes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    registry = build_action_registry(config.action_dir)
    loader = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir)
    workflow_path = config.workflow_dir / "simple.json"

    first = loader.load("simple")
    second = loader.load("simple")
    assert first is not second
    assert first.file_hash == second.file_hash
    first.raw["id"] = "mutated"
    assert loader.load("simple").workflow_id == "simple"

    original_stat = workflow_path.stat()
    workflow_path.write_text(workflow_path.read_text(encoding="utf-8").replace("3.0.0", "3.0.1"), encoding="utf-8")
    assert loader.load("simple").version == "3.0.1"
    assert loader.load("simple").file_hash != first.file_hash
    assert workflow_path.stat().st_mtime_ns >= original_stat.st_mtime_ns


def test_config_indexes_preserve_lookup_and_missing_id_behavior(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))

    assert config.instance("one").id == "one"
    assert config.job("check").id == "check"
    with pytest.raises(StopIteration):
        config.instance("missing")
    with pytest.raises(StopIteration):
        config.job("missing")


def test_template_match_actions_declare_structured_array_items(tmp_path: Path) -> None:
    action_dir = tmp_path / "plugins" / "actions"
    action_dir.mkdir(parents=True)
    registry = build_action_registry(action_dir)
    for action_name in ("vision.match_template", "vision.wait_template"):
        output = registry.get(action_name).output_schema
        assert output["type"] == "array"
        item = output["items"]
        assert item["type"] == "object"
        assert item["properties"]["confidence"]["type"] == "number"
        assert item["properties"]["reference"]["minItems"] == 4
        assert item["properties"]["center"]["maxItems"] == 2


def test_config_rejects_unknown_instance_reference(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="unknown instance"):
        load_config(_write_config(tmp_path, tasks=[{"id": "bad", "workflow": "simple", "instance": "missing"}]))


def test_config_rejects_missing_explicit_mumu_path(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    raw["mumu_path"] = str(tmp_path / "missing-mumu")
    config_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ConfigError, match="mumu_path does not exist"):
        load_config(config_path)


def test_schema_version_one_is_rejected(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    raw["schema_version"] = 1
    config_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ConfigError, match="schema_version 1"):
        load_config(config_path)


def test_action_loader_rejects_duplicate_names(tmp_path: Path) -> None:
    root = tmp_path / "actions"
    root.mkdir()
    for name in ("one", "two"):
        directory = root / name
        directory.mkdir()
        (directory / "action.json").write_text(json.dumps({
            "schema_version": 2,
            "name": "custom.same",
            "version": "1.0.0",
            "entry": "action.py:Example",
            "parameters": {},
        }), encoding="utf-8")
        (directory / "action.py").write_text(
            "from src.oooonmyoji.actions.base import Action, ActionResult\n"
            "class Example(Action):\n"
            "    name = 'custom.same'\n"
            "    def execute(self, context, arguments):\n"
            "        return ActionResult.succeeded({})\n",
            encoding="utf-8",
        )
    with pytest.raises(Exception, match="duplicate Action name"):
        build_action_registry(root)


def test_parameter_definitions_apply_nested_constraints_and_defaults() -> None:
    options = ParameterDefinition.parse(
        "options",
        {
            "type": "object",
            "default": {},
            "properties": {
                "enabled": {"type": "boolean", "required": True, "default": True},
                "items": {
                    "type": "array",
                    "default": [{}],
                    "items": {
                        "type": "object",
                        "properties": {"count": {"type": "integer", "required": True, "default": 2}},
                    },
                },
            },
        },
    )
    nullable = ParameterDefinition.parse("nullable", {"type": "any", "default": None})
    schema = compile_parameters({"options": options, "nullable": nullable})
    assert schema["properties"]["options"]["required"] == ["enabled"]
    assert schema["properties"]["nullable"]["default"] is None
    assert apply_parameter_defaults({"options": options, "nullable": nullable}, {}) == {
        "options": {"enabled": True, "items": [{"count": 2}]},
        "nullable": None,
    }


@pytest.mark.parametrize(
    "manifest, message",
    [
        (
            {"schema_version": 2, "name": "bad.range", "entry": "x.py:X", "parameters": {"count": {"type": "integer", "min": 10, "max": 1}}},
            "min must be <= max",
        ),
        (
            {"schema_version": 2, "name": "bad.default", "entry": "x.py:X", "parameters": {"count": {"type": "integer", "default": "one"}}},
            "default",
        ),
        (
            {"schema_version": 2, "name": "bad.output", "entry": "x.py:X", "parameters": {}, "outputs": {"type": "not-a-type"}},
            "outputs is not a valid JSON Schema",
        ),
    ],
)
def test_action_definition_rejects_invalid_manifest_semantics(manifest: dict[str, object], message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        ActionDefinition.parse(manifest)


def _card_manifest(rows: list[dict], parameters: dict | None = None) -> dict:
    return {
        "schema_version": 2,
        "name": "card.demo",
        "entry": "x.py:X",
        "parameters": parameters if parameters is not None else {
            "template": {"type": "asset", "required": True},
            "timeout_seconds": {"type": "duration", "default": 5},
            "present": {"type": "boolean", "default": True},
        },
        "card": {"rows": rows},
    }


def test_action_definition_parses_card_rows_in_declaration_order() -> None:
    """`card.rows` 是有序的固定卡片端点：标签覆盖共享字段名，布尔行可命名两种状态。"""
    definition = ActionDefinition.parse(_card_manifest([
        {"param": "template", "label": "模板"},
        {"param": "timeout_seconds", "label": "超时", "control": "number"},
        {"param": "present", "label": "存在性", "on_label": "等待出现", "off_label": "等待消失"},
    ]))
    assert [row.param for row in definition.card] == ["template", "timeout_seconds", "present"]
    assert [row.label for row in definition.card] == ["模板", "超时", "存在性"]
    assert definition.card[1].control == "number"
    assert (definition.card[2].on_label, definition.card[2].off_label) == ("等待出现", "等待消失")


def test_action_definition_accepts_tuple_control_for_fixed_length_arrays() -> None:
    """固定长度数组用 tuple 控件拆成输入格（随机间隔 → 两个输入）。"""
    manifest = _card_manifest(
        [{"param": "template"}, {"param": "random_interval", "control": "tuple"}],
        parameters={
            "template": {"type": "asset", "required": True},
            "random_interval": {
                "type": "array",
                "items": {"type": "duration", "min": 0},
                "min_items": 2,
                "max_items": 2,
                "default": [0, 0],
            },
        },
    )
    definition = ActionDefinition.parse(manifest)
    assert definition.card[1].control == "tuple"
    assert "tuple" in CARD_CONTROLS


def test_action_definition_without_card_keeps_empty_declaration() -> None:
    """没声明 card 的 Action 保持旧卡片行为：Python 侧只需要能通过校验。"""
    manifest = _card_manifest([])
    manifest.pop("card")
    assert ActionDefinition.parse(manifest).card == ()


@pytest.mark.parametrize(
    "rows, message",
    [
        ([{"param": "nope"}], "references unknown parameter"),
        ([{"param": "template"}, {"param": "template"}], "declared twice"),
        ([{"param": "template", "control": "zoom"}], "unknown control"),
        ([{"param": "timeout_seconds"}], "must cover required parameters"),
        ([{"param": "template", "hidden": True}, {"param": "timeout_seconds"}], "cannot be hidden"),
        (["template"], "entries must be objects"),
        ([{"label": "模板"}], "need a non-empty param"),
    ],
)
def test_action_definition_rejects_bad_card_rows(rows: list[object], message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        ActionDefinition.parse(_card_manifest(rows))


def test_builtin_manifests_declare_cards_for_their_required_parameters() -> None:
    """内置 manifest 的卡片声明必须与参数定义自洽（与 Registry 启动时同一套校验）。"""
    from jsonschema import Draft202012Validator

    manifests_dir = Path(__file__).resolve().parents[1] / "src" / "oooonmyoji" / "actions" / "manifests"
    validator = Draft202012Validator(ACTION_MANIFEST_SCHEMA)
    declared: dict[str, tuple] = {}
    for path in sorted(manifests_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        errors = list(validator.iter_errors(raw))
        assert not errors, f"{path.name}: {errors[0].message if errors else ''}"
        definition = ActionDefinition.parse(raw)
        declared[definition.name] = definition.card

    wait_template = [row.param for row in declared["vision.wait_template"]]
    assert wait_template == [
        "template", "timeout_seconds", "present", "roi", "threshold", "scale_search",
    ]
    assert [row.label for row in declared["vision.wait_template"]] == [
        "模板", "超时", "存在性", "识别区域", "匹配阈值", "多尺度搜索",
    ]
    with_card = [name for name, rows in declared.items() if rows]
    assert len(with_card) >= 20, f"声明卡片的 Action 太少：{with_card}"
    # core.capture 没有参数，无法也没有必要声明卡片。
    assert declared["core.capture"] == ()


def test_new_parameter_types_compile_to_expected_schemas() -> None:
    """point / enum / key / color / duration 的值形状与约束。"""
    assert ParameterDefinition.parse("point", {"type": "point"}).to_schema() == {
        "type": "object",
        "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
        "required": ["x", "y"],
        "additionalProperties": False,
    }
    assert ParameterDefinition.parse("color", {"type": "color"}).to_schema() == {
        "type": "string",
        "pattern": COLOR_PATTERN,
    }
    assert ParameterDefinition.parse("key", {"type": "key", "min_length": 1}).to_schema() == {
        "type": "string",
        "pattern": KEY_PATTERN,
        "minLength": 1,
    }
    assert ParameterDefinition.parse("wait", {"type": "duration", "min": 0.5, "max": 3}).to_schema() == {
        "type": "number",
        "minimum": 0.5,
        "maximum": 3,
    }
    assert ParameterDefinition.parse("mode", {"type": "enum", "enum": ["safe", "fast"]}).to_schema() == {
        "type": "string",
        "enum": ["safe", "fast"],
    }


def test_new_parameter_types_validate_defaults() -> None:
    parsed = ParameterDefinition.parse(
        "point",
        {"type": "point", "default": {"x": 1, "y": 2}},
    )
    assert parsed.default == {"x": 1, "y": 2}
    assert ParameterDefinition.parse("mode", {"type": "enum", "enum": ["a"], "default": "a"}).default == "a"
    assert ParameterDefinition.parse("key", {"type": "key", "default": "BACK"}).default == "BACK"
    assert ParameterDefinition.parse("color", {"type": "color", "default": "#0a0b0c"}).default == "#0a0b0c"
    assert ParameterDefinition.parse("wait", {"type": "duration", "default": 1.5}).default == 1.5


@pytest.mark.parametrize(
    "definition, message",
    [
        ({"type": "enum"}, "enum type requires a non-empty enum list"),
        ({"type": "enum", "enum": []}, "enum type requires a non-empty enum list"),
        ({"type": "enum", "enum": [1, 2]}, r"enum\[0\] must be a string"),
        ({"type": "point", "min": 1}, "min/max are only valid for numeric types"),
        ({"type": "color", "min_length": 1}, "min_length/max_length are only valid for string types"),
        ({"type": "color", "default": "red"}, "default"),
        ({"type": "point", "default": {"x": 1}}, "default"),
        ({"type": "key", "default": "BACK SPACE"}, "default"),
        ({"type": "duration", "default": "soon"}, "default"),
    ],
)
def test_new_parameter_types_reject_invalid_definitions(definition: dict[str, object], message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        ParameterDefinition.parse("candidate", definition)


def test_promoted_input_definitions_pass_python_validation(tmp_path: Path) -> None:
    """桌面「提升为变量」写出的定义（结构字段 + 字面量默认值）必须能被 Python 侧编译并绑定。"""
    config = load_config(_write_config(tmp_path))
    registry = build_action_registry(config.action_dir)
    workflow_path = config.workflow_dir / "simple.json"
    body: dict[str, object] = {
        "schema_version": 4,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {
            "随机间隔_秒": {
                "type": "array", "items": {"type": "duration", "min": 0},
                "min_items": 2, "max_items": 2, "default": [0.2, 0.6], "display_name": "随机间隔（秒）",
            },
            "识别区域": {"type": "rect", "default": [10, 20, 30, 40], "display_name": "识别区域"},
            "match": {"type": "object", "default": {"x": 1, "y": 2}},
        },
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["seq"]},
            {"id": "seq", "type": "sequence", "children": ["tap"]},
            {"id": "tap", "type": "task", "action": "input.tap_match", "params": {
                "match": {"ref": "inputs.match"},
                "random_interval": {"ref": "inputs.随机间隔_秒"},
            }},
        ],
    }
    workflow_path.write_text(json.dumps(body), encoding="utf-8")
    workflow = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir).load("simple")
    properties = workflow.input_schema["properties"]
    assert properties["随机间隔_秒"]["items"] == {"type": "number", "minimum": 0}
    assert (properties["随机间隔_秒"]["minItems"], properties["随机间隔_秒"]["maxItems"]) == (2, 2)
    assert properties["识别区域"] == {
        "type": "array",
        "prefixItems": [{"type": "integer"}] * 4,
        "minItems": 4,
        "maxItems": 4,
        "default": [10, 20, 30, 40],
    }
    assert properties["match"]["default"] == {"x": 1, "y": 2}
    # 绑定到参数后仍然合法：数组对数组、对象对对象。
    tap = next(node for node in workflow.nodes if node.id == "tap")
    assert tap.params["random_interval"] == {"ref": "inputs.随机间隔_秒"}
    assert tap.params["match"] == {"ref": "inputs.match"}


def test_workflow_variables_accept_new_parameter_types(tmp_path: Path) -> None:
    """变量定义与动作参数走同一套规则：新类型能编译进变量 schema 并被任务引用。"""
    config = load_config(_write_config(tmp_path))
    registry = build_action_registry(config.action_dir)
    workflow_path = config.workflow_dir / "simple.json"
    body: dict[str, object] = {
        "schema_version": 4,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {
            "目标点": {"type": "point", "default": {"x": 960, "y": 540}},
            "主题色": {"type": "color", "default": "#ff8c3a"},
            "挑战模式": {"type": "enum", "enum": ["安全", "快速"], "default": "安全"},
            "稳定等待": {"type": "duration", "default": 1.5, "min": 0},
            "关闭按键": {"type": "key", "default": "BACK"},
        },
        "nodes": [
            {"id": "root", "type": "root", "children": ["seq"]},
            {"id": "seq", "type": "sequence", "children": ["key", "sleep"]},
            {"id": "key", "type": "task", "action": "input.key", "params": {"keycode": {"ref": "variables.关闭按键"}}},
            {"id": "sleep", "type": "task", "action": "core.sleep", "params": {"seconds": 1.5}},
        ],
    }
    workflow_path.write_text(json.dumps(body), encoding="utf-8")
    workflow = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir).load("simple")
    assert workflow.variable_defaults == {
        "目标点": {"x": 960, "y": 540},
        "主题色": "#ff8c3a",
        "挑战模式": "安全",
        "稳定等待": 1.5,
        "关闭按键": "BACK",
    }
    properties = workflow.variable_schema["properties"]
    assert {key: value for key, value in properties["目标点"].items() if key != "default"} == POINT_SCHEMA
    assert properties["目标点"]["default"] == {"x": 960, "y": 540}
    assert properties["主题色"]["pattern"] == COLOR_PATTERN
    assert properties["关闭按键"]["pattern"] == KEY_PATTERN
    assert properties["挑战模式"]["enum"] == ["安全", "快速"]
    assert properties["稳定等待"]["minimum"] == 0
    # 枚举变量缺少选项列表时按同一规则拒绝。
    variables = body["variables"]
    assert isinstance(variables, dict)
    variables["挑战模式"] = {"type": "enum", "default": "安全"}
    workflow_path.write_text(json.dumps(body), encoding="utf-8")
    with pytest.raises(ConfigError, match="enum type requires a non-empty enum list"):
        WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir).load("simple")

