"""Командная строка gostflow."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .api import GostFlowError, generate_svg, select_function
from .parser import parse_source
from .render import svg_to_png


def _read_source(path: str | None) -> tuple[str, str]:
    if path is None or path == "-":
        return sys.stdin.read(), "diagram"
    p = Path(path)
    return p.read_text(encoding="utf-8"), p.stem


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="gostflow",
        description=(
            "Построение блок-схем по ГОСТ 19.701-90 из исходного кода C++. "
            "Поддерживаются if/else, циклы, switch, return, break, continue."
        ),
    )
    p.add_argument("input", nargs="?", help="файл с кодом C++ (или - для stdin)")
    p.add_argument("-o", "--output", help="куда сохранить (.svg или .png)")
    p.add_argument("-f", "--function", help="имя функции (по умолчанию main)")
    p.add_argument("-t", "--title", help="заголовок схемы")
    p.add_argument(
        "--format",
        choices=["svg", "png", "both"],
        help="формат результата (по умолчанию определяется по расширению)",
    )
    p.add_argument("--list", action="store_true", help="показать найденные функции")
    p.add_argument("--line-numbers", action="store_true", help="показать номера строк")
    p.add_argument("--serve", action="store_true", help="запустить локальный веб-интерфейс")
    p.add_argument("--host", default="127.0.0.1", help="адрес веб-сервера")
    p.add_argument("--port", type=int, default=8000, help="порт веб-сервера")
    p.add_argument("--open", action="store_true", help="открыть браузер после запуска")
    p.add_argument("--version", action="version", version="gostflow 1.0.0")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.serve:
        from .web import serve

        serve(host=args.host, port=args.port, open_browser=args.open)
        return 0

    try:
        source, stem = _read_source(args.input)
    except OSError as exc:
        print(f"Ошибка чтения файла: {exc}", file=sys.stderr)
        return 2

    if not source.strip():
        print("Пустой исходный код.", file=sys.stderr)
        return 2

    if args.list:
        try:
            functions = parse_source(source)
        except Exception as exc:  # noqa: BLE001
            print(f"Ошибка разбора: {exc}", file=sys.stderr)
            return 2
        if not functions:
            print("Функции с телом не найдены.", file=sys.stderr)
            return 1
        for func in functions:
            print(f"{func.name}({func.params})  — строка {func.line}")
        return 0

    fmt = args.format
    if fmt is None:
        if args.output and args.output.lower().endswith(".png"):
            fmt = "png"
        else:
            fmt = "svg"

    if args.output == "-" and fmt != "svg":
        print("Вывод в stdout возможен только для SVG.", file=sys.stderr)
        return 2

    try:
        svg, functions, func = generate_svg(
            source,
            function=args.function,
            title=args.title,
            line_numbers=args.line_numbers,
        )
    except GostFlowError as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Ошибка построения: {exc}", file=sys.stderr)
        return 1

    if args.output == "-":
        sys.stdout.write(svg)
        return 0

    if args.output:
        out = Path(args.output)
    else:
        out = Path(stem + ".svg")

    if fmt == "both":
        base = out.with_suffix("") if out.suffix else out
        svg_path = base.with_suffix(".svg")
        png_path = base.with_suffix(".png")
    elif fmt == "svg":
        svg_path = out if out.suffix.lower() == ".svg" else out.with_suffix(".svg")
        png_path = None
    else:
        png_path = out if out.suffix.lower() == ".png" else out.with_suffix(".png")
        svg_path = None

    if svg_path is not None:
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text(svg, encoding="utf-8")
        print(f"SVG: {svg_path}  (функция {func.name})")

    if png_path is not None:
        png_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            svg_to_png(svg, str(png_path), scale=2.0)
        except Exception as exc:  # noqa: BLE001
            print(f"Не удалось создать PNG: {exc}", file=sys.stderr)
            return 1
        print(f"PNG: {png_path}  (функция {func.name})")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
