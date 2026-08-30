from __future__ import annotations

from typing import Any

from src.oooonmyoji.actions import ActionStatus
from src.oooonmyoji.actions.builtin import (
    MatchTemplateAction,
    RunWorkflowAction,
    SelectWorkflowAction,
    SequenceWorkflowAction,
)
from src.oooonmyoji.vision.template import TemplateMatch


class MatchContext:
    def __init__(self, matches: list[TemplateMatch]) -> None:
        self.matches = matches

    def find_template(self, *_args: Any, **_kwargs: Any) -> list[TemplateMatch]:
        return self.matches


class SubworkflowContext:
    def __init__(self, results: list[tuple[str, Any, str | None, str | None]]) -> None:
        self.results = list(results)
        self.calls: list[str] = []

    def run_subworkflow(self, workflow: str, _inputs: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
        self.calls.append(workflow)
        return self.results.pop(0)


def test_match_template_reports_match_and_not_matched() -> None:
    arguments = {"template": "assets/templates/target.png", "threshold": 0.95}

    missed = MatchTemplateAction().execute(MatchContext([]), arguments)
    assert missed.status == ActionStatus.FAILED
    assert missed.error_category == "not_matched"
    assert missed.output == []

    match = TemplateMatch(10, 20, 30, 40, 0.99, 10.0, 20.0, 30.0, 40.0)
    found = MatchTemplateAction().execute(MatchContext([match]), arguments)
    assert found.status == ActionStatus.SUCCEEDED
    assert found.output[0]["confidence"] == 0.99
    assert found.output[0]["template"] == arguments["template"]


def test_workflow_run_returns_full_receipts_for_every_terminal_status() -> None:
    action = RunWorkflowAction()
    arguments = {"workflow": "child.json", "inputs": {}}

    succeeded = action.execute(SubworkflowContext([("succeeded", [1], None, None)]), arguments)
    assert succeeded.status == ActionStatus.SUCCEEDED
    assert succeeded.output == {
        "workflow": "child.json",
        "status": "succeeded",
        "output": [1],
        "error": None,
        "error_category": None,
    }

    failed = action.execute(SubworkflowContext([("failed", [], "not found", "not_matched")]), arguments)
    assert failed.status == ActionStatus.FAILED
    assert failed.error_category == "not_matched"
    assert failed.output["status"] == "failed"
    assert failed.output["error"] == "not found"

    cancelled = action.execute(SubworkflowContext([("cancelled", {}, "stopped", "cancelled")]), arguments)
    assert cancelled.status == ActionStatus.CANCELLED
    assert cancelled.output["status"] == "cancelled"
    assert cancelled.output["error_category"] == "cancelled"


def test_workflow_select_falls_through_and_sequence_stops_with_attempt_receipts() -> None:
    selected_context = SubworkflowContext([
        ("failed", [], "not found", "not_matched"),
        ("succeeded", {"ok": True}, None, None),
    ])
    selected = SelectWorkflowAction().execute(
        selected_context,
        {"workflows": ["first.json", "second.json"], "inputs": {}},
    )
    assert selected.status == ActionStatus.SUCCEEDED
    assert selected_context.calls == ["first.json", "second.json"]
    assert [item["status"] for item in selected.output["attempts"]] == ["failed", "succeeded"]
    assert selected.output["attempts"][0]["error_category"] == "not_matched"

    sequence_context = SubworkflowContext([
        ("succeeded", {"step": 1}, None, None),
        ("failed", {}, "timed out", "workflow_timeout"),
        ("succeeded", {"step": 3}, None, None),
    ])
    sequenced = SequenceWorkflowAction().execute(
        sequence_context,
        {"workflows": ["one.json", "two.json", "three.json"], "inputs": {}},
    )
    assert sequenced.status == ActionStatus.FAILED
    assert sequence_context.calls == ["one.json", "two.json"]
    assert sequenced.output["status"] == "failed"
    assert sequenced.output["error_category"] == "workflow_timeout"
    assert len(sequenced.output["attempts"]) == 2
