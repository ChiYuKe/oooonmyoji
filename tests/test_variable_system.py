"""Variable declarations, read-only bindings and scope regression coverage."""
import pytest

from tests.test_workflows import (EchoAction, Context, registry, action_spec,
                           task, tree, validate, WorkflowEngine, ActionStatus, ConfigError)


def setup_tree():
    actions = registry(action_spec(EchoAction()))
    raw = tree([
        {"id":"seq", "type":"sequence", "children":["read"]},
        task("read", "test.echo", {"value":{"ref":"variables.count"}}),
    ], "seq", inputs={"start":{"type":"integer", "default":3}},
       variables={"count":{"type":"integer", "default":1, "display_name":"次数", "initial_from":"start"}})
    return raw, actions


def test_initializer_resets_read_only_value_each_run():
    raw, actions = setup_tree()
    engine = WorkflowEngine(validate(raw, actions), actions, Context(), {"start":4})
    for _ in range(2):
        result = engine.run()
        assert result.status == ActionStatus.SUCCEEDED
        assert result.output["read"] == {"value":4}
        assert engine.variables["count"] == 4
        engine.variables["count"] = 99


def test_initializer_must_name_declared_input():
    raw, actions = setup_tree()
    raw["variables"]["count"]["initial_from"] = "missing"
    with pytest.raises(ConfigError):
        validate(raw, actions)


def test_local_scope_reads_are_limited_to_owner_subtree():
    raw, actions = setup_tree()
    raw["variables"]["count"]["owner"] = "seq"
    engine = WorkflowEngine(validate(raw, actions), actions, Context(), {"start":4})
    assert engine.run().status == ActionStatus.SUCCEEDED
    assert engine.variables["count"] == 4
    raw["nodes"][0]["children"] = ["outer"]
    raw["nodes"].append({"id":"outer", "type":"sequence", "children":["seq","outside"]})
    raw["nodes"].append(task("outside","test.echo",{"value":{"ref":"variables.count"}}))
    with pytest.raises(ConfigError):
        validate(raw, actions)


def test_struct_variables_are_copied_and_snapshots_are_independent():
    raw, actions = setup_tree()
    shape = {"type":"object", "properties":{"x":{"type":"integer", "required":True}}, "default":{"x":1}}
    raw["inputs"]["start"] = shape
    raw["variables"]["count"] = dict(shape, initial_from="start")
    inputs = {"start":{"x":7}}
    snapshots = []
    engine = WorkflowEngine(validate(raw, actions), actions, Context(), inputs, on_step=snapshots.append)
    assert engine.run().status == ActionStatus.SUCCEEDED
    engine.variables["count"]["x"] = 8
    assert inputs["start"]["x"] == 7
    assert snapshots[-1]["variable_values"]["count"]["x"] == 7
