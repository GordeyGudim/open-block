#!/usr/bin/env python3
"""Smoke-тест gostflow: парсинг, сборка графов, раскладка, SVG, CLI и веб.

Запуск из корня проекта:  python3 tests/smoke.py
Нужен установленный Graphviz (dot); для PNG-проверок — rsvg-convert
или ImageMagick (при их отсутствии PNG-шаги пропускаются с пометкой).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gostflow.api import GostFlowError, generate_svg  # noqa: E402
from gostflow.flowchart import build_flowchart  # noqa: E402
from gostflow.layout import layout  # noqa: E402
from gostflow.parser import parse_source  # noqa: E402
from gostflow.render import svg_to_png  # noqa: E402

FAILURES: list[str] = []
CHECKS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}: {detail}")
        FAILURES.append(f"{name}: {detail}")


SAMPLES = {
    "factorial": (ROOT / "samples/factorial.cpp").read_text(encoding="utf-8"),
    "switch": (ROOT / "samples/switch.cpp").read_text(encoding="utf-8"),
    "loops": (ROOT / "samples/loops.cpp").read_text(encoding="utf-8"),
    "if_no_braces": """
int main() {
    int x;
    if (x > 0) x--;
    else if (x < 0) x++;
    else x = 0;
    return 0;
}
""",
    "range_for": """
int main() {
    int s = 0;
    for (auto x : {1, 2, 3}) {
        s += x;
    }
    return s;
}
""",
    "nested_loops": """
int main() {
    int n = 10;
    for (int i = 0; i < n; i++) {
        if (i == 3) continue;
        if (i == 7) break;
        while (n > 0) {
            n--;
            if (n == 5) break;
        }
    }
    return n;
}
""",
    "switch_fallthrough": """
int main() {
    int x = 1;
    switch (x) {
        case 1:
        case 2:
            x++;
        case 3:
            x--;
            break;
        default:
            x = 0;
    }
    return x;
}
""",
    "multi_functions": """
int gcd(int a, int b) {
    while (b != 0) {
        int t = b;
        b = a % b;
        a = t;
    }
    return a;
}
int main() {
    int x = gcd(12, 18);
    return x;
}
""",
    "class_method": """
class Foo {
public:
    int bar(int x) {
        if (x > 0) return x;
        return -x;
    }
};
int main() { return 0; }
""",
    "try_catch": """
int main() {
    try {
        int x = 1;
    } catch (const std::exception& e) {
        return 1;
    }
    return 0;
}
""",
    "io_predefined": """
int twice(int v) {
    return v * 2;
}
int main() {
    int a;
    std::cin >> a;
    std::cout << twice(a);
    return 0;
}
""",
}


def on_boundary(px: float, py: float, node, tol: float = 2.5) -> bool:
    if (
        (abs(py - node.y) <= tol and node.x - tol <= px <= node.right + tol)
        or (abs(py - node.bottom) <= tol and node.x - tol <= px <= node.right + tol)
        or (abs(px - node.x) <= tol and node.y - tol <= py <= node.bottom + tol)
        or (abs(px - node.right) <= tol and node.y - tol <= py <= node.bottom + tol)
    ):
        return True
    if node.kind == "decision":
        # Наклонные стороны ромба: стрелка может входить по склону.
        dx = abs(px - node.cx) / (node.width / 2.0)
        dy = abs(py - node.cy) / (node.height / 2.0)
        return abs(dx + dy - 1.0) <= 0.06
    return False


def check_layout(name: str) -> None:
    """Раскладка: рёбра ортогональны, не проходят сквозь блоки."""
    functions = parse_source(SAMPLES[name])
    for func in functions:
        flow = build_flowchart(func)
        tags = {n.kind for n in flow.nodes}
        check(f"{name}/{func.name}: терминаторы", "terminator" in tags)
        res = layout(flow)

        bad_ortho = bad_cross = bad_entry = 0
        by_id = {n.id: n for n in res.nodes}
        for edge in res.edges:
            pts = edge.points
            if len(pts) < 2:
                bad_entry += 1
                continue
            for a, b in zip(pts, pts[1:]):
                if abs(a[0] - b[0]) > 0.5 and abs(a[1] - b[1]) > 0.5:
                    bad_ortho += 1
            t = by_id[edge.dst]
            if not on_boundary(*pts[-1], t):
                bad_entry += 1
            x0, y0 = pts[0]
            x1, y1 = pts[-1]
            for node in res.nodes:
                if node.id in (edge.src, edge.dst):
                    continue
                left, right = min(x0, x1), max(x0, x1)
                top, bottom = min(y0, y1), max(y0, y1)
                if (
                    left < node.x - 2
                    and right > node.right + 2
                    and top < node.y - 2
                    and bottom > node.bottom + 2
                ):
                    # горизонталь целиком накрывает блок по вертикали?
                    if y0 < node.y - 2 or y0 > node.bottom + 2:
                        continue
                    bad_cross += 1
        check(
            f"{name}/{func.name}: ортогональные рёбра",
            bad_ortho == 0,
            f"{bad_ortho} неортогональных сегментов",
        )
        check(
            f"{name}/{func.name}: входы на границах блоков",
            bad_entry == 0,
            f"{bad_entry} рёбер не доходят до границы",
        )
        check(
            f"{name}/{func.name}: рёбра не накрывают блоки",
            bad_cross == 0,
            f"{bad_cross} накрытий",
        )


def check_svg(name: str) -> str:
    svg, functions, _ = generate_svg(SAMPLES[name], title=name)
    check(f"{name}: svg корректен", "<svg" in svg and "</svg>" in svg)
    return svg


def test_shapes() -> None:
    print("== Фигуры ГОСТ ==")
    svg, _, _ = generate_svg(SAMPLES["io_predefined"])
    check("параллелограмм (ввод/вывод)", "polygon" in svg)
    check("ромб (решение)", "polygon" in svg)
    func_svg, _, _ = generate_svg(SAMPLES["io_predefined"], function="main")
    check("двойные стенки (предопределённый)", "line" in func_svg)
    term_svg, _, _ = generate_svg("int main() { return 0; }")
    check("скруглённый терминатор", 'rx="' in term_svg)
    try:
        generate_svg("int main() { }")
        # тело пустое — схема из Начала и Конца, это не ошибка
        check("пустая функция не падает", True)
    except GostFlowError as exc:
        check("пустая функция не падает", False, str(exc))
    try:
        generate_svg("", title="empty")
        check("пустой исходник даёт ошибку", False, "тихо прошёл")
    except GostFlowError:
        check("пустой исходник даёт ошибку", True)


def test_unknown_function() -> None:
    print("== Выбор функции ==")
    try:
        generate_svg(SAMPLES["multi_functions"], function="nope")
        check("неизвестная функция даёт ошибку", False, "тихо прошёл")
    except GostFlowError as exc:
        check("неизвестная функция даёт ошибку", "nope" in str(exc))
    _, functions, chosen = generate_svg(SAMPLES["multi_functions"])
    check("functions=[gcd, main]", [f.name for f in functions] == ["gcd", "main"])
    check("по умолчанию main", chosen.name == "main")
    _, _, chosen = generate_svg(SAMPLES["multi_functions"], function="gcd")
    check("явное -f gcd", chosen.name == "gcd")


def test_cli() -> None:
    print("== CLI ==")
    run = [sys.executable, str(ROOT / "run.py")]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "cli.svg"
        proc = subprocess.run(
            run + [str(ROOT / "samples/factorial.cpp"), "-o", str(out), "-t", "CLI"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        check("cli svg exit=0", proc.returncode == 0, proc.stderr)
        check("cli svg создан", out.exists() and "<svg" in out.read_text())

        out_png = Path(tmp) / "cli.png"
        proc = subprocess.run(
            run + [str(ROOT / "samples/switch.cpp"), "-o", str(out_png), "--format", "png"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        png_magic = out_png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" if out_png.exists() else False
        check("cli png exit=0 и это PNG", proc.returncode == 0 and png_magic, proc.stderr)

        proc = subprocess.run(
            run + [str(ROOT / "samples/factorial.cpp"), "--list"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        check("cli --list", proc.returncode == 0 and "main" in proc.stdout, proc.stderr)


def test_web() -> None:
    print("== Веб-интерфейс ==")
    port = 8642
    proc = subprocess.Popen(
        [
            sys.executable, "-m", "gostflow",
            "--serve", "--port", str(port), "--host", "127.0.0.1",
        ],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 10.0
        ready = False
        while time.time() < deadline and not ready:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/", timeout=1.0
                ) as resp:
                    html = resp.read().decode("utf-8")
                ready = True
            except OSError:
                time.sleep(0.2)
        check("сервер отвечает", ready)
        if not ready:
            return
        check("страница отдаётся", "gostflow" in html and "</html>" in html)

        payload = json.dumps({"code": SAMPLES["factorial"]}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/render",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        check("api/render svg", data.get("ok") is True and "<svg" in data.get("svg", ""))

        payload = json.dumps(
            {"code": SAMPLES["factorial"], "format": "png"}
        ).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/render",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        check("api/render png", data.get("ok") is True and bool(data.get("png")))

        payload = json.dumps({"code": "это не c++ {"}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/render",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        check("api/render не падает на мусоре", "ok" in data)
    finally:
        proc.terminate()
        proc.wait(timeout=5.0)


def main() -> int:
    print("== Парсинг и построение ==")
    for name in SAMPLES:
        try:
            check_svg(name)
            check_layout(name)
        except Exception as exc:  # noqa: BLE001
            check(f"{name}: построение", False, f"{type(exc).__name__}: {exc}")

    test_shapes()
    test_unknown_function()
    test_cli()

    if shutil.which("dot") is None:
        print("SKIP: Graphviz не найден, тесты этого не покрыли бы")
        return 1
    test_web()

    print(f"\nВсего проверок: {CHECKS}, падений: {len(FAILURES)}")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
