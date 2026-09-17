"""子工作流动作：运行、选择器与顺序执行。"""

from __future__ import annotations

from ..base import Action, ActionResult

from typing import Any

from ...exceptions import AutomationError, CancelledError

class RunWorkflowAction(Action):
    """运行另一个工作流（脚本嵌套调用），并把子脚本的“回执”作为步骤输出返回。"""

    name = "workflow.run"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        reference = arguments.get("workflow")
        if not isinstance(reference, str) or not reference.strip():
            return ActionResult.failed("workflow must be a workflow id or path below workflows/", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        try:
            status, output, error, error_category = context.run_subworkflow(reference, inputs)
        except CancelledError:
            raise
        except AutomationError as exc:
            receipt = _subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value)
            return ActionResult.failed(str(exc), category=exc.category.value, output=receipt)
        receipt = _subworkflow_receipt(reference, status, output, error, error_category)
        if status == "succeeded":
            return ActionResult.succeeded(receipt)
        if status == "cancelled":
            return ActionResult.cancelled(error or "subworkflow cancelled", output=receipt)
        return ActionResult.failed(
            f"subworkflow {reference} failed: {error or 'unknown error'}",
            category=error_category or "subworkflow",
            output=receipt,
        )


class SelectWorkflowAction(Action):
    """UE 行为树 Selector 语义：按顺序尝试子工作流，一个成功即成功，全部失败才失败。"""

    name = "workflow.select"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        refs = arguments.get("workflows")
        if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and r.strip() for r in refs):
            return ActionResult.failed("workflows must be a non-empty array of workflow references", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        attempts: list[dict[str, Any]] = []
        for reference in refs:
            try:
                status, output, error, error_category = context.run_subworkflow(reference, inputs)
            except CancelledError:
                raise
            except AutomationError as exc:
                attempts.append(_subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value))
                continue
            receipt = _subworkflow_receipt(reference, status, output, error, error_category)
            attempts.append(receipt)
            if status == "succeeded":
                return ActionResult.succeeded({
                    "workflow": reference,
                    "status": "succeeded",
                    "output": output,
                    "error": None,
                    "error_category": None,
                    "attempts": attempts,
                })
            if status == "cancelled":
                return ActionResult.cancelled(
                    error or "subworkflow cancelled",
                    output={**receipt, "attempts": attempts},
                )
        final = attempts[-1]
        message = "workflow.select: all branches failed"
        return ActionResult.failed(
            message,
            category="subworkflow",
            output={
                "workflow": final["workflow"],
                "status": "failed",
                "output": final["output"],
                "error": message,
                "error_category": "subworkflow",
                "attempts": attempts,
            },
        )


class SequenceWorkflowAction(Action):
    """UE 行为树 Sequence 语义：按顺序执行子工作流，全部成功才成功，任一失败立即中止。"""

    name = "workflow.sequence"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        refs = arguments.get("workflows")
        if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and r.strip() for r in refs):
            return ActionResult.failed("workflows must be a non-empty array of workflow references", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        attempts: list[dict[str, Any]] = []
        output: Any = None
        for reference in refs:
            try:
                status, output, error, error_category = context.run_subworkflow(reference, inputs)
            except CancelledError:
                raise
            except AutomationError as exc:
                receipt = _subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value)
                attempts.append(receipt)
                message = f"workflow.sequence aborted at {reference}: {exc}"
                return ActionResult.failed(
                    message,
                    category=exc.category.value,
                    output={**receipt, "error": message, "attempts": attempts},
                )
            receipt = _subworkflow_receipt(reference, status, output, error, error_category)
            attempts.append(receipt)
            if status == "cancelled":
                return ActionResult.cancelled(
                    error or "subworkflow cancelled",
                    output={**receipt, "attempts": attempts},
                )
            if status != "succeeded":
                message = f"workflow.sequence aborted at {reference}: {error or 'failed'}"
                return ActionResult.failed(
                    message,
                    category=error_category or "subworkflow",
                    output={
                        **receipt,
                        "status": "failed",
                        "error": message,
                        "error_category": error_category or "subworkflow",
                        "attempts": attempts,
                    },
                )
        return ActionResult.succeeded({
            "workflow": refs[-1],
            "status": "succeeded",
            "output": output,
            "error": None,
            "error_category": None,
            "attempts": attempts,
        })


def _subworkflow_receipt(
    workflow: str,
    status: str,
    output: Any,
    error: str | None,
    error_category: str | None,
) -> dict[str, Any]:
    """Build the stable parent/child workflow completion contract."""

    return {
        "workflow": workflow,
        "status": status,
        "output": output,
        "error": error,
        "error_category": error_category,
    }
