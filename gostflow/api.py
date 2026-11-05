"""Публичный API: исходник C++ -> SVG."""

from __future__ import annotations

from typing import Optional

from .ast import Function
from .flowchart import build_flowchart
from .parser import parse_source
from .render import render_svg


class GostFlowError(Exception):
    pass


class FunctionNotFound(GostFlowError):
    """Запрошенная функция не найдена; несёт список доступных."""

    def __init__(self, name: str, functions: list[Function]) -> None:
        self.name = name
        self.functions = functions
        available = ", ".join(f.name for f in functions)
        super().__init__(f"Функция «{name}» не найдена. Доступны: {available}")


def select_function(functions: list[Function], name: Optional[str] = None) -> Function:
    if not functions:
        raise GostFlowError(
            "В исходнике не найдено ни одной функции с телом. "
            "Поддерживаются определения вида `int main() { ... }`."
        )
    if name:
        matches = [f for f in functions if f.name == name]
        if not matches:
            raise FunctionNotFound(name, functions)
        return matches[0]
    for func in functions:
        if func.name == "main":
            return func
    return functions[0]


def generate_svg(
    source: str,
    function: Optional[str] = None,
    title: Optional[str] = None,
    line_numbers: bool = False,
) -> tuple[str, list[Function], Function]:
    functions = parse_source(source)
    func = select_function(functions, function)
    flow = build_flowchart(func)
    svg = render_svg(flow, title=title, show_line_numbers=line_numbers)
    return svg, functions, func
