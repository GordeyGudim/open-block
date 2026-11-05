"""AST для подмножества C++, используемого при построении блок-схем."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Stmt:
    line: int = 0


@dataclass
class Block(Stmt):
    body: list["Stmt"] = field(default_factory=list)


@dataclass
class ExprStmt(Stmt):
    text: str = ""
    is_decl: bool = False


@dataclass
class If(Stmt):
    cond: str = ""
    then: Stmt = field(default_factory=Stmt)
    else_: Optional[Stmt] = None


@dataclass
class While(Stmt):
    cond: str = ""
    body: Stmt = field(default_factory=Stmt)


@dataclass
class DoWhile(Stmt):
    body: Stmt = field(default_factory=Stmt)
    cond: str = ""


@dataclass
class For(Stmt):
    init: Optional[str] = None
    cond: Optional[str] = None
    step: Optional[str] = None
    body: Stmt = field(default_factory=Stmt)
    range_expr: Optional[str] = None


@dataclass
class Case:
    labels: list[Optional[str]] = field(default_factory=list)  # None = default
    body: list[Stmt] = field(default_factory=list)
    line: int = 0


@dataclass
class Switch(Stmt):
    expr: str = ""
    cases: list[Case] = field(default_factory=list)


@dataclass
class Return(Stmt):
    expr: Optional[str] = None


@dataclass
class Break(Stmt):
    pass


@dataclass
class Continue(Stmt):
    pass


@dataclass
class Empty(Stmt):
    pass


@dataclass
class Try(Stmt):
    body: Stmt = field(default_factory=Stmt)
    handlers: list[tuple[str, Stmt]] = field(default_factory=list)


@dataclass
class Function:
    name: str
    params: str
    body: Block
    line: int
    signature: str = ""
