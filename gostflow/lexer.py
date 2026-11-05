"""Небольшой лексер для практического подмножества C++.

Задача лексера — не полный разбор языка, а аккуратное разбиение
исходника на токены, достаточное для построения блок-схемы.
Комментарии и директивы препроцессора отбрасываются.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    kind: str          # id | num | str | op | eof
    value: str
    line: int

    def __repr__(self) -> str:  # pragma: no cover - удобство отладки
        return f"Token({self.kind!r}, {self.value!r}, line={self.line})"


# Более длинные операторы должны идти раньше коротких.
_OPERATORS = [
    "<<=", ">>=", "->*", "...", "<=>",
    "::", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=",
    "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "##",
]

_SINGLE = set("+-*/%<>=!&|^~?:;,.()[]{}#")


def _strip_comments_and_preprocessor(src: str) -> str:
    """Удаляет комментарии и строки препроцессора, сохраняя переводы строк."""
    out: list[str] = []
    i = 0
    n = len(src)
    line_start = True
    in_line_comment = False
    in_block_comment = False

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                out.append("\n")
                line_start = True
            else:
                out.append(" ")
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                out.append("  ")
                i += 2
                continue
            out.append("\n" if ch == "\n" else " ")
            if ch == "\n":
                line_start = True
            i += 1
            continue

        # Директива препроцессора: пропускаем строку целиком (с учётом '\').
        if line_start and ch == "#":
            while i < n:
                c = src[i]
                if c == "\\" and i + 1 < n and src[i + 1] == "\n":
                    out.append(" \n")
                    i += 2
                    continue
                if c == "\n":
                    break
                out.append(" ")
                i += 1
            continue

        if ch == "/" and nxt == "/":
            in_line_comment = True
            out.append("  ")
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            out.append("  ")
            i += 2
            continue

        # Строковые и символьные литералы копируем как есть.
        if ch in ('"', "'"):
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                c = src[i]
                out.append(c)
                if c == "\\" and i + 1 < n:
                    out.append(src[i + 1])
                    i += 2
                    continue
                if c == quote:
                    i += 1
                    break
                if c == "\n":
                    # Незакрытый литерал — просто прекращаем.
                    break
                i += 1
            line_start = False
            continue

        out.append(ch)
        line_start = ch == "\n"
        i += 1

    return "".join(out)


def tokenize(src: str) -> list[Token]:
    src = _strip_comments_and_preprocessor(src)
    tokens: list[Token] = []
    i = 0
    n = len(src)
    line = 1

    while i < n:
        ch = src[i]

        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch.isspace():
            i += 1
            continue

        # Идентификаторы (включая юникодные буквы).
        if ch.isalpha() or ch == "_" or ord(ch) > 127:
            start = i
            while i < n and (src[i].isalnum() or src[i] == "_" or ord(src[i]) > 127):
                i += 1
            tokens.append(Token("id", src[start:i], line))
            continue

        # Числа (включая 0x, 0b, суффиксы, разделители разрядов).
        if ch.isdigit() or (ch == "." and i + 1 < n and src[i + 1].isdigit()):
            start = i
            if src.startswith(("0x", "0X", "0b", "0B"), i):
                i += 2
                while i < n and (src[i].isalnum() or src[i] in "._'"):
                    i += 1
            else:
                while i < n and (src[i].isalnum() or src[i] in "._'"):
                    i += 1
            tokens.append(Token("num", src[start:i], line))
            continue

        # Строковые литералы.
        if ch in ('"', "'"):
            start = i
            quote = ch
            i += 1
            while i < n:
                if src[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                if src[i] == "\n":
                    line += 1
                i += 1
            tokens.append(Token("str", src[start:i], line))
            continue

        # Операторы.
        matched = False
        for op in _OPERATORS:
            if src.startswith(op, i):
                tokens.append(Token("op", op, line))
                i += len(op)
                matched = True
                break
        if matched:
            continue

        if ch in _SINGLE:
            tokens.append(Token("op", ch, line))
            i += 1
            continue

        # Неизвестный символ — пропускаем.
        i += 1

    tokens.append(Token("eof", "", line))
    return tokens


if __name__ == "__main__":  # pragma: no cover
    import sys

    data = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else ""
    for tok in tokenize(data):
        print(tok)
