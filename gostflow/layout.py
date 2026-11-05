"""Раскладка блок-схемы.

Позиции вершин вычисляет Graphviz (dot) — это даёт устойчивую
иерархическую раскладку. Маршруты линий строятся самостоятельно,
чтобы все соединения были ортогональными, как требует ГОСТ.
"""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from dataclasses import dataclass

from .flowchart import FEdge, FNode, Flowchart


FONT_SIZE = 14.0
LINE_HEIGHT = 19.0

# Предельная ширина текста до переноса, px.
TEXT_WIDTH = {
    "terminator": 220.0,
    "process": 300.0,
    "decision": 180.0,
    "preparation": 320.0,
    "io": 280.0,
    "predefined": 280.0,
    "connector": 80.0,
}

PX_PER_INCH = 72.0


# ---------------------------------------------------------------------------
# Текст и размеры
# ---------------------------------------------------------------------------

def char_width(ch: str, size: float = FONT_SIZE) -> float:
    if ch in "il.,;:'|!`":
        return 0.28 * size
    if ch == " ":
        return 0.30 * size
    if ch in "MWШЩЖЮФ@":
        return 0.86 * size
    if ch in "mwшщжюф":
        return 0.76 * size
    if ch.isupper():
        return 0.64 * size
    if ch.isdigit():
        return 0.56 * size
    if ord(ch) > 127:
        return 0.59 * size
    if ch in "()-+*/=<>[]{}":
        return 0.38 * size
    return 0.54 * size


def text_width(text: str, size: float = FONT_SIZE) -> float:
    return sum(char_width(ch, size) for ch in text)


def wrap_text(text: str, max_width: float) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text.strip())
    if not text:
        return [""]

    lines: list[str] = []
    for paragraph in text.split("\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            lines.append("")
            continue
        words = paragraph.split(" ")
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if text_width(candidate) <= max_width or not current:
                if text_width(word) > max_width and not current:
                    # Длинный токен (выражение без пробелов) рвём по символам.
                    chunk = ""
                    for ch in word:
                        if text_width(chunk + ch) > max_width and chunk:
                            lines.append(chunk)
                            chunk = ch
                        else:
                            chunk += ch
                    current = chunk
                else:
                    current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines or [""]


def measure_node(node: FNode) -> None:
    max_text = TEXT_WIDTH.get(node.kind, 300.0)
    node.lines = wrap_text(node.text, max_text)
    tw = max((text_width(line) for line in node.lines), default=0.0)
    th = len(node.lines) * LINE_HEIGHT

    if node.kind == "decision":
        node.width = max(180.0, tw * 2.2 + 50.0)
        node.height = max(82.0, th * 2.2 + 50.0)
    elif node.kind == "preparation":
        # Шестиугольник «Подготовка» (ГОСТ): широкий, часто три части
        # текста в одну строку.
        node.width = max(200.0, tw + 90.0)
        node.height = max(60.0, th + 28.0)
    elif node.kind == "terminator":
        node.width = max(150.0, tw + 70.0)
        node.height = max(52.0, th + 26.0)
    elif node.kind == "io":
        node.width = max(140.0, tw + 64.0)
        node.height = max(54.0, th + 26.0)
    elif node.kind == "predefined":
        node.width = max(140.0, tw + 68.0)
        node.height = max(54.0, th + 26.0)
    elif node.kind == "connector":
        node.width = node.height = 44.0
    else:
        node.width = max(120.0, tw + 44.0)
        node.height = max(54.0, th + 26.0)


# ---------------------------------------------------------------------------
# Graphviz
# ---------------------------------------------------------------------------

def _dot_source(nodes: list[FNode], edges: list[FEdge]) -> str:
    out = [
        "digraph flowchart {",
        '  graph [rankdir=TB, nodesep=0.50, ranksep=0.62, splines=true, '
        'ordering=out, pad=0.15];',
        '  node [shape=box, fixedsize=true, label="", style="filled", '
        'fillcolor="white", color="black", penwidth=1.2];',
        '  edge [color="black", penwidth=1.2];',
    ]
    for n in nodes:
        out.append(
            f'  n{n.id} [width={n.width / PX_PER_INCH:.5f}, '
            f'height={n.height / PX_PER_INCH:.5f}];'
        )
    for e in edges:
        constraint = "true"
        weight = "2"
        if e.kind in ("back", "break", "continue"):
            constraint = "false"
            weight = "0"
        elif e.kind == "return":
            constraint = "true"
            weight = "1"
        out.append(
            f"  n{e.src} -> n{e.dst} [constraint={constraint}, weight={weight}];"
        )

    # Невидимые рёбра-ограничения: выход из петли должен оказаться
    # НИЖЕ её тела/шага, иначе обратное ребро пойдёт через весь
    # последующий код.  Для break аналогично опускаем точку выхода.
    for e in edges:
        if e.kind == "back":
            exits = [x for x in edges if x.src == e.dst and x.kind == "false"]
            for x in exits:
                if x.dst != e.src:
                    out.append(
                        f"  n{e.src} -> n{x.dst} [style=invis, constraint=true, weight=1];"
                    )
        elif e.kind == "break":
            out.append(
                f"  n{e.src} -> n{e.dst} [style=invis, constraint=true, weight=1];"
            )
    out.append("}")
    return "\n".join(out)


_NODE_LINE = re.compile(
    r"^node\s+(\S+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)"
)
_GRAPH_LINE = re.compile(r"^graph\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)")


def graphviz_layout(nodes: list[FNode], edges: list[FEdge]) -> tuple[float, float]:
    dot = shutil.which("dot")
    if not dot:
        raise RuntimeError(
            "Не найден Graphviz (dot). Установите пакет graphviz, например: "
            "sudo apt install graphviz"
        )

    source = _dot_source(nodes, edges)
    proc = subprocess.run(
        [dot, "-Tplain"],
        input=source.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"Graphviz завершился с ошибкой: {msg}")

    plain = proc.stdout.decode("utf-8", "replace")
    by_id = {n.id: n for n in nodes}
    scale = 1.0
    graph_w = graph_h = 0.0
    positions: dict[int, tuple[float, float, float, float]] = {}

    for line in plain.splitlines():
        g = _GRAPH_LINE.match(line)
        if g:
            scale = float(g.group(1))
            graph_w = float(g.group(2))
            graph_h = float(g.group(3))
            continue
        m = _NODE_LINE.match(line)
        if not m:
            continue
        name = m.group(1)
        if not name.startswith("n"):
            continue
        try:
            nid = int(name[1:])
        except ValueError:
            continue
        positions[nid] = tuple(float(m.group(i)) for i in range(2, 6))  # type: ignore[assignment]

    if not positions:
        raise RuntimeError("Graphviz не вернул координаты вершин.")

    k = PX_PER_INCH * scale
    for nid, (x, y, w, h) in positions.items():
        node = by_id.get(nid)
        if node is None:
            continue
        node.x = (x - w / 2.0) * k
        node.y = (graph_h - (y + h / 2.0)) * k

    # Страховка для вершин, которых вдруг не оказалось в выводе.
    missing = [n for n in nodes if n.id not in positions]
    if missing:
        y = 0.0
        for node in missing:
            node.x = 0.0
            node.y = y
            y += node.height + 30.0

    return graph_w * k, graph_h * k


# ---------------------------------------------------------------------------
# Маршрутизация рёбер
# ---------------------------------------------------------------------------

def _port(n: FNode, side: str) -> tuple[float, float]:
    if n.kind == "preparation":
        # Условие for: обычные входы и истинная ветвь идут через середины
        # верхнего/нижнего рёбер; выход «Нет» — через правую вершину.
        if side == "N":
            return (n.cx, n.y)
        if side == "S":
            return (n.cx, n.bottom)
        if side == "E":
            return (n.right, n.cy)
        if side == "W":
            return (n.x, n.cy)
    if side == "N":
        return (n.cx, n.y)
    if side == "S":
        return (n.cx, n.bottom)
    if side == "E":
        return (n.right, n.cy)
    return (n.x, n.cy)


def _span_nodes(nodes: list[FNode], y1: float, y2: float) -> list[FNode]:
    lo, hi = min(y1, y2), max(y1, y2)
    return [n for n in nodes if n.bottom > lo and n.y < hi]


def _channel(
    side: str,
    nodes: list[FNode],
    y1: float,
    y2: float,
    offset: float,
    reg: "_LanePlan | None" = None,
    claim: bool = True,
) -> float:
    """Вертикальный канал сбоку от всех блоков в диапазоне высот.

    Если передан реестр каналов, выбирается полоса, не совпадающая с
    уже занятыми в этом же диапазоне высот (шаг — 26 px). С claim=False
    канал только оценивается (для сравнения вариантов маршрута).
    """
    span = _span_nodes(nodes, y1, y2)
    if side == "E":
        base = max((n.right for n in span), default=0.0) + 30.0 + offset
    else:
        base = min((n.x for n in span), default=0.0) - 30.0 - offset
    if reg is None:
        return base
    if claim:
        return reg.claim(side, base, y1, y2)
    return reg.peek(side, base, y1, y2)


def _path_len(points: list[tuple[float, float]]) -> float:
    return sum(
        abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(points, points[1:])
    )


def _seg_intersects(
    a1: tuple[float, float],
    a2: tuple[float, float],
    b1: tuple[float, float],
    b2: tuple[float, float],
    eps: float = 0.6,
) -> bool:
    """Пересекаются ли два (ортогональных) отрезка «по-настоящему».

    Пересечением считаем сквозной проезд, Т-стык и наложение соосных
    отрезков; касание в общей конечной точке (общий порт) — нет.
    """
    (x1, y1), (x2, y2) = a1, a2
    (x3, y3), (x4, y4) = b1, b2
    ax_lo, ax_hi = min(x1, x2), max(x1, x2)
    ay_lo, ay_hi = min(y1, y2), max(y1, y2)
    bx_lo, bx_hi = min(x3, x4), max(x3, x4)
    by_lo, by_hi = min(y3, y4), max(y3, y4)
    if ax_hi - ax_lo < eps and ay_hi - ay_lo < eps:
        return False
    if bx_hi - bx_lo < eps and by_hi - by_lo < eps:
        return False
    a_horiz = ay_hi - ay_lo < eps
    a_vert = ax_hi - ax_lo < eps
    b_horiz = by_hi - by_lo < eps
    b_vert = bx_hi - bx_lo < eps
    if a_horiz and b_vert:
        ix, iy = x3, y1
        at_end_a = (
            (abs(ix - ax_lo) < eps or abs(ix - ax_hi) < eps)
            and (abs(iy - ay_lo) < eps or abs(iy - ay_hi) < eps)
        )
        at_end_b = (
            (abs(iy - by_lo) < eps or abs(iy - by_hi) < eps)
            and (abs(ix - bx_lo) < eps or abs(ix - bx_hi) < eps)
        )
        if at_end_a and at_end_b:
            return False
        return (
            ax_lo - eps <= ix <= ax_hi + eps and by_lo - eps <= iy <= by_hi + eps
        )
    if a_vert and b_horiz:
        return _seg_intersects(b1, b2, a1, a2, eps)
    if a_horiz and b_horiz and abs(y1 - y3) < eps:
        return min(ax_hi, bx_hi) - max(ax_lo, bx_lo) > eps
    if a_vert and b_vert and abs(x1 - x3) < eps:
        return min(ay_hi, by_hi) - max(ay_lo, by_lo) > eps
    return False


def _seg_hit(
    a1: tuple[float, float],
    a2: tuple[float, float],
    b1: tuple[float, float],
    b2: tuple[float, float],
    eps: float = 0.6,
) -> tuple[float, float] | None:
    """Точка «настоящего» пересечения отрезков (или None)."""
    if not _seg_intersects(a1, a2, b1, b2, eps):
        return None
    (x1, y1), (x2, y2) = a1, a2
    (x3, y3), (x4, y4) = b1, b2
    ax_lo, ax_hi = min(x1, x2), max(x1, x2)
    ay_lo, ay_hi = min(y1, y2), max(y1, y2)
    bx_lo, bx_hi = min(x3, x4), max(x3, x4)
    by_lo, by_hi = min(y3, y4), max(y3, y4)
    a_horiz = ay_hi - ay_lo < eps
    a_vert = ax_hi - ax_lo < eps
    b_horiz = by_hi - by_lo < eps
    b_vert = bx_hi - bx_lo < eps
    if a_horiz and b_vert:
        return (x3, y1)
    if a_vert and b_horiz:
        return (x1, y3)
    if a_horiz and b_horiz:
        return ((max(ax_lo, bx_lo) + min(ax_hi, bx_hi)) / 2.0, y1)
    return ((x1), (max(ay_lo, by_lo) + min(ay_hi, by_hi)) / 2.0)


def _entry_zone(target: FNode) -> dict[str, float]:
    """Зона манёвра входа в блок — там разнос точек входа разведёт линии."""
    return {
        "x1": target.x - 24.0,
        "x2": target.right + 24.0,
        "y1": target.y - 90.0,
        "y2": target.bottom + 90.0,
    }


def _count_crossings(
    pts: list[tuple[float, float]],
    routed: list[list[tuple[float, float]]],
    target: FNode | None = None,
) -> int:
    """Число пересечений маршрута pts с уже проложенными рёбрами.

    Столкновения в зоне входа в общий целевой блок игнорируются:
    разнос точек входа (_spread_entries) разведёт их по склону.
    """
    zone = _entry_zone(target) if target is not None else None
    n = 0
    cand_segs = list(zip(pts, pts[1:]))
    for other in routed:
        same_target = target is not None and other.dst == target.id
        other_segs = list(zip(other.points, other.points[1:]))
        for i, (s1, s2) in enumerate(cand_segs):
            for j, (t1, t2) in enumerate(other_segs):
                p = _seg_hit(s1, s2, t1, t2)
                if p is None:
                    continue
                if (
                    zone is not None
                    and same_target
                    and i >= len(cand_segs) - 2
                    and j >= len(other_segs) - 2
                    and zone["x1"] <= p[0] <= zone["x2"]
                    and zone["y1"] <= p[1] <= zone["y2"]
                ):
                    continue
                n += 1
    return n


class _LanePlan:
    """Реестр занятых вертикальных каналов и «этажей» подхода к блоку."""

    def __init__(self) -> None:
        self.lanes: dict[str, list[tuple[float, float, float]]] = {
            "E": [],
            "W": [],
        }
        self.rows: dict[int, int] = {}
        self.horiz: dict[int, list[float]] = {}

    def _find_h(
        self,
        node_id: int,
        y: float,
        nodes: list[FNode],
        step: float,
        skip_id: int | None = None,
    ) -> float:
        taken = self.horiz.get(node_id, [])
        for k in range(0, 6):
            for y_try in (y + step * k, y - step * k):
                if (
                    all(abs(y_try - t) >= 26.0 for t in taken)
                    and _y_is_clear(y_try, nodes, skip_id)
                ):
                    return y_try
        return y

    def claim_h(
        self,
        node_id: int,
        y: float,
        nodes: list[FNode],
        down: bool,
        skip_id: int | None = None,
    ) -> float:
        """Занимает горизонталь возле узла (выход или подход jump-ребра),
        отодвигая последующих на шаг, чтобы линии не накладывались."""
        y = self._find_h(node_id, y, nodes, 26.0 if down else -26.0, skip_id)
        self.horiz.setdefault(node_id, []).append(y)
        return y

    def peek_h(
        self,
        node_id: int,
        y: float,
        nodes: list[FNode],
        down: bool,
        skip_id: int | None = None,
    ) -> float:
        return self._find_h(node_id, y, nodes, 26.0 if down else -26.0, skip_id)

    def claim_row(self, node_id: int, base_y: float, step: float = 20.0) -> float:
        """Очередной горизонтальный подход к вершине сверху: у каждого
        ребра свой «этаж», чтобы отрезки не накладывались."""
        k = self.rows.get(node_id, 0)
        self.rows[node_id] = k + 1
        return base_y - step * k

    def peek_row(self, node_id: int, base_y: float, step: float = 20.0) -> float:
        """Какой «этаж» достался бы при claim_row — но без занятия."""
        k = self.rows.get(node_id, 0)
        return base_y - step * k

    def _find(self, side: str, base: float, y1: float, y2: float, gap: float = 26.0) -> float:
        lo = min(y1, y2) - 10.0
        hi = max(y1, y2) + 10.0
        step = gap if side == "E" else -gap
        x = base
        while any(
            abs(x - lx) < gap and not (hi < llo or lo > lhi)
            for lx, llo, lhi in self.lanes[side]
        ):
            x += step
        return x

    def claim(self, side: str, base: float, y1: float, y2: float, gap: float = 26.0) -> float:
        x = self._find(side, base, y1, y2, gap)
        lo = min(y1, y2) - 10.0
        hi = max(y1, y2) + 10.0
        self.lanes[side].append((x, lo, hi))
        return x

    def peek(self, side: str, base: float, y1: float, y2: float, gap: float = 26.0) -> float:
        """Какой канал достался бы при claim — но без занятия (для оценки)."""
        return self._find(side, base, y1, y2, gap)


def _simplify(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    clean: list[tuple[float, float]] = []
    for p in points:
        if not clean or abs(p[0] - clean[-1][0]) > 0.4 or abs(p[1] - clean[-1][1]) > 0.4:
            clean.append(p)
    out: list[tuple[float, float]] = []
    for p in clean:
        if len(out) >= 2:
            a, b = out[-2], out[-1]
            if (abs(a[0] - b[0]) < 0.4 and abs(b[0] - p[0]) < 0.4) or (
                abs(a[1] - b[1]) < 0.4 and abs(b[1] - p[1]) < 0.4
            ):
                out[-1] = p
                continue
        out.append(p)
    return out


def _row_nodes(s: FNode, nodes: list[FNode], right_side: bool) -> list[FNode]:
    """Блоки на той же строке, что и источник, правее (или левее) него."""
    cy = s.cy
    out: list[FNode] = []
    for n in nodes:
        if n is s:
            continue
        if not (n.y - 1.0 <= cy <= n.bottom + 1.0):
            continue
        if right_side and n.x >= s.right - 1.0:
            out.append(n)
        elif not right_side and n.right <= s.x + 1.0:
            out.append(n)
    return out


def _exit_corridor(s: FNode, nodes: list[FNode], going_down: bool, right_side: bool) -> float:
    """Свободная горизонталь возле источника, чтобы выйти из строки.

    Если на выходу мешают блоки соседних ветвей, сначала уходим
    вниз/вверх мимо них и только потом поворачиваем.
    """
    row = _row_nodes(s, nodes, right_side)
    if not row:
        return s.cy
    if going_down:
        return max(n.bottom for n in row) + 12.0
    return min(n.y for n in row) - 12.0


def _y_is_clear(y: float, nodes: list[FNode], skip_id: int | None = None) -> bool:
    return not any(
        n.id != skip_id and n.y - 1.0 <= y <= n.bottom + 1.0 for n in nodes
    )


def _clear_y(y_pref: float, nodes: list[FNode], lo: float, hi: float) -> float:
    """Ближайшая к y_pref горизонталь без блоков в диапазоне [lo, hi]."""
    if hi - lo < 14.0:
        return y_pref
    for d in range(0, 260, 8):
        for y in (y_pref + d, y_pref - d):
            if lo + 4.0 <= y <= hi - 4.0 and _y_is_clear(y, nodes):
                return y
    return y_pref


def _side_path(
    s: FNode,
    t: FNode,
    nodes: list[FNode],
    offset: float,
    force_side: str | None = None,
    enter: str | None = None,
    reg: _LanePlan | None = None,
) -> list[tuple[float, float]]:
    """Обход сбоку: выход из источника вбок, вертикальный канал,
    горизонтальный подход и вход в цель с выбранной стороны."""
    side = force_side or ("E" if t.cx > s.cx - 1.0 else "W")
    if enter is None:
        enter = "N" if t.cy > s.cy + 4.0 else ("W" if side == "E" else "E")
    sp = _port(s, side)
    stub_x = s.right + 12.0 if side == "E" else s.x - 12.0
    corridor = _exit_corridor(s, nodes, t.cy >= s.cy, side == "E")
    if reg is not None:
        corridor = reg.claim_h(s.id, corridor, nodes, t.cy >= s.cy, skip_id=s.id)
    ch = _channel(side, nodes, s.cy, t.cy, offset, reg)
    pts = [sp, (stub_x, sp[1]), (stub_x, corridor), (ch, corridor)]

    if enter == "N":
        # Свой «этаж» подхода у каждого ребра: обратные рёбра и боковые
        # входы не ложатся на одну и ту же горизонталь над блоком.
        approach = t.y - 12.0
        if reg is not None:
            approach = reg.claim_row(t.id, t.y - 14.0)
        pts += [(ch, approach), (t.cx, approach), _port(t, "N")]
    elif enter == "S":
        approach = t.bottom + 12.0
        pts += [(ch, approach), (t.cx, approach), _port(t, "S")]
    else:
        pts += [(ch, t.cy), _port(t, enter)]
    return _simplify(pts)


def _route_forward(
    s: FNode, t: FNode, nodes: list[FNode], offset: float,
    reg: _LanePlan | None = None,
) -> list[tuple[float, float]]:
    if t.cy > s.cy + 4.0:
        if s.kind == "preparation":
            # Ветка продолжения цикла всегда выходит из нижнего ребра,
            # даже если Graphviz заметно сместил тело в сторону.
            start = _port(s, "S")
            target = _port(t, "N")
            y = _clear_y((s.bottom + t.y) / 2.0, nodes, s.bottom, t.y)
            return _simplify([start, (start[0], y), (target[0], y), target])
        if t.kind == "preparation":
            # Обычный вход в for приходит в середину верхнего ребра.
            start = _port(s, "S")
            target = _port(t, "N")
            y = (s.bottom + t.y) / 2.0
            return _simplify([start, (start[0], y), (target[0], y), target])
        dx = t.cx - s.cx
        if abs(dx) < 2.0:
            return _simplify([_port(s, "S"), _port(t, "N")])
        mid = (s.bottom + t.y) / 2.0
        y = _clear_y(mid, nodes, s.bottom, t.y)
        if abs(dx) < 38.0:
            return _simplify([
                _port(s, "S"),
                (s.cx, y),
                (t.cx, y),
                _port(t, "N"),
            ])
        if _y_is_clear(y, nodes):
            # Плавный Z-переход по свободной горизонтали.
            sp = _port(s, "E" if dx > 0 else "W")
            stub_x = s.right + 12.0 if dx > 0 else s.x - 12.0
            return _simplify([sp, (stub_x, sp[1]), (stub_x, y), (t.cx, y), _port(t, "N")])
        return _side_path(s, t, nodes, offset, enter="N", reg=reg)

    # Цель на том же уровне или выше — обходим сбоку.
    if abs(t.cy - s.cy) < 4.0:
        side = "E" if t.cx >= s.cx else "W"
        return _side_path(s, t, nodes, offset, force_side=side,
                          enter=("W" if side == "E" else "E"), reg=reg)
    # К «ветвящемуся» блоку (ромб, шестиугольник) поднимаемся через
    # его вершину: вход сбоку сталкивается с выходом «Нет».
    enter = "N" if t.kind in ("decision", "preparation") else "E"
    return _side_path(s, t, nodes, offset, enter=enter, reg=reg)


def _route_true_branch(
    s: FNode, t: FNode, nodes: list[FNode], offset: float,
    reg: _LanePlan | None = None,
    side: str | None = None,
) -> list[tuple[float, float]]:
    """Ветвь ромба обходит с целевой стороны; for выходит снизу."""
    if s.kind == "decision":
        side = side or ("E" if t.cx >= s.cx else "W")
        return _side_path(
            s, t, nodes, offset, force_side=side, enter="N", reg=reg
        )
    start = _port(s, "S")
    target = _port(t, "N")
    y = _clear_y((s.bottom + t.y) / 2.0, nodes, s.bottom, t.y)
    return _simplify([start, (start[0], y), (target[0], y), target])


def _route_false_branch(
    s: FNode, t: FNode, nodes: list[FNode], offset: float,
    reg: _LanePlan | None = None,
    side: str | None = None,
) -> list[tuple[float, float]]:
    """Боковая ветвь ромба идёт к цели с её стороны; for выходит справа."""
    if s.kind == "decision":
        side = side or ("E" if t.cx >= s.cx else "W")
        # Нет из if внутри цикла пропускает тело и возвращается в левую
        # вершину шестиугольника; обычные переходы входят сверху по центру.
        enter = "W" if t.kind == "preparation" else "N"
        return _side_path(
            s, t, nodes, offset, force_side=side, enter=enter, reg=reg
        )
    if t.kind == "preparation":
        # Выход внутреннего for продолжает внешний цикл через его левую
        # вершину, а не возвращается в верхнее ребро/правую грань.
        enter = "W"
    else:
        enter = "N" if t.cy >= s.cy else "E"
    return _side_path(s, t, nodes, offset, force_side="E", enter=enter, reg=reg)


def _route_nested_for_exit(
    s: FNode, t: FNode, nodes: list[FNode]
) -> list[tuple[float, float]]:
    """Ведёт выход внутреннего for вокруг внешнего к его левой вершине."""
    start = _port(s, "E")
    target = _port(t, "W")
    right_lane = max(s.right, t.right) + 24.0
    top_lane = t.y - 18.0
    left_lane = t.x - 18.0
    return _simplify([
        start,
        (right_lane, start[1]),
        (right_lane, top_lane),
        (left_lane, top_lane),
        (left_lane, target[1]),
        target,
    ])


def _route_for_exit_to_next(s: FNode, t: FNode, nodes: list[FNode]) -> list[tuple[float, float]]:
    """Выходит из правой вершины for и приходит в середину верхнего ребра следующего."""
    start = _port(s, "E")
    # Дорожка привязана к паре блоков: выходы соседних циклов не
    # накладываются на одну общую вертикаль у крайнего правого блока.
    right_lane = max(s.right, t.right) + 24.0
    top_lane = t.y - 14.0
    return _simplify([
        start,
        (right_lane, start[1]),
        (right_lane, top_lane),
        (t.cx, top_lane),
        _port(t, "N"),
    ])


def _route_side(
    s: FNode, t: FNode, nodes: list[FNode], offset: float,
    reg: _LanePlan | None = None,
) -> list[tuple[float, float]]:
    if s.kind == "preparation":
        # Ветка «Нет» у for всегда покидает шестиугольник через правую
        # вершину, независимо от того, где Graphviz поставил продолжение.
        enter = "N" if t.cy >= s.cy else "E"
        return _side_path(s, t, nodes, offset, force_side="E", enter=enter, reg=reg)
    if t.cy >= s.cy:
        side = "E" if t.cx > s.cx - 1.0 else "W"
        return _side_path(s, t, nodes, offset, force_side=side, enter="N", reg=reg)
    enter = "N" if t.kind in ("decision", "preparation") else "E"
    return _side_path(s, t, nodes, offset, enter=enter, reg=reg)


def _route_jump(
    s: FNode, t: FNode, nodes: list[FNode], offset: float, kind: str,
    reg: _LanePlan | None = None,
    routed: list[FEdge] | None = None,
) -> list[tuple[float, float]]:
    decision_top = t.kind == "decision" and kind in (
        "back", "continue", "break"
    )
    return_end = kind == "return" and t.kind == "terminator"
    down = t.cy >= s.cy

    def build(side: str, claim: bool) -> list[tuple[float, float]]:
        sp = _port(s, side)
        stub_x = s.right + 12.0 if side == "E" else s.x - 12.0
        corridor = _exit_corridor(s, nodes, down, side == "E")
        if reg is not None:
            corridor = (
                reg.claim_h(s.id, corridor, nodes, down, skip_id=s.id)
                if claim
                else reg.peek_h(s.id, corridor, nodes, down, skip_id=s.id)
            )
        ch = _channel(side, nodes, s.cy, t.cy, offset, reg, claim=claim)
        if decision_top:
            # Строгий ГОСТ-стиль: стрелка входит точно в вершину ромба,
            # а этаж подхода свой у каждого ребра, чтобы подходы не накладывались.
            if claim and reg is not None:
                approach_y = reg.claim_row(t.id, t.y - 14.0)
            elif reg is not None:
                approach_y = reg.peek_row(t.id, t.y - 14.0)
            else:
                approach_y = t.y - 14.0
            return _simplify([
                sp,
                (stub_x, sp[1]),
                (stub_x, corridor),
                (ch, corridor),
                (ch, approach_y),
                (t.cx, approach_y),
                _port(t, "N"),
            ])
        if return_end:
            # Вход в «Конец» сверху; точные точки входа разносит
            # постобработка (entry jitter) в route_edges.
            return _simplify([
                sp,
                (stub_x, sp[1]),
                (stub_x, corridor),
                (ch, corridor),
                (ch, t.y - 12.0),
                (t.cx, t.y - 12.0),
                (t.cx, t.y),
            ])
        # Подход к цели по её боковой стороне: горизонталь тоже заносим
        # в реестр, чтобы у этого узла подход и выход соседнего jump-ребра
        # шли на разных уровнях; уровень зажимаем в пределы стороны узла.
        approach = t.cy
        if kind in ("back", "continue") and t.kind == "preparation":
            # Возврат к for входит в левую вершину шестиугольника.
            approach = t.cy
        elif reg is not None:
            approach = (
                reg.claim_h(t.id, approach, nodes, down, skip_id=t.id)
                if claim
                else reg.peek_h(t.id, approach, nodes, down, skip_id=t.id)
            )
            approach = min(max(approach, t.y + 8.0), t.bottom - 8.0)
        port = (t.right if side == "E" else t.x, approach)
        return _simplify([
            sp,
            (stub_x, sp[1]),
            (stub_x, corridor),
            (ch, corridor),
            (ch, approach),
            port,
        ])

    # Возврат тела for входит в левую вершину шестиугольника.
    if kind in ("back", "continue") and t.kind == "preparation":
        return build("W", True)

    if reg is None or not routed:
        return build("E", True)

    # Обход бывает восточным и западным: считаем пересечения каждого
    # варианта (без занятия каналов) и прокладываем лучший.
    east = build("E", claim=False)
    west = build("W", claim=False)
    e_cross = _count_crossings(east, routed or [], target=t)
    w_cross = _count_crossings(west, routed or [], target=t)
    if w_cross < e_cross or (
        w_cross == e_cross and _path_len(west) < _path_len(east)
    ):
        return build("W", claim=True)
    return build("E", claim=True)


def _route_self(s: FNode) -> list[tuple[float, float]]:
    return _simplify([
        _port(s, "E"),
        (s.right + 34.0, s.cy),
        (s.right + 34.0, s.y - 22.0),
        (s.cx, s.y - 22.0),
        _port(s, "N"),
    ])


def _entry_side(t: FNode, point: tuple[float, float]) -> str:
    x, y = point
    if t.kind == "decision":
        # Точка на склоне ромба: относим к верхним (N) или нижним (S)
        # наклонным сторонам по нормированному расстоянию до центра.
        ndx = (x - t.cx) / (t.width / 2.0)
        ndy = (y - t.cy) / (t.height / 2.0)
        if abs(abs(ndx) + abs(ndy) - 1.0) <= 0.06:
            return "N" if ndy < 0 else "S"
    if abs(y - t.y) <= 1.0:
        return "N"
    if abs(y - t.bottom) <= 1.0:
        return "S"
    if abs(x - t.right) <= 1.0:
        return "E"
    return "W"


def _spread_entries(
    nodes: list[FNode], edges: list[FEdge]
) -> None:
    """Разносит точки входа нескольких рёбер на одну сторону блока,
    чтобы стрелки не сливались в одну."""
    by_id = {n.id: n for n in nodes}
    groups: dict[tuple[int, str], list[FEdge]] = {}
    for edge in edges:
        if len(edge.points) < 2:
            continue
        t = by_id.get(edge.dst)
        if t is None:
            continue
        if t.kind == "terminator":
            # Несколько путей завершения сходятся в один вход «Конец».
            # Не разводим их по верхнему ребру терминатора.
            continue
        side = _entry_side(t, edge.points[-1])
        groups.setdefault((edge.dst, side), []).append(edge)

    for (nid, side), group in groups.items():
        if len(group) == 1:
            continue
        t = by_id[nid]
        if t.kind in ("decision", "preparation"):
            # Входы в ромб и шестиугольник строго в вершины — не разносятся.
            continue
        if side in ("N", "S"):
            count = len(group)
            span = max(10.0, t.width - 30.0)
            for k, edge in enumerate(group):
                frac = (k + 1) / (count + 1) - 0.5
                delta = frac * span
                x = t.cx + delta
                y = edge.points[-1][1]
                edge.points[-1] = (x, y)
                px, py = edge.points[-2]
                edge.points[-2] = (x, py)
        else:
            count = len(group)
            span = max(10.0, t.height - 30.0)
            for k, edge in enumerate(group):
                frac = (k + 1) / (count + 1) - 0.5
                delta = frac * span
                y = t.cy + delta
                x, _ = edge.points[-1]
                edge.points[-1] = (x, y)
                px, py = edge.points[-2]
                edge.points[-2] = (px, y)


def route_edges(nodes: list[FNode], edges: list[FEdge]) -> None:
    by_id = {n.id: n for n in nodes}
    reg = _LanePlan()
    branch_side: dict[tuple[int, str], str] = {}
    no_targets = {
        edge.src: by_id.get(edge.dst)
        for edge in edges
        if edge.label == "Нет"
    }
    for edge in edges:
        if edge.label != "Да":
            continue
        source, target = by_id.get(edge.src), by_id.get(edge.dst)
        if source is None or target is None or source.kind != "decision":
            continue
        no_target = no_targets.get(source.id)
        if no_target is not None and no_target.kind == "preparation":
            # «Нет» пропускает тело if и возвращается в цикл: обе точки
            # соединения остаются слева, не пересекая внешний выход for.
            yes_side = "E"
            branch_side[(source.id, "false")] = "W"
        else:
            yes_side = "E" if target.cx >= source.cx else "W"
            branch_side[(source.id, "false")] = "W" if yes_side == "E" else "E"
        branch_side[(source.id, "true")] = yes_side
    # Сначала обычные и обратные рёбра, потом боковые выходы («Нет») —
    # тогда их каналы всегда попадают наружу крайними и не пересекают
    # возвратные линии.
    # Порядок важен: сначала прямые рёбра, потом боковые выходы («Нет»),
    # их каналы ложатся ближе к ромбу, и лишь затем обходные jump-рёбра —
    # тем достаются внешние дорожки, а сторона обхода выбирается по
    # минимуму пересечений с уже проложенными линиями.
    def jumps(e: FEdge) -> bool:
        return e.kind in ("back", "break", "continue", "return")

    ordered = (
        [e for e in edges if not jumps(e) and not e.route_side]
        + [e for e in edges if not jumps(e) and e.route_side]
        + [e for e in edges if jumps(e)]
    )
    routed: list[FEdge] = []
    for edge in ordered:
        s = by_id.get(edge.src)
        t = by_id.get(edge.dst)
        if s is None or t is None:
            edge.points = []
            continue
        offset = 12.0 * (ordered.index(edge) % 7)
        if s.id == t.id:
            edge.points = _route_self(s)
        elif s.kind == "decision" and edge.label == "Да":
            edge.points = _route_true_branch(
                s, t, nodes, offset, reg=reg,
                side=branch_side.get((s.id, "true")),
            )
        elif s.kind == "decision" and edge.label == "Нет":
            # Вложенный if может иметь графовое kind="back", чтобы
            # Graphviz сохранил ранги цикла. Визуально это всё ещё ветвь
            # «Нет»: она должна выйти с другой стороны ромба и войти в
            # верхнее ребро следующего цикла.
            edge.points = _route_false_branch(
                s, t, nodes, offset, reg=reg,
                side=branch_side.get((s.id, "false")),
            )
        elif s.kind == "preparation" and edge.route_side:
            # Ложный выход for сохраняет своё значение, даже если его
            # одновременно пометили back для ранжирования внешнего цикла.
            if t.kind == "preparation":
                if t.cy > s.cy:
                    edge.points = _route_for_exit_to_next(s, t, nodes)
                else:
                    edge.points = _route_nested_for_exit(s, t, nodes)
            else:
                edge.points = _route_false_branch(s, t, nodes, offset, reg=reg)
        elif jumps(edge):
            edge.points = _route_jump(
                s, t, nodes, offset, edge.kind, reg=reg, routed=routed
            )
        elif edge.kind == "true" and s.kind == "preparation":
            edge.points = _route_true_branch(
                s, t, nodes, offset, reg=reg,
            )
        elif edge.kind == "false" and s.kind == "preparation":
            edge.points = _route_false_branch(
                s, t, nodes, offset, reg=reg,
            )
        elif edge.route_side:
            edge.points = _route_side(s, t, nodes, offset, reg=reg)
        else:
            edge.points = _route_forward(s, t, nodes, offset, reg=reg)
        if edge.points:
            routed.append(edge)
    _spread_entries(nodes, edges)

    # К блоку «Конец» ведёт один общий наконечник. Остальные завершения
    # сходятся в ту же точку без дублирующих стрелок.
    end_nodes = {
        n.id for n in nodes
        if n.kind == "terminator" and n.text.strip().lower() in ("конец", "end")
    }
    end_edges = [e for e in edges if e.dst in end_nodes and e.points]
    if end_edges:
        end = by_id[next(iter(end_nodes))]
        # От каждого источника обходим всю схему по внешней дорожке, затем
        # подводим линию к общему вертикальному стволу над блоком «Конец».
        # Только основное ребро рисует ствол и наконечник, остальные
        # заканчиваются на нём, поэтому линии не накладываются друг на друга.
        ordered_ends = sorted(end_edges, key=lambda e: by_id[e.src].cy)
        trunk_x = end.cx
        top_join = end.y - 14.0 - (len(ordered_ends) - 1) * 12.0
        side_lanes = {
            "W": min(n.x for n in nodes) - 28.0,
            "E": max(n.right for n in nodes) + 28.0,
        }
        for index, edge in enumerate(ordered_ends):
            source = by_id[edge.src]
            # Ложный выход for должен сохранять правую вершину и на
            # общем маршруте к «Конец», который иначе выбирает сторону
            # только по взаимному положению блоков.
            side = (
                "E"
                if source.kind == "preparation" and edge.route_side
                else ("W" if source.cx < trunk_x else "E")
            )
            start = _port(source, side)
            lane = side_lanes[side]
            join_y = top_join + index * 12.0
            pts = [start, (lane, start[1]), (lane, join_y), (trunk_x, join_y)]
            if index == 0:
                pts.append((trunk_x, end.y))
                edge.arrow = True
            else:
                edge.arrow = False
            edge.points = _simplify(pts)


# ---------------------------------------------------------------------------
# Публичная функция
# ---------------------------------------------------------------------------

@dataclass
class LayoutResult:
    nodes: list[FNode]
    edges: list[FEdge]
    width: float
    height: float
    min_x: float
    min_y: float


def layout(flow: Flowchart) -> LayoutResult:
    for node in flow.nodes:
        measure_node(node)
    graphviz_layout(flow.nodes, flow.edges)
    route_edges(flow.nodes, flow.edges)

    xs: list[float] = []
    ys: list[float] = []
    for n in flow.nodes:
        xs.extend([n.x, n.right])
        ys.extend([n.y, n.bottom])
    for e in flow.edges:
        for x, y in e.points:
            xs.append(x)
            ys.append(y)

    if not xs:
        xs = [0.0, 100.0]
        ys = [0.0, 100.0]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return LayoutResult(
        nodes=flow.nodes,
        edges=flow.edges,
        width=max_x - min_x,
        height=max_y - min_y,
        min_x=min_x,
        min_y=min_y,
    )
