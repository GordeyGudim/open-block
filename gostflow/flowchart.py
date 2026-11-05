"""Построение графа блок-схемы из AST.

Граф — ориентированный, с типизированными вершинами по ГОСТ 19.701-90
и рёбрами, помеченными «Да»/«Нет». Обратные рёбра петель помечаются
отдельно, чтобы слой раскладки не ломал вертикальный порядок.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from .ast import (
    Block,
    Break,
    Continue,
    DoWhile,
    Empty,
    ExprStmt,
    For,
    Function,
    If,
    Return,
    Stmt,
    Switch,
    Try,
    While,
)


@dataclass
class FNode:
    id: int
    kind: str                 # terminator | process | decision | io | predefined | connector
    text: str
    line: Optional[int] = None
    width: float = 0.0
    height: float = 0.0
    x: float = 0.0            # левый верхний угол, px
    y: float = 0.0
    lines: list[str] = field(default_factory=list)

    @property
    def cx(self) -> float:
        return self.x + self.width / 2

    @property
    def cy(self) -> float:
        return self.y + self.height / 2

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


@dataclass
class FEdge:
    src: int
    dst: int
    label: Optional[str] = None
    kind: str = "normal"      # normal | true | false | back | break | continue | return
    route_side: bool = False
    points: list[tuple[float, float]] = field(default_factory=list)
    arrow: bool = True


@dataclass
class Flowchart:
    function: Function
    nodes: list[FNode]
    edges: list[FEdge]
    start_id: int
    end_id: int


_IO_RE = re.compile(
    r"^\s*(?:(?:std\s*::\s*)?(?:cin|cout|cerr|clog)\b"
    r"|(?:scanf|printf|gets|puts|getchar|putchar|fgets|fputs|perror)\s*\()"
)

_CALL_RE = re.compile(
    r"^\s*[A-Za-z_]\w*(?:\s*(?:\.|->|::)\s*[A-Za-z_]\w*)*\s*\(.*\)\s*$"
)

_TYPE_WORDS = {
    "int", "long", "short", "char", "float", "double", "bool", "auto",
    "unsigned", "signed", "const", "static", "constexpr", "void",
    "size_t", "string", "vector", "map", "set", "pair", "array",
}


def classify_expr(text: str) -> str:
    t = text.strip()
    if not t:
        return "process"
    if _IO_RE.match(t):
        return "io"
    if _CALL_RE.match(t):
        # Вызов функции — предопределённый процесс по ГОСТ.
        return "predefined"
    return "process"


class FlowBuilder:
    def __init__(self) -> None:
        self.nodes: list[FNode] = []
        self.edges: list[FEdge] = []
        self._next_id = 0
        self.start_id = self._new_node("terminator", "Начало")
        self.end_id = self._new_node("terminator", "Конец")
        self.break_stack: list[int] = []
        self.continue_stack: list[int] = []

    # -- создание графа ----------------------------------------------------
    def _new_node(self, kind: str, text: str, line: Optional[int] = None) -> int:
        node = FNode(id=self._next_id, kind=kind, text=text, line=line)
        self.nodes.append(node)
        self._next_id += 1
        return node.id

    def _edge(
        self,
        src: int,
        dst: int,
        label: Optional[str] = None,
        kind: str = "normal",
        route_side: bool = False,
    ) -> None:
        self.edges.append(FEdge(src=src, dst=dst, label=label, kind=kind, route_side=route_side))

    def _process(self, text: str, line: Optional[int] = None, kind: Optional[str] = None) -> int:
        return self._new_node(kind or classify_expr(text), text, line)

    def _mark_back_edge(self, decision_id: int) -> None:
        """Все прямые рёбра, входящие в условие цикла, помечаем обратными.

        Тело цикла может заканчиваться в нескольких узлах (ветки if/else,
        присваивания и их «Нет»-выходы): каждый такой выход — обратное
        ребро, иначе Graphviz неверно ранжирует соответствующий блок.
        Узел, созданный раньше условия (инициализация/вход сверху),
        остаётся прямым ребром.
        """
        for edge in reversed(self.edges):
            if edge.dst == decision_id and edge.src > decision_id:
                edge.kind = "back"

    # -- обход AST ---------------------------------------------------------
    def build_function(self, func: Function) -> Flowchart:
        entry = self._build(func.body, self.end_id)
        self._edge(self.start_id, entry)
        self._prune()
        return Flowchart(
            function=func,
            nodes=self.nodes,
            edges=self.edges,
            start_id=self.start_id,
            end_id=self.end_id,
        )

    def _build_list(self, stmts: list[Stmt], next_id: int) -> int:
        entry = next_id
        for stmt in reversed(stmts):
            entry = self._build(stmt, entry)
        return entry

    def _build(self, stmt: Stmt, next_id: int) -> int:
        if isinstance(stmt, Empty):
            return next_id

        if isinstance(stmt, Block):
            return self._build_list(stmt.body, next_id)

        if isinstance(stmt, ExprStmt):
            text = stmt.text.strip()
            if not text:
                return next_id
            node = self._process(text, stmt.line)
            self._edge(node, next_id)
            return node

        if isinstance(stmt, If):
            dec = self._new_node("decision", stmt.cond or "?", stmt.line)
            then_entry = self._build(stmt.then, next_id)
            self._edge(dec, then_entry, "Да", "true")
            if stmt.else_ is not None:
                else_entry = self._build(stmt.else_, next_id)
                self._edge(dec, else_entry, "Нет", "false")
            else:
                self._edge(dec, next_id, "Нет", "false", route_side=True)
            return dec

        if isinstance(stmt, While):
            dec = self._new_node("decision", stmt.cond or "?", stmt.line)
            self.break_stack.append(next_id)
            self.continue_stack.append(dec)
            try:
                body_entry = self._build(stmt.body, dec)
            finally:
                self.continue_stack.pop()
                self.break_stack.pop()
            self._mark_back_edge(dec)
            self._edge(dec, body_entry, "Да", "true")
            self._edge(dec, next_id, "Нет", "false", route_side=True)
            return dec

        if isinstance(stmt, DoWhile):
            # Решение создаётся до тела, но в раскладке окажется под ним,
            # потому что тело->решение — обычное прямое ребро.
            dec = self._new_node("decision", stmt.cond or "?", stmt.line)
            self.break_stack.append(next_id)
            self.continue_stack.append(dec)
            try:
                body_entry = self._build(stmt.body, dec)
            finally:
                self.continue_stack.pop()
                self.break_stack.pop()
            if body_entry != dec:
                self._edge(dec, body_entry, "Да", "back")
            self._edge(dec, next_id, "Нет", "false")
            return body_entry

        if isinstance(stmt, For):
            # Цикл for по ГОСТ рисуется символом «Подготовка»
            # (шестиугольник): все три части (init, условие, шаг)
            # собираются в один блок.
            if stmt.range_expr:
                text = stmt.range_expr
            else:
                parts = [p.strip() for p in (stmt.init, stmt.cond, stmt.step) if p]
                text = ", ".join(parts) if parts else "true"
            hex_id = self._new_node("preparation", text, stmt.line)

            self.break_stack.append(next_id)
            self.continue_stack.append(hex_id)
            try:
                body_entry = self._build(stmt.body, hex_id)
            finally:
                self.continue_stack.pop()
                self.break_stack.pop()
            self._mark_back_edge(hex_id)

            # Для for используем символ «Подготовка» без подписей ветвей
            # «Да/Нет»; они характерны для ромба условия while.
            self._edge(hex_id, body_entry, kind="true")
            self._edge(hex_id, next_id, kind="false", route_side=True)
            return hex_id

        if isinstance(stmt, Switch):
            return self._build_switch(stmt, next_id)

        if isinstance(stmt, Return):
            text = "return" + (f" {stmt.expr}" if stmt.expr else "")
            node = self._process(text, stmt.line, "process")
            self._edge(node, self.end_id, kind="return")
            return node

        if isinstance(stmt, Break):
            target = self.break_stack[-1] if self.break_stack else self.end_id
            node = self._process("break", stmt.line, "process")
            self._edge(node, target, kind="break")
            return node

        if isinstance(stmt, Continue):
            target = self.continue_stack[-1] if self.continue_stack else self.end_id
            node = self._process("continue", stmt.line, "process")
            self._edge(node, target, kind="continue")
            return node

        if isinstance(stmt, Try):
            # Упрощённо: показываем основной поток try; catch-ветки
            # не влияют на линейный поток и здесь опускаются.
            return self._build(stmt.body, next_id)

        # Неизвестный оператор — просто процесс.
        text = getattr(stmt, "text", "") or type(stmt).__name__
        node = self._process(text, stmt.line)
        self._edge(node, next_id)
        return node

    def _build_switch(self, stmt: Switch, next_id: int) -> int:
        if not stmt.cases:
            return next_id

        self.break_stack.append(next_id)
        try:
            # Сначала собираем тела ветвей в обратном порядке источников,
            # выстраивая цепочку проваливания: тело case без break
            # переходит к телу следующего case.
            fall_to = next_id
            body_entries: dict[int, int] = {}
            for case in reversed(stmt.cases):
                body_entry = self._build_list(case.body, fall_to)
                body_entries[id(case)] = body_entry
                fall_to = body_entry

            default_case = None
            for case in stmt.cases:
                if any(label is None for label in case.labels):
                    default_case = case
                    break
            normal_cases = [c for c in stmt.cases if not any(l is None for l in c.labels)]

            # Цепочка решений: «Нет» последнего normal-case уходит в
            # тело default (или в выход), затем по цепочке вверх.
            next_entry = (
                body_entries[id(default_case)] if default_case is not None else next_id
            )
            for case in reversed(normal_cases):
                body_entry = body_entries[id(case)]
                for label in reversed([lab for lab in case.labels if lab is not None]):
                    cond = label
                    if cond.startswith("case "):
                        cond = cond[5:].strip()
                    dec = self._new_node(
                        "decision", f"{stmt.expr} == {cond}", case.line or stmt.line
                    )
                    self._edge(dec, body_entry, "Да", "true")
                    self._edge(dec, next_entry, "Нет", "false", route_side=True)
                    next_entry = dec
            return next_entry
        finally:
            self.break_stack.pop()

    # -- очистка недостижимого кода ----------------------------------------
    def _prune(self) -> None:
        alive: set[int] = set()
        stack = [self.start_id]
        by_src: dict[int, list[FEdge]] = {}
        for edge in self.edges:
            by_src.setdefault(edge.src, []).append(edge)
        while stack:
            nid = stack.pop()
            if nid in alive:
                continue
            alive.add(nid)
            for edge in by_src.get(nid, []):
                if edge.dst not in alive:
                    stack.append(edge.dst)

        self.nodes = [n for n in self.nodes if n.id in alive]
        self.edges = [
            e for e in self.edges if e.src in alive and e.dst in alive
        ]


def build_flowchart(func: Function) -> Flowchart:
    return FlowBuilder().build_function(func)
