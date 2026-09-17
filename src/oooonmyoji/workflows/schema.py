"""Behavior Tree v4 的结构 Schema（JSON Schema 2020-12）。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .model import DECORATOR_TYPES, INSTANCE_PARALLEL_WAIT_MODES, NODE_TYPES, PARALLEL_FINISH_MODES

BINDING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["ref"],
    "properties": {"ref": {"type": "string", "minLength": 1}},
    "additionalProperties": False,
}

WORKFLOW_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["schema_version", "id", "version", "resolution", "root", "inputs", "variables", "nodes"],
    "properties": {
        "schema_version": {"const": 4},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "resolution": {
            "type": "array",
            "prefixItems": [
                {"type": "integer", "minimum": 1},
                {"type": "integer", "minimum": 1},
            ],
            "minItems": 2,
            "maxItems": 2,
        },
        "root": {"type": "string", "minLength": 1},
        "inputs": {"type": "object"},
        "variables": {"type": "object"},
        "retry_safe": {"type": "boolean"},
        "limits": {
            "type": "object",
            "properties": {
                "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
                "max_steps": {"type": "integer", "minimum": 1},
            },
            "additionalProperties": False,
        },
        "nodes": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "required": ["id", "type"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "type": {"enum": list(NODE_TYPES)},
                    "name": {"type": "string", "minLength": 1},
                    "action": {"type": "string", "minLength": 1},
                    "params": {"type": "object"},
                    "children": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "uniqueItems": True,
                    },
                    "decorators": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["type"],
                            "properties": {
                                "type": {"enum": list(DECORATOR_TYPES)},
                                "expression": {},
                                "seconds": {"anyOf": [{"type": "number", "exclusiveMinimum": 0}, deepcopy(BINDING_SCHEMA)]},
                                "attempts": {"anyOf": [{"type": "integer", "minimum": 1}, deepcopy(BINDING_SCHEMA)]},
                                "delay_seconds": {"anyOf": [{"type": "number", "minimum": 0}, deepcopy(BINDING_SCHEMA)]},
                                "count": {
                                    "anyOf": [
                                        {"type": "integer", "minimum": 1},
                                        deepcopy(BINDING_SCHEMA),
                                    ]
                                },
                                "reset_on_failure": {"anyOf": [{"type": "boolean"}, deepcopy(BINDING_SCHEMA)]},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "finish_mode": {"enum": list(PARALLEL_FINISH_MODES)},
                    "runs": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "required": ["instance", "workflow"],
                            "properties": {
                                "instance": {"type": "string", "minLength": 1},
                                "workflow": {"type": "string", "minLength": 1},
                                "inputs": {"type": "object"},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "wait_for": {"enum": list(INSTANCE_PARALLEL_WAIT_MODES)},
                    "cancel_on_failure": {"type": "boolean"},
                    "condition": {},
                    "conditions": {"type": "array"},
                    "max_iterations": {"type": "integer", "minimum": 1},
                    "expression": {},
                    "cases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["value", "child"],
                            "properties": {"value": {}, "child": {"type": "string", "minLength": 1}},
                            "additionalProperties": False,
                        },
                    },
                    "default_child": {"type": "string", "minLength": 1},
                },
                "additionalProperties": False,
            },
        },
    },
    "patternProperties": {"^_": {}},
    "additionalProperties": False,
}

__all__ = ["BINDING_SCHEMA", "WORKFLOW_SCHEMA"]
