"""Action manifest v2: single source of truth for Action parameters.

Each built-in and plugin Action declares exactly one manifest. The runtime
compiles the limited parameter vocabulary into JSON Schema 2020-12, and the
VS Code editor consumes the same vocabulary to build forms, ports, defaults
and validation. Plugin authors no longer write raw JSON Schema.

Vocabulary
----------
Parameter ``type`` is one of:

* ``string`` / ``number`` / ``integer`` / ``boolean`` — JSON scalars
* ``rect`` — ``[x, y, w, h]`` integer tuple (ROI editor control)
* ``asset`` — file path below the project root (asset picker control)
* ``path`` — plain file path
* ``array`` — homogeneous list via ``items`` (plus ``min_items``/``max_items``)
* ``object`` — nested object via ``properties``
* ``any`` — no type constraint (used by e.g. ``core.assert.value``)

Optional per-parameter fields: ``required``, ``default``, ``description``,
``editor`` (control hint), ``min``/``max`` (number bounds), ``min_length``/
``max_length`` (string bounds), ``enum``, ``min_items``/``max_items``,
``items`` (array), ``properties`` (object).
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from ..exceptions import ConfigError

PARAMETER_TYPES = (
    "string",
    "number",
    "integer",
    "boolean",
    "rect",
    "asset",
    "path",
    "array",
    "object",
    "any",
)

_RETRY_MODES = ("safe", "unsafe")
_MISSING_DEFAULT = object()

#: JSON Schema describing an Action manifest file (schema_version 2).
ACTION_MANIFEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["schema_version", "name", "entry", "parameters"],
    "properties": {
        "schema_version": {"const": 2},
        "name": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "entry": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "parameters": {
            "type": "object",
            "additionalProperties": {"$ref": "#/definitions/parameter"},
        },
        "outputs": {"type": "object"},
        "effects": {
            "type": "object",
            "properties": {
                "side_effect": {"type": "boolean"},
                "retry": {"enum": list(_RETRY_MODES)},
            },
            "additionalProperties": False,
        },
    },
    "additionalProperties": False,
    "definitions": {
        "parameter": {
            "type": "object",
            "required": ["type"],
            "properties": {
                "type": {"enum": list(PARAMETER_TYPES)},
                "required": {"type": "boolean"},
                "default": {},
                "description": {"type": "string"},
                "editor": {"type": "string"},
                "min": {"type": "number"},
                "max": {"type": "number"},
                "min_length": {"type": "integer", "minimum": 0},
                "max_length": {"type": "integer", "minimum": 0},
                "enum": {"type": "array", "minItems": 1},
                "min_items": {"type": "integer", "minimum": 0},
                "max_items": {"type": "integer", "minimum": 0},
                "items": {"$ref": "#/definitions/parameter"},
                "properties": {
                    "type": "object",
                    "additionalProperties": {"$ref": "#/definitions/parameter"},
                },
            },
            "additionalProperties": False,
        }
    },
}


@dataclass(frozen=True)
class ParameterDefinition:
    """One validated parameter of an Action (or workflow input)."""

    name: str
    type: str
    required: bool = False
    default: Any = field(default=_MISSING_DEFAULT, repr=False)
    description: str = ""
    editor: str | None = None
    min: float | None = None
    max: float | None = None
    min_length: int | None = None
    max_length: int | None = None
    enum: tuple[Any, ...] = ()
    min_items: int | None = None
    max_items: int | None = None
    items: "ParameterDefinition | None" = None
    properties: dict[str, "ParameterDefinition"] = field(default_factory=dict)

    @property
    def has_default(self) -> bool:
        return self.default is not _MISSING_DEFAULT

    @classmethod
    def parse(cls, name: str, raw: dict[str, Any]) -> "ParameterDefinition":
        if not isinstance(raw, dict):
            raise ConfigError(f"parameter {name} must be an object")
        type_name = raw.get("type")
        if not isinstance(type_name, str) or type_name not in PARAMETER_TYPES:
            raise ConfigError(f"parameter {name} has unknown type: {type_name!r}")
        items = None
        items_raw = raw.get("items")
        if items_raw is not None:
            if type_name != "array":
                raise ConfigError(f"parameter {name}: items is only valid for array")
            items = cls.parse(f"{name}[]", items_raw)
        properties: dict[str, ParameterDefinition] = {}
        properties_raw = raw.get("properties")
        if properties_raw is not None:
            if type_name != "object":
                raise ConfigError(f"parameter {name}: properties is only valid for object")
            if not isinstance(properties_raw, dict):
                raise ConfigError(f"parameter {name}.properties must be an object")
            properties = {
                key: cls.parse(f"{name}.{key}", value)
                for key, value in properties_raw.items()
            }
        if type_name != "object" and properties:
            raise ConfigError(f"parameter {name}: properties is only valid for object")
        enum = tuple(raw["enum"]) if isinstance(raw.get("enum"), list) else ()
        definition = cls(
            name=name,
            type=type_name,
            required=bool(raw.get("required", False)),
            default=raw["default"] if "default" in raw else _MISSING_DEFAULT,
            description=str(raw.get("description", "")),
            editor=raw.get("editor") if isinstance(raw.get("editor"), str) else None,
            min=raw.get("min") if isinstance(raw.get("min"), (int, float)) and not isinstance(raw.get("min"), bool) else None,
            max=raw.get("max") if isinstance(raw.get("max"), (int, float)) and not isinstance(raw.get("max"), bool) else None,
            min_length=raw.get("min_length") if isinstance(raw.get("min_length"), int) else None,
            max_length=raw.get("max_length") if isinstance(raw.get("max_length"), int) else None,
            enum=enum,
            min_items=raw.get("min_items") if isinstance(raw.get("min_items"), int) else None,
            max_items=raw.get("max_items") if isinstance(raw.get("max_items"), int) else None,
            items=items,
            properties=properties,
        )
        definition._validate()
        return definition

    def _validate(self) -> None:
        if self.type not in {"number", "integer"} and (self.min is not None or self.max is not None):
            raise ConfigError(f"parameter {self.name}: min/max are only valid for numeric types")
        if self.type not in {"string", "asset", "path"} and (
            self.min_length is not None or self.max_length is not None
        ):
            raise ConfigError(f"parameter {self.name}: min_length/max_length are only valid for string types")
        if self.type != "array" and (self.min_items is not None or self.max_items is not None):
            raise ConfigError(f"parameter {self.name}: min_items/max_items are only valid for array")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ConfigError(f"parameter {self.name}: min must be <= max")
        if self.min_length is not None and self.max_length is not None and self.min_length > self.max_length:
            raise ConfigError(f"parameter {self.name}: min_length must be <= max_length")
        if self.min_items is not None and self.max_items is not None and self.min_items > self.max_items:
            raise ConfigError(f"parameter {self.name}: min_items must be <= max_items")

        try:
            from jsonschema import Draft202012Validator
            from jsonschema.exceptions import SchemaError
        except ImportError as exc:
            raise ConfigError("jsonschema is required for Action validation", cause=exc) from exc

        schema = self.to_schema()
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            raise ConfigError(f"parameter {self.name} compiles to an invalid schema: {exc.message}") from exc
        validator = Draft202012Validator(schema)
        for index, value in enumerate(self.enum):
            error = next(validator.iter_errors(value), None)
            if error is not None:
                raise ConfigError(f"parameter {self.name}.enum[{index}]: {error.message}")
        if self.has_default:
            normalized = _apply_value_defaults(self, deepcopy(self.default))
            error = next(validator.iter_errors(normalized), None)
            if error is not None:
                raise ConfigError(f"parameter {self.name}.default: {error.message}")

    def to_schema(self) -> dict[str, Any]:
        """Compile this parameter into a JSON Schema fragment (2020-12)."""
        schema: dict[str, Any] = {}
        scalar_types = {
            "string": "string",
            "number": "number",
            "integer": "integer",
            "boolean": "boolean",
        }
        if self.type in scalar_types:
            schema["type"] = scalar_types[self.type]
            if self.type in {"number", "integer"}:
                if self.min is not None:
                    schema["minimum"] = self.min
                if self.max is not None:
                    schema["maximum"] = self.max
            if self.type == "string":
                if self.min_length is not None:
                    schema["minLength"] = self.min_length
                if self.max_length is not None:
                    schema["maxLength"] = self.max_length
        elif self.type in {"asset", "path"}:
            schema["type"] = "string"
            if self.min_length is not None:
                schema["minLength"] = self.min_length
            if self.max_length is not None:
                schema["maxLength"] = self.max_length
        elif self.type == "rect":
            schema["type"] = "array"
            schema["prefixItems"] = [
                {"type": "integer"},
                {"type": "integer"},
                {"type": "integer"},
                {"type": "integer"},
            ]
            schema["minItems"] = 4
            schema["maxItems"] = 4
        elif self.type == "array":
            schema["type"] = "array"
            schema["items"] = self.items.to_schema() if self.items is not None else {}
            if self.min_items is not None:
                schema["minItems"] = self.min_items
            if self.max_items is not None:
                schema["maxItems"] = self.max_items
        elif self.type == "object":
            schema["type"] = "object"
            if self.properties:
                schema["properties"] = {
                    name: param.to_schema() for name, param in self.properties.items()
                }
                schema["required"] = [
                    name for name, param in self.properties.items() if param.required
                ]
                schema["additionalProperties"] = False
            # An object parameter with no declared properties is free-form,
            # matching the historical {"type": "object"} passthrough (e.g.
            # workflow.run inputs, core.log fields, input.tap_match match).
        elif self.type == "any":
            pass
        if self.enum:
            schema["enum"] = list(self.enum)
        if self.has_default:
            schema["default"] = self.default
        if self.description:
            schema["description"] = self.description
        return schema


def compile_parameters(parameters: dict[str, ParameterDefinition]) -> dict[str, Any]:
    """Compile a parameter map into a JSON Schema ``object`` schema."""
    return {
        "type": "object",
        "properties": {
            name: param.to_schema() for name, param in parameters.items()
        },
        "required": [name for name, param in parameters.items() if param.required],
        "additionalProperties": False,
    }


def _apply_value_defaults(parameter: ParameterDefinition, value: Any) -> Any:
    if parameter.type == "object" and isinstance(value, dict):
        out = deepcopy(value)
        for name, child in parameter.properties.items():
            if name not in out and child.has_default:
                out[name] = deepcopy(child.default)
            if name in out:
                out[name] = _apply_value_defaults(child, out[name])
        return out
    if parameter.type == "array" and isinstance(value, list) and parameter.items is not None:
        return [_apply_value_defaults(parameter.items, child) for child in value]
    return deepcopy(value)


def apply_parameter_defaults(
    parameters: dict[str, ParameterDefinition], values: dict[str, Any]
) -> dict[str, Any]:
    """Recursively fill missing keys with declared defaults."""
    out = deepcopy(values)
    for name, param in parameters.items():
        if name not in out and param.has_default:
            out[name] = deepcopy(param.default)
        if name in out:
            out[name] = _apply_value_defaults(param, out[name])
    return out


@dataclass(frozen=True)
class ActionDefinition:
    """One validated Action manifest: the shared source of truth."""

    name: str
    version: str
    entry: str
    description: str
    parameters: dict[str, ParameterDefinition]
    output_schema: dict[str, Any]
    retry: str
    side_effect: bool
    input_schema: dict[str, Any]

    @property
    def retry_safe(self) -> bool:
        return self.retry == "safe"

    @property
    def output_fields(self) -> tuple[str, ...]:
        properties = self.output_schema.get("properties")
        if (
            self.output_schema.get("type") == "object"
            and isinstance(properties, dict)
        ):
            return tuple(properties.keys())
        return ()

    @classmethod
    def parse(cls, manifest: dict[str, Any]) -> "ActionDefinition":
        if manifest.get("schema_version") != 2:
            raise ConfigError(
                f"Action manifest {manifest.get('name', '<unknown>')} must use schema_version 2"
            )
        name = manifest["name"]
        if not isinstance(name, str) or not name:
            raise ConfigError("Action manifest name must be a non-empty string")
        parameters_raw = manifest.get("parameters", {})
        if not isinstance(parameters_raw, dict):
            raise ConfigError(f"Action {name}: parameters must be an object")
        parameters = {
            key: ParameterDefinition.parse(key, value)
            for key, value in parameters_raw.items()
        }
        effects = manifest.get("effects", {})
        if not isinstance(effects, dict):
            raise ConfigError(f"Action {name}: effects must be an object")
        retry = effects.get("retry", "unsafe")
        if retry not in _RETRY_MODES:
            raise ConfigError(f"Action {name}: effects.retry must be one of {_RETRY_MODES}")
        side_effect = bool(effects.get("side_effect", False))
        output_schema = manifest.get("outputs", {})
        if not isinstance(output_schema, dict):
            raise ConfigError(f"Action {name}: outputs must be an object")
        try:
            from jsonschema import Draft202012Validator
            from jsonschema.exceptions import SchemaError
        except ImportError as exc:
            raise ConfigError("jsonschema is required for Action validation", cause=exc) from exc
        try:
            Draft202012Validator.check_schema(output_schema)
        except SchemaError as exc:
            raise ConfigError(f"Action {name}: outputs is not a valid JSON Schema: {exc.message}") from exc
        version = manifest.get("version", "1.0.0")
        return cls(
            name=name,
            version=str(version),
            entry=str(manifest["entry"]),
            description=str(manifest.get("description", "")),
            parameters=parameters,
            output_schema=output_schema,
            retry=retry,
            side_effect=side_effect,
            input_schema=compile_parameters(parameters),
        )

    def output_field_schema(self, field: str) -> dict[str, Any]:
        properties = self.output_schema.get("properties")
        if isinstance(properties, dict):
            child = properties.get(field)
            if isinstance(child, dict):
                return child
        return {}


__all__ = [
    "ACTION_MANIFEST_SCHEMA",
    "PARAMETER_TYPES",
    "ActionDefinition",
    "ParameterDefinition",
    "apply_parameter_defaults",
    "compile_parameters",
]
