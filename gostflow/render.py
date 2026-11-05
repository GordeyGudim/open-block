"""Отрисовка блок-схемы в SVG и PNG."""

from __future__ import annotations

import html
import math
import shutil
import subprocess
from typing import Optional

from .flowchart import FEdge, FNode, Flowchart
from .layout import LINE_HEIGHT, layout


FONT_FAMILY = "'Liberation Sans', 'DejaVu Sans', Arial, sans-serif"


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _arrow(points: list[tuple[float, float]]) -> str:
    if len(points) < 2:
        return ""
    x1, y1 = points[-2]
    x2, y2 = points[-1]
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 0.5:
        return ""
    ux, uy = dx / length, dy / length
    base_x, base_y = x2 - ux * 11.0, y2 - uy * 11.0
    px, py = -uy * 4.8, ux * 4.8
    pts = [
        (x2, y2),
        (base_x + px, base_y + py),
        (base_x - px, base_y - py),
    ]
    return " ".join(f"{_fmt(x)},{_fmt(y)}" for x, y in pts)


def _edge_label_pos(
    edge: FEdge, points: list[tuple[float, float]]
) -> Optional[tuple[float, float, str]]:
    if not edge.label or len(points) < 2:
        return None
    x0, y0 = points[0]
    x1, y1 = points[1]
    if abs(x1 - x0) < 1.0:
        if y1 > y0:
            return (x0 + 10.0, y0 + 16.0, "start")
        return (x0 + 10.0, y0 - 10.0, "start")
    if x1 > x0:
        return (x0 + 8.0, y0 - 8.0, "start")
    return (x0 - 8.0, y0 - 8.0, "end")


def _edge_svg(edge: FEdge) -> str:
    pts = edge.points
    if len(pts) < 2:
        return ""
    d = "M " + " L ".join(f"{_fmt(x)} {_fmt(y)}" for x, y in pts)
    parts = [
        f'<path d="{d}" fill="none" stroke="#111111" stroke-width="1.6" '
        'stroke-linecap="butt" stroke-linejoin="miter"/>'
    ]
    arrow = _arrow(pts) if edge.arrow else ""
    if arrow:
        parts.append(f'<polygon points="{arrow}" fill="#111111" stroke="none"/>')

    label = _edge_label_pos(edge, pts)
    if label:
        lx, ly, anchor = label
        text = html.escape(edge.label or "")
        w = max(16.0, len(text) * 7.2 + 8.0)
        if anchor == "end":
            rx = lx - w + 4.0
        else:
            rx = lx - 4.0
        parts.append(
            f'<rect x="{_fmt(rx)}" y="{_fmt(ly - 13.0)}" width="{_fmt(w)}" '
            'height="17" fill="#ffffff" stroke="none"/>'
        )
        parts.append(
            f'<text x="{_fmt(lx)}" y="{_fmt(ly)}" text-anchor="{anchor}" '
            f'font-family="{FONT_FAMILY}" font-size="12" fill="#111111">'
            f"{text}</text>"
        )
    return f'<g class="edge">{"".join(parts)}</g>'


def _text_svg(node: FNode) -> str:
    lines = node.lines or [node.text]
    n = len(lines)
    top = node.cy - n * LINE_HEIGHT / 2.0
    spans = []
    for i, line in enumerate(lines):
        baseline = top + i * LINE_HEIGHT + 13.5
        spans.append(
            f'<tspan x="{_fmt(node.cx)}" y="{_fmt(baseline)}">{html.escape(line)}</tspan>'
        )
    return (
        f'<text text-anchor="middle" font-family="{FONT_FAMILY}" '
        f'font-size="14" fill="#111111">{"".join(spans)}</text>'
    )


def _node_svg(node: FNode, show_line_numbers: bool) -> str:
    x, y, w, h = node.x, node.y, node.width, node.height
    title = ""
    if node.line:
        title = f"<title>строка {node.line}: {html.escape(node.text)}</title>"

    if node.kind == "decision":
        shape = (
            f'<polygon points="{_fmt(node.cx)},{_fmt(y)} {_fmt(x + w)},{_fmt(node.cy)} '
            f'{_fmt(node.cx)},{_fmt(y + h)} {_fmt(x)},{_fmt(node.cy)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )
    elif node.kind == "preparation":
        # Символ «Подготовка» (ГОСТ 19.701-90): шестиугольник — блок
        # цикла со счётчиком (for). Боковые вершины на серединах высоты.
        c = max(16.0, w * 0.16)
        shape = (
            f'<polygon points="'
            f'{_fmt(x + c)},{_fmt(y)} {_fmt(x + w - c)},{_fmt(y)} '
            f'{_fmt(x + w)},{_fmt(node.cy)} {_fmt(x + w - c)},{_fmt(y + h)} '
            f'{_fmt(x + c)},{_fmt(y + h)} {_fmt(x)},{_fmt(node.cy)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )
    elif node.kind == "io":
        slant = min(18.0, h / 3.0)
        shape = (
            f'<polygon points="{_fmt(x + slant)},{_fmt(y)} {_fmt(x + w)},{_fmt(y)} '
            f'{_fmt(x + w - slant)},{_fmt(y + h)} {_fmt(x)},{_fmt(y + h)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )
    elif node.kind == "terminator":
        shape = (
            f'<rect x="{_fmt(x)}" y="{_fmt(y)}" width="{_fmt(w)}" height="{_fmt(h)}" '
            f'rx="{_fmt(h / 2.0)}" ry="{_fmt(h / 2.0)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )
    elif node.kind == "predefined":
        shape = (
            f'<rect x="{_fmt(x)}" y="{_fmt(y)}" width="{_fmt(w)}" height="{_fmt(h)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
            f'<line x1="{_fmt(x + 11)}" y1="{_fmt(y)}" x2="{_fmt(x + 11)}" y2="{_fmt(y + h)}" '
            'stroke="#111111" stroke-width="1.4"/>'
            f'<line x1="{_fmt(x + w - 11)}" y1="{_fmt(y)}" x2="{_fmt(x + w - 11)}" y2="{_fmt(y + h)}" '
            'stroke="#111111" stroke-width="1.4"/>'
        )
    elif node.kind == "connector":
        shape = (
            f'<circle cx="{_fmt(node.cx)}" cy="{_fmt(node.cy)}" r="{_fmt(w / 2.0)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )
    else:
        shape = (
            f'<rect x="{_fmt(x)}" y="{_fmt(y)}" width="{_fmt(w)}" height="{_fmt(h)}" '
            'fill="#ffffff" stroke="#111111" stroke-width="1.6"/>'
        )

    extra = ""
    if show_line_numbers and node.line:
        extra = (
            f'<text x="{_fmt(x + w - 5)}" y="{_fmt(y + 11)}" text-anchor="end" '
            f'font-family="{FONT_FAMILY}" font-size="9" fill="#8a8a8a">{node.line}</text>'
        )
    return f'<g class="node">{title}{shape}{_text_svg(node)}{extra}</g>'


def render_svg(
    flow: Flowchart,
    title: Optional[str] = None,
    show_line_numbers: bool = False,
) -> str:
    res = layout(flow)
    margin = 26.0
    title_h = 40.0 if title else 0.0
    width = max(240.0, res.width + margin * 2.0)
    height = max(180.0, res.height + margin * 2.0 + title_h)
    ox = margin - res.min_x
    oy = margin + title_h - res.min_y

    edges_svg = "".join(_edge_svg(e) for e in res.edges)
    nodes_svg = "".join(_node_svg(n, show_line_numbers) for n in res.nodes)

    title_svg = ""
    if title:
        title_svg = (
            f'<text x="{_fmt(width / 2.0)}" y="{_fmt(margin + 22.0)}" '
            f'text-anchor="middle" font-family="{FONT_FAMILY}" font-size="19" '
            f'font-weight="600" fill="#111111">{html.escape(title)}</text>'
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_fmt(width)}" '
        f'height="{_fmt(height)}" viewBox="0 0 {_fmt(width)} {_fmt(height)}" '
        'role="img" aria-label="Блок-схема алгоритма">\n'
        f'<rect x="0" y="0" width="{_fmt(width)}" height="{_fmt(height)}" fill="#ffffff"/>\n'
        f"{title_svg}\n"
        f'<g transform="translate({_fmt(ox)},{_fmt(oy)})">\n'
        f"{edges_svg}\n{nodes_svg}\n"
        "</g>\n</svg>\n"
    )


def svg_to_png(svg: str, path: str, scale: float = 2.0) -> None:
    rsvg = shutil.which("rsvg-convert")
    if rsvg:
        proc = subprocess.run(
            [rsvg, "-z", str(scale), "-b", "white", "-o", path],
            input=svg.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode == 0:
            return
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip())

    convert = shutil.which("convert") or shutil.which("magick")
    if convert:
        proc = subprocess.run(
            [convert, "-density", str(int(96 * scale)), "svg:-", path],
            input=svg.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode == 0:
            return
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip())

    raise RuntimeError(
        "Для PNG нужен rsvg-convert (пакет librsvg2-bin) или ImageMagick."
    )
