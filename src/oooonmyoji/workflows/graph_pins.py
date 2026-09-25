"""节点图文档的数据引脚 ⇄ 运行时载荷路径。

v5 里「谁读了谁的输出」是一条边，而不是写在参数里的 `{"ref": "nodes.x.output.y"}` 字符串。
引脚名是**稳定的语义名**（`left` / `condition` / 参数名 / `decorators.0.attempts`…），
载荷路径是运行时字段（`params.timeout_seconds` / `expression.eq.0`…）；两者在这里互相换算。

两条原则：

1. **只有换算得出引脚的引用才变成边**。认不出的位置（自定义 Action 的深层嵌套字段、
   将来新增的载荷字段、指向 `inputs.` / `variables.` 的引用）**原样留在参数里**——
   格式换代不能吞掉任何一条既有连线，否则编辑器会显示「线还在」而文件里已经没了。
2. **换算必须双向且无损**：`path_to_pin` 是 `pin_to_path` 在这些位置上的逆运算，
   迁移脚本用它断言「v4 → v5 → v4 一字不差」。
"""

from __future__ import annotations

from typing import Any, Iterator

#: 用于匹配「比较运算符」形态：`{"eq": [a, b]}`。
_COMPARISON_ARITY = 2

#: 值卡片（布尔判断）的两个操作数引脚。
_BOOL_JUDGE_OPERANDS = ("left", "right")


def _split_pin(pin: str) -> tuple[str, str]:
    head, _, tail = pin.partition(".")
    return head, tail


def _bool_judge_operator(node: dict[str, Any]) -> str | None:
    """布尔判断卡片当前比较运算符（只有 `{op: [a, b]}` 形态才有操作数引脚）。"""

    expression = node.get("expression")
    if not isinstance(expression, dict) or len(expression) != 1:
        return None
    operator, operands = next(iter(expression.items()))
    if operator == "ref" or not isinstance(operands, list) or len(operands) != _COMPARISON_ARITY:
        return None
    return str(operator)


def pin_to_path(node: dict[str, Any], pin: str) -> list[Any] | None:
    """数据输入引脚 → 载荷路径（编译方向）。认不出来返回 ``None``。"""

    node_type = str(node.get("type"))
    if node_type == "variable":
        # 变量节点是纯数据源：只有出口，没有数据入口。
        return None
    if node_type == "task":
        if pin.startswith("inputs.") and len(pin) > len("inputs."):
            return ["params", "inputs", *pin[len("inputs.") :].split(".")]
        if not pin or pin.startswith("out"):
            return None
        return ["params", *pin.split(".")]
    if node_type == "condition" and pin == "condition":
        return ["expression"]
    if node_type == "repeat_until" and pin == "condition":
        return ["condition"]
    if node_type == "switch" and pin == "expression":
        return ["expression"]
    if node_type == "break" and pin == "ref":
        return ["ref"]
    if node_type == "bool_judge":
        if pin == "condition":
            return ["expression"]
        if pin in _BOOL_JUDGE_OPERANDS:
            operator = _bool_judge_operator(node)
            if operator is None:
                return None
            return ["expression", operator, _BOOL_JUDGE_OPERANDS.index(pin)]
        return None
    if node_type == "branch":
        head, tail = _split_pin(pin)
        if head == "conditions" and tail.isdigit():
            return ["conditions", int(tail)]
        return None
    if node_type == "instance_parallel":
        head, tail = _split_pin(pin)
        if head != "runs":
            return None
        run_index, _, rest = tail.partition(".")
        if not run_index.isdigit():
            return None
        inputs_head, _, input_name = rest.partition(".")
        if inputs_head != "inputs" or not input_name:
            return None
        return ["runs", int(run_index), "inputs", *input_name.split(".")]
    head, tail = _split_pin(pin)
    if head == "decorators":
        decorator_index, _, field = tail.partition(".")
        if decorator_index.isdigit() and field:
            return ["decorators", int(decorator_index), field]
    return None


def path_to_pin(node: dict[str, Any], path: list[Any]) -> str | None:
    """载荷路径 → 数据输入引脚（反编译方向）。认不出来返回 ``None``。"""

    node_type = str(node.get("type"))
    if not path:
        return None
    head = path[0]
    if head == "params":
        rest = path[1:]
        if not rest:
            return None
        if rest[0] == "inputs" and len(rest) > 1:
            return "inputs." + ".".join(str(part) for part in rest[1:])
        return ".".join(str(part) for part in rest)
    if head == "expression":
        if len(path) == 1:
            # 整段表达式被一个引用顶掉：判断节点 / 布尔判断卡片的「布尔条件」口，
            # 拆分节点的「表达式」口。
            if node_type in {"condition", "bool_judge"}:
                return "condition"
            if node_type == "switch":
                return "expression"
            return None
        if node_type == "bool_judge" and len(path) == 3 and str(path[2]).isdigit():
            if _bool_judge_operator(node) != str(path[1]):
                return None
            index = int(path[2])
            if 0 <= index < len(_BOOL_JUDGE_OPERANDS):
                return _BOOL_JUDGE_OPERANDS[index]
        return None
    if head == "condition" and node_type == "repeat_until" and len(path) == 1:
        return "condition"
    if head == "ref" and node_type == "break" and len(path) == 1:
        return "ref"
    if head == "conditions" and node_type == "branch" and len(path) == 2:
        return f"conditions.{path[1]}"
    if head == "runs" and node_type == "instance_parallel" and len(path) >= 4:
        if path[2] != "inputs":
            return None
        return f"runs.{path[1]}.inputs." + ".".join(str(part) for part in path[3:])
    if head == "decorators" and len(path) == 3:
        return f"decorators.{path[1]}.{path[2]}"
    return None


def iter_node_refs(value: Any, path: tuple[Any, ...] = ()) -> Iterator[tuple[tuple[Any, ...], str]]:
    """遍历一段载荷里所有 `{"ref": "nodes.…"}`，产出（路径, 引用文本）。"""

    if isinstance(value, dict):
        ref = value.get("ref")
        if set(value) == {"ref"} and isinstance(ref, str):
            if ref.startswith("nodes."):
                yield path, ref
            return
        for key, child in value.items():
            yield from iter_node_refs(child, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_node_refs(child, (*path, index))


def iter_variable_refs(value: Any, path: tuple[Any, ...] = ()) -> Iterator[tuple[tuple[Any, ...], str]]:
    """遍历一段载荷里所有 `{"ref": "inputs.…" / "variables.…"}`，产出（路径, 引用文本）。"""

    if isinstance(value, dict):
        ref = value.get("ref")
        if set(value) == {"ref"} and isinstance(ref, str):
            if ref.startswith(("inputs.", "variables.")):
                yield path, ref
            return
        for key, child in value.items():
            yield from iter_variable_refs(child, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_variable_refs(child, (*path, index))


def _resolve_segment(container: Any, segment: Any) -> Any:
    """容器是列表时把数字字符串当索引（引脚里的 `states.0.threshold` 就是这种）。"""

    if isinstance(container, list) and isinstance(segment, str) and segment.isdigit():
        return int(segment)
    return segment


def set_at_path(target: dict[str, Any], path: list[Any], value: Any) -> None:
    """把值写到载荷路径上，缺的中间容器按下一段是下标还是键自动补出来。"""

    current: Any = target
    for position, raw_segment in enumerate(path[:-1]):
        segment = _resolve_segment(current, raw_segment)
        following = path[position + 1]
        if isinstance(segment, int):
            if not isinstance(current, list):
                raise ValueError(f"payload path expects a list at {path[:position + 1]}")
            while len(current) <= segment:
                current.append(None)
            if current[segment] is None:
                current[segment] = [] if isinstance(following, int) else {}
            current = current[segment]
        else:
            if not isinstance(current, dict):
                raise ValueError(f"payload path expects an object at {path[:position + 1]}")
            if not isinstance(current.get(segment), (dict, list)):
                current[segment] = [] if isinstance(following, int) else {}
            current = current[segment]
    last = _resolve_segment(current, path[-1])
    if isinstance(last, int):
        if not isinstance(current, list):
            raise ValueError(f"payload path expects a list at {path}")
        while len(current) <= last:
            current.append(None)
        current[last] = value
    else:
        if not isinstance(current, dict):
            raise ValueError(f"payload path expects an object at {path}")
        current[last] = value


def delete_at_path(target: dict[str, Any], path: list[Any]) -> None:
    """把载荷路径上的值摘掉；路径不存在时静默跳过。

    列表里的元素**留洞（置 None）而不是删除**：删掉会让后面的元素前移，
    同一段里的另一个引用就会挪位——编译回填时会把相邻的字面量盖掉。
    """

    current: Any = target
    for raw_segment in path[:-1]:
        segment = _resolve_segment(current, raw_segment)
        if isinstance(segment, int):
            if not isinstance(current, list) or segment >= len(current):
                return
            current = current[segment]
        else:
            if not isinstance(current, dict) or segment not in current:
                return
            current = current[segment]
    last = _resolve_segment(current, path[-1])
    if isinstance(last, int):
        if isinstance(current, list) and last < len(current):
            current[last] = None
    elif isinstance(current, dict):
        current.pop(last, None)


__all__ = [
    "delete_at_path",
    "iter_node_refs",
    "iter_variable_refs",
    "path_to_pin",
    "pin_to_path",
    "set_at_path",
]
