"""Рекурсивный парсер практического подмножества C++.

Поддерживаются: функции, блоки, if/else, while, do/while, for,
switch/case, return, break, continue, try/catch (упрощённо),
объявления и выражения. Цель — не полный синтаксис C++, а
надёжное построение блок-схем по типичному учебному коду.
"""

from __future__ import annotations

import re
from typing import Optional

from .ast import (
    Block,
    Break,
    Case,
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
from .lexer import Token, tokenize


CONTROL = {
    "if", "for", "while", "switch", "catch", "do", "else", "try",
    "return", "sizeof", "alignof", "decltype", "new", "delete",
    "static_assert", "throw",
}

QUALIFIERS = {
    "const", "constexpr", "consteval", "constinit", "noexcept", "override",
    "final", "mutable", "volatile", "virtual", "inline", "static", "explicit",
    "friend", "extern",
}

DECL_SKIP = {
    "struct", "class", "enum", "union", "namespace", "using", "typedef",
    "template", "concept", "requires",
}


def _match_forward(tokens: list[Token], i: int) -> int:
    """Индекс парной закрывающей скобки для tokens[i]."""
    if i < 0 or i >= len(tokens):
        return len(tokens) - 1
    open_ch = tokens[i].value
    close_ch = {"{": "}", "(": ")", "[": "]"}.get(open_ch)
    if not close_ch:
        return i
    depth = 0
    while i < len(tokens):
        v = tokens[i].value
        if v == open_ch:
            depth += 1
        elif v == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(tokens) - 1


def _match_backward(tokens: list[Token], j: int) -> int:
    """Индекс парной открывающей скобки для tokens[j]."""
    if j < 0 or j >= len(tokens):
        return -1
    close_ch = tokens[j].value
    open_ch = {"}": "{", ")": "(", "]": "["}.get(close_ch)
    if not open_ch:
        return -1
    depth = 0
    while j >= 0:
        v = tokens[j].value
        if v == close_ch:
            depth += 1
        elif v == open_ch:
            depth -= 1
            if depth == 0:
                return j
        j -= 1
    return -1


def _is_container_brace(tokens: list[Token], brace: int) -> bool:
    """Похоже ли '{' на тело class/struct/namespace/enum, а не функции."""
    lo = max(0, brace - 14)
    words = {t.value for t in tokens[lo:brace] if t.kind == "id"}
    if words & {"class", "struct", "union", "namespace", "enum"}:
        return True
    # extern "C" {
    if brace >= 2 and tokens[brace - 1].kind == "str" and tokens[brace - 2].value == "extern":
        return True
    # class Foo : public Bar {
    for t in tokens[lo:brace]:
        if t.value == ":":
            return True
    return False


def _candidate_function(tokens: list[Token], brace: int) -> Optional[tuple[str, str, int, str]]:
    """Если перед '{' стоит сигнатура функции, вернуть (имя, параметры, строка, сигнатура)."""
    j = brace - 1
    while j >= 0:
        v = tokens[j].value
        if v == ")":
            break
        if v in (";", "{", "}", "="):
            return None
        j -= 1
    if j < 0:
        return None

    # Между ')' и '{' допустимы только хвостовые квалификаторы/тип.
    depth = 0
    for t in tokens[j + 1:brace]:
        v = t.value
        if v in ("(", "[", "{"):
            depth += 1
        elif v in (")", "]", "}"):
            depth -= 1
        elif depth == 0 and v in (";", "="):
            return None
        elif depth == 0 and v == ":":
            # конструктор с initializer list — пропускаем
            return None

    k = _match_backward(tokens, j)
    if k <= 0:
        return None

    name_tok = tokens[k - 1]
    if name_tok.kind != "id" or name_tok.value in CONTROL:
        return None

    # Лямбда: []() { ... }
    if k >= 2 and tokens[k - 2].value in ("]", "=", ","):
        return None
    # Вызов макроса/функции с блоком маловероятен; отсекаем 'if' и т.п. выше.

    params = format_tokens(tokens[k + 1:j])
    signature = format_tokens(tokens[max(0, k - 1):j + 1])
    return name_tok.value, params, name_tok.line, signature


def find_functions(tokens: list[Token]) -> list[Function]:
    functions: list[Function] = []
    i = 0
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t.value != "{":
            i += 1
            continue

        cand = _candidate_function(tokens, i)
        if cand is not None:
            name, params, line, signature = cand
            end = _match_forward(tokens, i)
            body_tokens = tokens[i:end + 1]
            parser = Parser(body_tokens)
            body = parser.parse_block()
            functions.append(
                Function(name=name, params=params, body=body, line=line, signature=signature)
            )
            i = end + 1
            continue

        if _is_container_brace(tokens, i):
            i += 1
            continue

        i = _match_forward(tokens, i) + 1

    return functions


# ---------------------------------------------------------------------------
# Форматирование выражений
# ---------------------------------------------------------------------------

def _fold_templates(tokens: list[Token]) -> list[str]:
    """Склеивает списки аргументов шаблонов: static_cast<unsigned char>(ch).

    '<' считается шаблонным, если парный '>' идёт (сбалансированно) и за ним
    стоит '(' — стандартная эвристика разрешения неоднозначности.
    """
    out: list[str] = []
    i = 0
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t.value == "<" and i > 0 and tokens[i - 1].kind == "id":
            depth = 0
            j = i
            ok = False
            while j < n:
                v = tokens[j].value
                if v == "<":
                    depth += 1
                elif v == ">":
                    depth -= 1
                    if depth == 0:
                        ok = True
                        break
                elif v == ">>":
                    depth -= 2
                    if depth <= 0:
                        ok = True  # парная '>' слилась с '>>'
                        break
                elif v in (";", "}", "{", "=", ",", ")"):
                    break
                j += 1
            if ok and 0 <= j < n and j + 1 < n and tokens[j + 1].value == "(":
                inner = " ".join(tk.value for tk in tokens[i + 1:j])
                # Приклеиваем прямо к предыдущему токену: static_cast<unsigned char>.
                if out and (out[-1][-1].isalnum() or out[-1][-1] == "_"):
                    out[-1] += "<" + inner + ">"
                else:
                    out.append("<" + inner + ">")
                i = j + 1
                continue
        out.append(t.value)
        i += 1
    return out


def format_tokens(tokens: list[Token]) -> str:
    """Собирает токены в читаемую строку C++."""
    if not tokens:
        return ""

    s = " ".join(_fold_templates(tokens))
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"\s*;\s*", "; ", s)
    s = re.sub(r"\s*([()\[\]{}])\s*", r"\1", s)
    s = re.sub(r"\s*(\.|->|::)\s*", r"\1", s)
    s = re.sub(r"\s*(\+\+|--)\s*", r"\1", s)
    s = re.sub(r"([!~])\s+", r"\1", s)
    s = re.sub(r"([=(,:;?])\s+([-+])\s+", r"\1 \2", s)
    s = re.sub(r"\b(return|case)\s+([-+])\s+", r"\1 \2", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _strip_outer_parens(text: str) -> str:
    text = text.strip()
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        ok = True
        for idx, ch in enumerate(text):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0 and idx != len(text) - 1:
                    ok = False
                    break
        if ok:
            text = text[1:-1].strip()
        else:
            break
    return text


def _has_top_level_colon(tokens: list[Token]) -> bool:
    depth = 0
    for t in tokens:
        v = t.value
        if v in ("(", "[", "{"):
            depth += 1
        elif v in (")", "]", "}"):
            depth -= 1
        elif v == ":" and depth == 0:
            return True
    return False


# ---------------------------------------------------------------------------
# Парсер операторов
# ---------------------------------------------------------------------------

class Parser:
    def __init__(self, tokens: list[Token]):
        self.tokens = tokens
        self.i = 0

    # -- служебное ---------------------------------------------------------
    def peek(self, offset: int = 0) -> Token:
        idx = self.i + offset
        if idx >= len(self.tokens):
            return self.tokens[-1]
        return self.tokens[idx]

    def at(self, value: str) -> bool:
        return self.peek().value == value

    def advance(self) -> Token:
        tok = self.peek()
        if tok.kind != "eof":
            self.i += 1
        return tok

    def expect(self, value: str) -> Token:
        tok = self.peek()
        if tok.value != value:
            # Мягкое восстановление: не падаем на неожиданном токене.
            return tok
        return self.advance()

    def _collect_until(self, stop: str) -> list[Token]:
        out: list[Token] = []
        depth = 0
        while True:
            tok = self.peek()
            if tok.kind == "eof":
                break
            v = tok.value
            if depth == 0 and v == stop:
                break
            if depth == 0 and v == "}" and stop != "}":
                break
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                if depth == 0:
                    break
                depth -= 1
            out.append(self.advance())
        return out

    def _collect_statement_tokens(self) -> list[Token]:
        out: list[Token] = []
        depth = 0
        while True:
            tok = self.peek()
            if tok.kind == "eof":
                break
            v = tok.value
            if depth == 0 and v == ";":
                self.advance()
                break
            if depth == 0 and v == "}":
                break
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                if depth == 0:
                    break
                depth -= 1
            out.append(self.advance())
        return out

    # -- блоки и операторы -------------------------------------------------
    def parse_block(self) -> Block:
        line = self.peek().line
        self.expect("{")
        body: list[Stmt] = []
        while not self.at("}") and self.peek().kind != "eof":
            before = self.i
            stmt = self.parse_statement()
            body.append(stmt)
            if self.i == before:
                self.advance()
        self.expect("}")
        return Block(line=line, body=body)

    def parse_statement(self) -> Stmt:
        tok = self.peek()
        line = tok.line

        if tok.kind == "eof" or tok.value == "}":
            return Empty(line=line)

        if tok.value == ";":
            self.advance()
            return Empty(line=line)

        if tok.value == "{":
            return self.parse_block()

        if tok.value == "if":
            self.advance()
            cond = self._parse_condition()
            then = self.parse_statement()
            else_: Optional[Stmt] = None
            if self.at("else"):
                self.advance()
                else_ = self.parse_statement()
            return If(line=line, cond=cond, then=then, else_=else_)

        if tok.value == "while":
            self.advance()
            cond = self._parse_condition()
            body = self.parse_statement()
            return While(line=line, cond=cond, body=body)

        if tok.value == "do":
            self.advance()
            body = self.parse_statement()
            self.expect("while")
            cond = self._parse_condition()
            self.expect(";")
            return DoWhile(line=line, body=body, cond=cond)

        if tok.value == "for":
            self.advance()
            return self._parse_for(line)

        if tok.value == "switch":
            self.advance()
            return self._parse_switch(line)

        if tok.value == "return":
            self.advance()
            expr = format_tokens(self._collect_statement_tokens())
            return Return(line=line, expr=expr or None)

        if tok.value == "break":
            self.advance()
            if self.at(";"):
                self.advance()
            return Break(line=line)

        if tok.value == "continue":
            self.advance()
            if self.at(";"):
                self.advance()
            return Continue(line=line)

        if tok.value == "try":
            self.advance()
            body = self.parse_statement()
            handlers: list[tuple[str, Stmt]] = []
            while self.at("catch"):
                self.advance()
                param = ""
                if self.at("("):
                    self.advance()
                    param = format_tokens(self._collect_until(")"))
                    self.expect(")")
                hbody = self.parse_statement()
                handlers.append((param, hbody))
            return Try(line=line, body=body, handlers=handlers)

        if tok.value in ("case", "default"):
            # Вне switch — просто пропускаем метку.
            self.advance()
            self._collect_until(":")
            self.expect(":")
            return self.parse_statement()

        # Метка вида `label:`
        if tok.kind == "id" and self.peek(1).value == ":":
            self.advance()
            self.advance()
            return self.parse_statement()

        # Пропускаем локальные объявления типов.
        if tok.value in DECL_SKIP:
            toks = self._collect_statement_tokens()
            # Если внутри был блок, _collect_statement_tokens его съел.
            text = format_tokens(toks)
            if tok.value in ("using", "typedef") and text:
                return ExprStmt(line=line, text=text, is_decl=True)
            return Empty(line=line)

        toks = self._collect_statement_tokens()
        if not toks:
            # Не смогли разобрать — пропускаем токен, чтобы не зациклиться.
            self.advance()
            return Empty(line=line)
        text = format_tokens(toks)
        is_decl = toks[0].value in {
            "int", "long", "short", "char", "float", "double", "bool", "auto",
            "unsigned", "signed", "const", "static", "string", "std", "vector",
            "size_t", "void", "constexpr", "struct", "class",
        }
        return ExprStmt(line=line, text=text, is_decl=is_decl)

    def _parse_condition(self) -> str:
        self.expect("(")
        toks = self._collect_until(")")
        self.expect(")")
        return _strip_outer_parens(format_tokens(toks))

    def _parse_for(self, line: int) -> For:
        self.expect("(")
        parts: list[list[Token]] = [[]]
        depth = 0
        while True:
            tok = self.peek()
            if tok.kind == "eof":
                break
            v = tok.value
            if depth == 0 and v == ")":
                break
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                depth -= 1
            if depth == 0 and v == ";":
                parts.append([])
                self.advance()
                continue
            parts[-1].append(self.advance())
        self.expect(")")

        init: Optional[str] = None
        cond: Optional[str] = None
        step: Optional[str] = None
        range_expr: Optional[str] = None

        if len(parts) == 1 and _has_top_level_colon(parts[0]):
            range_expr = format_tokens(parts[0])
        else:
            init = format_tokens(parts[0]) if len(parts) > 0 and parts[0] else None
            cond = format_tokens(parts[1]) if len(parts) > 1 and parts[1] else None
            step = format_tokens(parts[2]) if len(parts) > 2 and parts[2] else None

        body = self.parse_statement()
        return For(line=line, init=init, cond=cond, step=step, body=body, range_expr=range_expr)

    def _parse_switch(self, line: int) -> Switch:
        expr = self._parse_condition()
        self.expect("{")
        cases: list[Case] = []
        labels: list[Optional[str]] = []
        body: list[Stmt] = []
        case_line = line

        def flush() -> None:
            nonlocal labels, body
            if labels or body:
                cases.append(Case(labels=labels, body=body, line=case_line))
            labels = []
            body = []

        while not self.at("}") and self.peek().kind != "eof":
            if self.at("case"):
                case_line = self.peek().line
                self.advance()
                lab = format_tokens(self._collect_until(":"))
                self.expect(":")
                if body:
                    flush()
                labels.append("case " + lab)
                continue
            if self.at("default"):
                case_line = self.peek().line
                self.advance()
                self.expect(":")
                if body:
                    flush()
                labels.append(None)
                continue
            before = self.i
            body.append(self.parse_statement())
            if self.i == before:
                self.advance()

        self.expect("}")
        flush()
        return Switch(line=line, expr=expr, cases=cases)


# ---------------------------------------------------------------------------
# Публичный API
# ---------------------------------------------------------------------------

def parse_source(source: str) -> list[Function]:
    tokens = tokenize(source)
    return find_functions(tokens)


def parse_file(path: str) -> list[Function]:
    with open(path, encoding="utf-8") as fh:
        return parse_source(fh.read())
