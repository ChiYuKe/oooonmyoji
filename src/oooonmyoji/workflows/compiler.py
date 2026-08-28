"""Compile a validated Behavior Tree into normalized runtime lookup tables."""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..actions import ActionRegistry
from ..actions.manifest import apply_parameter_defaults
from .model import WorkflowNode, WorkflowSpec


@dataclass(frozen=True)
class CompiledWorkflow:
    nodes: tuple[WorkflowNode, ...]
    root: str
    node_map: dict[str, WorkflowNode]
    parent_map: dict[str, str]
    execution_index: dict[str, int]


def compile_workflow(spec: WorkflowSpec, registry: ActionRegistry) -> CompiledWorkflow:
    compiled_nodes: list[WorkflowNode] = []
    for node in spec.nodes:
        if node.is_task and node.action is not None:
            definition = registry.get(node.action).definition
            node = replace(node, params=apply_parameter_defaults(definition.parameters, node.params))
        compiled_nodes.append(node)

    node_map = {node.id: node for node in compiled_nodes}
    parent_map = {child: node.id for node in compiled_nodes for child in node.children}
    ordered: list[str] = []

    def visit(node_id: str) -> None:
        ordered.append(node_id)
        for child_id in node_map[node_id].children:
            visit(child_id)

    visit(spec.root)
    return CompiledWorkflow(
        nodes=tuple(compiled_nodes),
        root=spec.root,
        node_map=node_map,
        parent_map=parent_map,
        execution_index={node_id: index for index, node_id in enumerate(ordered)},
    )


__all__ = ["CompiledWorkflow", "compile_workflow"]
